from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from pydantic.alias_generators import to_camel

from app.models.user import UserRole


class _CamelModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )


class DoctorCreate(_CamelModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)
    role: UserRole = UserRole.DOCTOR


class DoctorUpdate(_CamelModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    role: UserRole | None = None
    is_active: bool | None = None


class PasswordReset(_CamelModel):
    new_password: str = Field(min_length=6, max_length=128)


class DoctorRead(_CamelModel):
    id: UUID
    email: EmailStr
    full_name: str
    role: UserRole
    is_active: bool
    avatar_url: str | None = None
    created_at: datetime


class DoctorListItem(DoctorRead):
    patient_count: int
    examination_count: int


class AdminStats(_CamelModel):
    total_doctors: int
    active_doctors: int
    total_patients: int
    total_examinations: int
    examinations_pending: int
    examinations_done: int
