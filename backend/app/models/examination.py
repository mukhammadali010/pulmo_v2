from enum import StrEnum
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import Enum as SAEnum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.patient import Patient
    from app.models.user import User


class ExaminationType(StrEnum):
    XRAY = "xray"
    CT = "ct"
    MRI = "mri"
    AUDIO = "audio"
    PARAMETERS = "parameters"
    CLINICAL_SCALE = "clinical_scale"


class ExaminationStatus(StrEnum):
    PENDING = "pending"
    ANALYZING = "analyzing"
    DONE = "done"
    FAILED = "failed"


class Examination(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "examinations"

    patient_id: Mapped[UUID] = mapped_column(
        ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False
    )
    patient: Mapped["Patient"] = relationship(back_populates="examinations")

    created_by_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    created_by: Mapped["User"] = relationship(lazy="joined")

    type: Mapped[ExaminationType] = mapped_column(
        SAEnum(
            ExaminationType,
            name="examination_type",
            values_callable=lambda enum: [e.value for e in enum],
        ),
        nullable=False,
    )
    status: Mapped[ExaminationStatus] = mapped_column(
        SAEnum(
            ExaminationStatus,
            name="examination_status",
            values_callable=lambda enum: [e.value for e in enum],
        ),
        default=ExaminationStatus.PENDING,
        nullable=False,
    )

    # File-backed examinations (image, audio) populate these; parameters leave them null.
    attachment_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    attachment_mime: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Structured numeric/lab parameters for the parameters examination type.
    parameters: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_report: Mapped[str | None] = mapped_column(Text, nullable=True)
