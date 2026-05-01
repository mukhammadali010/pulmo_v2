from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.patient import Patient
from app.schemas.patient import PatientCreate, PatientUpdate


async def list_patients(session: AsyncSession, *, owner_id: UUID) -> list[Patient]:
    result = await session.execute(
        select(Patient).where(Patient.created_by_id == owner_id).order_by(Patient.created_at.desc())
    )
    return list(result.scalars().all())


async def get_patient(
    session: AsyncSession, *, patient_id: UUID, owner_id: UUID
) -> Patient | None:
    result = await session.execute(
        select(Patient).where(Patient.id == patient_id, Patient.created_by_id == owner_id)
    )
    return result.scalar_one_or_none()


async def create_patient(
    session: AsyncSession, *, owner_id: UUID, payload: PatientCreate
) -> Patient:
    patient = Patient(created_by_id=owner_id, **payload.model_dump(exclude_none=True))
    session.add(patient)
    await session.commit()
    await session.refresh(patient)
    return patient


async def update_patient(
    session: AsyncSession, patient: Patient, payload: PatientUpdate
) -> Patient:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(patient, field, value)
    await session.commit()
    await session.refresh(patient)
    return patient


async def delete_patient(session: AsyncSession, patient: Patient) -> None:
    await session.delete(patient)
    await session.commit()
