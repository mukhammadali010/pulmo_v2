from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile, status

from app.api.deps import CurrentUser, SessionDep
from app.models.examination import ExaminationStatus, ExaminationType
from app.schemas.examination import (
    ClinicalScaleCreate,
    ExaminationRead,
    ExaminationUpdate,
    ParameterExaminationCreate,
)
from app.services import ai_diagnosis
from app.services import clinical_scales as clinical_scales_service
from app.services import examination as examination_service
from app.services import patient as patient_service
from app.services.storage import (
    ALLOWED_AUDIO_MIME,
    ALLOWED_IMAGE_MIME,
    StorageError,
    save_examination_file,
)

router = APIRouter()

_IMAGE_TYPES = {ExaminationType.XRAY, ExaminationType.CT, ExaminationType.MRI}


@router.get("", response_model=list[ExaminationRead])
async def list_examinations(
    session: SessionDep,
    current_user: CurrentUser,
    patient_id: UUID | None = None,
) -> list[ExaminationRead]:
    items = await examination_service.list_examinations(
        session, owner_id=current_user.id, patient_id=patient_id
    )
    return [ExaminationRead.model_validate(e) for e in items]


@router.post(
    "/file", response_model=ExaminationRead, status_code=status.HTTP_201_CREATED
)
async def create_file_examination(
    session: SessionDep,
    current_user: CurrentUser,
    patient_id: UUID = Form(...),
    type: ExaminationType = Form(...),
    notes: str | None = Form(default=None),
    file: UploadFile = File(...),
) -> ExaminationRead:
    if type == ExaminationType.PARAMETERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Parameter examinations must be created via /examinations/parameters",
        )

    patient = await patient_service.get_patient(
        session, patient_id=patient_id, owner_id=current_user.id
    )
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    allowed = ALLOWED_IMAGE_MIME if type in _IMAGE_TYPES else ALLOWED_AUDIO_MIME
    try:
        filename, mime, _ = await save_examination_file(file, allowed=allowed)
    except StorageError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        ) from e

    examination = await examination_service.create_file_examination(
        session,
        owner_id=current_user.id,
        patient_id=patient_id,
        type=type,
        attachment_filename=filename,
        attachment_mime=mime,
        notes=notes,
    )
    return ExaminationRead.model_validate(examination)


@router.post(
    "/parameters",
    response_model=ExaminationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_parameter_examination(
    payload: ParameterExaminationCreate,
    session: SessionDep,
    current_user: CurrentUser,
) -> ExaminationRead:
    patient = await patient_service.get_patient(
        session, patient_id=payload.patient_id, owner_id=current_user.id
    )
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    examination = await examination_service.create_parameter_examination(
        session,
        owner_id=current_user.id,
        patient_id=payload.patient_id,
        parameters=payload.parameters,
        notes=payload.notes,
    )
    return ExaminationRead.model_validate(examination)


@router.post(
    "/clinical-scale",
    response_model=ExaminationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_clinical_scale(
    payload: ClinicalScaleCreate,
    session: SessionDep,
    current_user: CurrentUser,
) -> ExaminationRead:
    """Compute a clinical scale (CRB-65, CAT, GINA, mMRC, GOLD) and persist it.

    Server runs the deterministic calculator — frontend cannot supply a
    pre-computed score. The result (score, severity, breakdown, recommendation)
    is stored in `examination.parameters` so the existing examination listing
    surfaces it without further changes.
    """
    patient = await patient_service.get_patient(
        session, patient_id=payload.patient_id, owner_id=current_user.id
    )
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    try:
        result = clinical_scales_service.calculate(payload.scale_type, payload.inputs)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    examination = await examination_service.create_clinical_scale_examination(
        session,
        owner_id=current_user.id,
        patient_id=payload.patient_id,
        result=dict(result),
        notes=payload.notes,
    )
    return ExaminationRead.model_validate(examination)


@router.get("/{examination_id}", response_model=ExaminationRead)
async def get_examination(
    examination_id: UUID, session: SessionDep, current_user: CurrentUser
) -> ExaminationRead:
    examination = await examination_service.get_examination(
        session, examination_id=examination_id, owner_id=current_user.id
    )
    if examination is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Examination not found"
        )
    return ExaminationRead.model_validate(examination)


@router.patch("/{examination_id}", response_model=ExaminationRead)
async def update_examination_route(
    examination_id: UUID,
    payload: ExaminationUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> ExaminationRead:
    examination = await examination_service.get_examination(
        session, examination_id=examination_id, owner_id=current_user.id
    )
    if examination is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Examination not found"
        )
    examination = await examination_service.update_examination(
        session,
        examination,
        notes=payload.notes,
        parameters=payload.parameters,
    )
    return ExaminationRead.model_validate(examination)


@router.post("/{examination_id}/analyze", response_model=ExaminationRead)
async def analyze_examination(
    examination_id: UUID,
    background_tasks: BackgroundTasks,
    session: SessionDep,
    current_user: CurrentUser,
    language: str = "uz",
) -> ExaminationRead:
    """Kick off AI analysis. Marks the examination `analyzing`, returns immediately,
    runs Claude in the background, and updates the row to `done`/`failed` when finished."""
    examination = await examination_service.get_examination(
        session, examination_id=examination_id, owner_id=current_user.id
    )
    if examination is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Examination not found"
        )
    if examination.status == ExaminationStatus.ANALYZING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Analysis already in progress"
        )

    examination.status = ExaminationStatus.ANALYZING
    examination.ai_report = None
    await session.commit()
    await session.refresh(examination)

    background_tasks.add_task(
        ai_diagnosis.analyze_examination, examination_id, language
    )

    return ExaminationRead.model_validate(examination)


@router.delete("/{examination_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_examination(
    examination_id: UUID, session: SessionDep, current_user: CurrentUser
) -> None:
    examination = await examination_service.get_examination(
        session, examination_id=examination_id, owner_id=current_user.id
    )
    if examination is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Examination not found"
        )
    await examination_service.delete_examination(session, examination)
