from datetime import date
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Date, Enum as SAEnum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.examination import Examination
    from app.models.user import User


class Gender(StrEnum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"


class Patient(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "patients"

    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[Gender | None] = mapped_column(
        SAEnum(
            Gender,
            name="gender",
            values_callable=lambda enum: [e.value for e in enum],
        ),
        nullable=True,
    )
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    created_by_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    created_by: Mapped["User"] = relationship(lazy="joined")

    examinations: Mapped[list["Examination"]] = relationship(
        back_populates="patient",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
