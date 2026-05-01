from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, SessionDep
from app.schemas.patient import PatientCreate, PatientRead, PatientUpdate
from app.services import patient as patient_service

router = APIRouter()


@router.get("", response_model=list[PatientRead])
async def list_patients(
    session: SessionDep, current_user: CurrentUser
) -> list[PatientRead]:
    patients = await patient_service.list_patients(session, owner_id=current_user.id)
    return [PatientRead.model_validate(p) for p in patients]


@router.post("", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
async def create_patient(
    payload: PatientCreate, session: SessionDep, current_user: CurrentUser
) -> PatientRead:
    patient = await patient_service.create_patient(
        session, owner_id=current_user.id, payload=payload
    )
    return PatientRead.model_validate(patient)


@router.get("/{patient_id}", response_model=PatientRead)
async def get_patient(
    patient_id: UUID, session: SessionDep, current_user: CurrentUser
) -> PatientRead:
    patient = await patient_service.get_patient(
        session, patient_id=patient_id, owner_id=current_user.id
    )
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return PatientRead.model_validate(patient)


@router.patch("/{patient_id}", response_model=PatientRead)
async def update_patient(
    patient_id: UUID,
    payload: PatientUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> PatientRead:
    patient = await patient_service.get_patient(
        session, patient_id=patient_id, owner_id=current_user.id
    )
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    patient = await patient_service.update_patient(session, patient, payload)
    return PatientRead.model_validate(patient)


@router.delete("/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_patient(
    patient_id: UUID, session: SessionDep, current_user: CurrentUser
) -> None:
    patient = await patient_service.get_patient(
        session, patient_id=patient_id, owner_id=current_user.id
    )
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    await patient_service.delete_patient(session, patient)
