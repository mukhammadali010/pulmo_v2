from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.examination import Examination, ExaminationStatus, ExaminationType


async def list_examinations(
    session: AsyncSession,
    *,
    owner_id: UUID,
    patient_id: UUID | None = None,
) -> list[Examination]:
    stmt = (
        select(Examination)
        .where(Examination.created_by_id == owner_id)
        .order_by(Examination.created_at.desc())
    )
    if patient_id is not None:
        stmt = stmt.where(Examination.patient_id == patient_id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_examination(
    session: AsyncSession, *, examination_id: UUID, owner_id: UUID
) -> Examination | None:
    result = await session.execute(
        select(Examination).where(
            Examination.id == examination_id,
            Examination.created_by_id == owner_id,
        )
    )
    return result.scalar_one_or_none()


async def create_file_examination(
    session: AsyncSession,
    *,
    owner_id: UUID,
    patient_id: UUID,
    type: ExaminationType,
    attachment_filename: str,
    attachment_mime: str,
    notes: str | None,
) -> Examination:
    examination = Examination(
        created_by_id=owner_id,
        patient_id=patient_id,
        type=type,
        status=ExaminationStatus.PENDING,
        attachment_filename=attachment_filename,
        attachment_mime=attachment_mime,
        notes=notes,
    )
    session.add(examination)
    await session.commit()
    await session.refresh(examination)
    return examination


async def create_parameter_examination(
    session: AsyncSession,
    *,
    owner_id: UUID,
    patient_id: UUID,
    parameters: dict[str, Any],
    notes: str | None,
) -> Examination:
    examination = Examination(
        created_by_id=owner_id,
        patient_id=patient_id,
        type=ExaminationType.PARAMETERS,
        status=ExaminationStatus.PENDING,
        parameters=parameters,
        notes=notes,
    )
    session.add(examination)
    await session.commit()
    await session.refresh(examination)
    return examination


async def create_clinical_scale_examination(
    session: AsyncSession,
    *,
    owner_id: UUID,
    patient_id: UUID,
    result: dict[str, Any],
    notes: str | None,
) -> Examination:
    """Persist a calculator result. Status is DONE on creation — clinical scales
    are deterministic, so there is no AI step to wait for."""
    examination = Examination(
        created_by_id=owner_id,
        patient_id=patient_id,
        type=ExaminationType.CLINICAL_SCALE,
        status=ExaminationStatus.DONE,
        parameters=result,
        notes=notes,
    )
    session.add(examination)
    await session.commit()
    await session.refresh(examination)
    return examination


async def update_examination(
    session: AsyncSession,
    examination: Examination,
    *,
    notes: str | None = None,
    parameters: dict[str, Any] | None = None,
) -> Examination:
    if notes is not None:
        examination.notes = notes
    if parameters is not None:
        examination.parameters = parameters
    await session.commit()
    await session.refresh(examination)
    return examination


async def delete_examination(session: AsyncSession, examination: Examination) -> None:
    await session.delete(examination)
    await session.commit()
