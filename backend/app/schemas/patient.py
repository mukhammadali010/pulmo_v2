from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.patient import Gender


class _CamelModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )


class PatientCreate(_CamelModel):
    full_name: str = Field(min_length=1, max_length=255)
    date_of_birth: date | None = None
    gender: Gender | None = None
    phone: str | None = Field(default=None, max_length=32)
    notes: str | None = Field(default=None, max_length=2000)


class PatientUpdate(_CamelModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    date_of_birth: date | None = None
    gender: Gender | None = None
    phone: str | None = Field(default=None, max_length=32)
    notes: str | None = Field(default=None, max_length=2000)


class PatientRead(_CamelModel):
    id: UUID
    full_name: str
    date_of_birth: date | None
    gender: Gender | None
    phone: str | None
    notes: str | None
    created_by_id: UUID
