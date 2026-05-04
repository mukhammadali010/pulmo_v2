from enum import StrEnum
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import Column, Enum as SAEnum, ForeignKey, String, Table, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.examination import ExaminationStatus

if TYPE_CHECKING:
    from app.models.examination import Examination
    from app.models.patient import Patient
    from app.models.user import User


class FinalDiagnosisConfidence(StrEnum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"


class FinalDiagnosisUrgency(StrEnum):
    GREEN = "green"
    YELLOW = "yellow"
    RED = "red"


final_diagnosis_examinations = Table(
    "final_diagnosis_examinations",
    Base.metadata,
    Column(
        "final_diagnosis_id",
        ForeignKey("final_diagnoses.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "examination_id",
        ForeignKey("examinations.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class FinalDiagnosis(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "final_diagnoses"

    patient_id: Mapped[UUID] = mapped_column(
        ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False
    )
    patient: Mapped["Patient"] = relationship(lazy="joined")

    created_by_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    created_by: Mapped["User"] = relationship(lazy="joined")

    status: Mapped[ExaminationStatus] = mapped_column(
        SAEnum(
            ExaminationStatus,
            name="examination_status",
            values_callable=lambda enum: [e.value for e in enum],
            create_type=False,
        ),
        default=ExaminationStatus.PENDING,
        nullable=False,
    )
    language: Mapped[str] = mapped_column(String(8), default="uz", nullable=False)
    clinical_context: Mapped[str | None] = mapped_column(Text, nullable=True)

    primary_diagnosis: Mapped[str | None] = mapped_column(String(500), nullable=True)
    icd10: Mapped[str | None] = mapped_column(String(16), nullable=True)
    confidence: Mapped[FinalDiagnosisConfidence | None] = mapped_column(
        SAEnum(
            FinalDiagnosisConfidence,
            name="final_diagnosis_confidence",
            values_callable=lambda enum: [e.value for e in enum],
        ),
        nullable=True,
    )
    urgency: Mapped[FinalDiagnosisUrgency | None] = mapped_column(
        SAEnum(
            FinalDiagnosisUrgency,
            name="final_diagnosis_urgency",
            values_callable=lambda enum: [e.value for e in enum],
        ),
        nullable=True,
    )

    ai_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_report: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    examinations: Mapped[list["Examination"]] = relationship(
        secondary=final_diagnosis_examinations,
        lazy="selectin",
    )
