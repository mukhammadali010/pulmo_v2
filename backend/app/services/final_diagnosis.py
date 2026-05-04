from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.examination import Examination, ExaminationStatus
from app.models.final_diagnosis import FinalDiagnosis


class FinalDiagnosisError(ValueError):
    """Raised when create/analyze inputs are invalid (mapped to HTTP 400)."""


async def list_final_diagnoses(
    session: AsyncSession,
    *,
    owner_id: UUID,
    patient_id: UUID | None = None,
) -> list[FinalDiagnosis]:
    stmt = (
        select(FinalDiagnosis)
        .where(FinalDiagnosis.created_by_id == owner_id)
        .order_by(FinalDiagnosis.created_at.desc())
    )
    if patient_id is not None:
        stmt = stmt.where(FinalDiagnosis.patient_id == patient_id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_final_diagnosis(
    session: AsyncSession,
    *,
    final_diagnosis_id: UUID,
    owner_id: UUID,
) -> FinalDiagnosis | None:
    stmt = (
        select(FinalDiagnosis)
        .options(
            selectinload(FinalDiagnosis.examinations),
        )
        .where(
            FinalDiagnosis.id == final_diagnosis_id,
            FinalDiagnosis.created_by_id == owner_id,
        )
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def create_final_diagnosis(
    session: AsyncSession,
    *,
    owner_id: UUID,
    patient_id: UUID,
    examination_ids: list[UUID],
    clinical_context: str | None,
    language: str,
) -> FinalDiagnosis:
    examinations = await _load_owned_examinations(
        session, owner_id=owner_id, examination_ids=examination_ids
    )

    if len(examinations) != len(set(examination_ids)):
        raise FinalDiagnosisError(
            "One or more examinations were not found or do not belong to this user."
        )

    wrong_patient = [e for e in examinations if e.patient_id != patient_id]
    if wrong_patient:
        raise FinalDiagnosisError(
            "All examinations must belong to the same patient as the final diagnosis."
        )

    not_done = [e for e in examinations if e.status != ExaminationStatus.DONE]
    if not_done:
        raise FinalDiagnosisError(
            "All source examinations must be analyzed (status=done) before synthesis."
        )

    final = FinalDiagnosis(
        patient_id=patient_id,
        created_by_id=owner_id,
        status=ExaminationStatus.PENDING,
        language=language,
        clinical_context=clinical_context,
        examinations=examinations,
    )
    session.add(final)
    await session.commit()
    await session.refresh(final, ["examinations"])
    return final


async def mark_analyzing(
    session: AsyncSession, final: FinalDiagnosis
) -> FinalDiagnosis:
    final.status = ExaminationStatus.ANALYZING
    final.error_message = None
    await session.commit()
    await session.refresh(final)
    return final


async def delete_final_diagnosis(
    session: AsyncSession, final: FinalDiagnosis
) -> None:
    await session.delete(final)
    await session.commit()


async def _load_owned_examinations(
    session: AsyncSession,
    *,
    owner_id: UUID,
    examination_ids: list[UUID],
) -> list[Examination]:
    if not examination_ids:
        return []
    stmt = select(Examination).where(
        Examination.id.in_(examination_ids),
        Examination.created_by_id == owner_id,
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())
