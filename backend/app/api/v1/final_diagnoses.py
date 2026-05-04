from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from app.api.deps import CurrentUser, SessionDep
from app.models.examination import ExaminationStatus
from app.schemas.final_diagnosis import (
    FinalDiagnosisCreate,
    FinalDiagnosisListItem,
    FinalDiagnosisRead,
)
from app.services import ai_diagnosis
from app.services import final_diagnosis as final_diagnosis_service
from app.services import patient as patient_service
from app.services.final_diagnosis import FinalDiagnosisError

router = APIRouter()


@router.get("", response_model=list[FinalDiagnosisListItem])
async def list_final_diagnoses(
    session: SessionDep,
    current_user: CurrentUser,
    patient_id: UUID | None = None,
) -> list[FinalDiagnosisListItem]:
    items = await final_diagnosis_service.list_final_diagnoses(
        session, owner_id=current_user.id, patient_id=patient_id
    )
    return [FinalDiagnosisListItem.model_validate(f) for f in items]


@router.post(
    "", response_model=FinalDiagnosisRead, status_code=status.HTTP_201_CREATED
)
async def create_final_diagnosis(
    payload: FinalDiagnosisCreate,
    session: SessionDep,
    current_user: CurrentUser,
) -> FinalDiagnosisRead:
    patient = await patient_service.get_patient(
        session, patient_id=payload.patient_id, owner_id=current_user.id
    )
    if patient is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found"
        )

    try:
        final = await final_diagnosis_service.create_final_diagnosis(
            session,
            owner_id=current_user.id,
            patient_id=payload.patient_id,
            examination_ids=payload.examination_ids,
            clinical_context=payload.clinical_context,
            language=payload.language,
        )
    except FinalDiagnosisError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        ) from e

    return FinalDiagnosisRead.model_validate(final)


@router.get("/{final_diagnosis_id}", response_model=FinalDiagnosisRead)
async def get_final_diagnosis(
    final_diagnosis_id: UUID,
    session: SessionDep,
    current_user: CurrentUser,
) -> FinalDiagnosisRead:
    final = await final_diagnosis_service.get_final_diagnosis(
        session, final_diagnosis_id=final_diagnosis_id, owner_id=current_user.id
    )
    if final is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Final diagnosis not found"
        )
    return FinalDiagnosisRead.model_validate(final)


@router.post(
    "/{final_diagnosis_id}/analyze", response_model=FinalDiagnosisRead
)
async def analyze_final_diagnosis(
    final_diagnosis_id: UUID,
    background_tasks: BackgroundTasks,
    session: SessionDep,
    current_user: CurrentUser,
) -> FinalDiagnosisRead:
    """Kick off multi-modal synthesis. Marks the row `analyzing`, returns
    immediately, runs Gemini in the background, and updates the row to
    `done`/`failed` when finished."""
    final = await final_diagnosis_service.get_final_diagnosis(
        session, final_diagnosis_id=final_diagnosis_id, owner_id=current_user.id
    )
    if final is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Final diagnosis not found"
        )
    if final.status == ExaminationStatus.ANALYZING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Synthesis already in progress",
        )

    final = await final_diagnosis_service.mark_analyzing(session, final)

    background_tasks.add_task(
        ai_diagnosis.analyze_final_diagnosis, final_diagnosis_id, final.language
    )

    return FinalDiagnosisRead.model_validate(final)


@router.delete(
    "/{final_diagnosis_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_final_diagnosis(
    final_diagnosis_id: UUID,
    session: SessionDep,
    current_user: CurrentUser,
) -> None:
    final = await final_diagnosis_service.get_final_diagnosis(
        session, final_diagnosis_id=final_diagnosis_id, owner_id=current_user.id
    )
    if final is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Final diagnosis not found"
        )
    await final_diagnosis_service.delete_final_diagnosis(session, final)
