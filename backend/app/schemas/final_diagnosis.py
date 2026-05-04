from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.examination import ExaminationStatus
from app.models.final_diagnosis import (
    FinalDiagnosisConfidence,
    FinalDiagnosisUrgency,
)
from app.schemas.examination import ExaminationRead


class _CamelModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )


class FinalDiagnosisCreate(_CamelModel):
    patient_id: UUID
    examination_ids: list[UUID] = Field(min_length=1, max_length=5)
    clinical_context: str | None = Field(default=None, max_length=4000)
    language: str = Field(default="uz", pattern=r"^(uz|ru|en)$")


class FinalDiagnosisListItem(_CamelModel):
    """Compact row for list views — excludes the heavy `ai_payload`/`ai_report`."""

    id: UUID
    patient_id: UUID
    created_by_id: UUID
    status: ExaminationStatus
    language: str
    primary_diagnosis: str | None
    icd10: str | None
    confidence: FinalDiagnosisConfidence | None
    urgency: FinalDiagnosisUrgency | None
    ai_summary: str | None
    created_at: datetime


class FinalDiagnosisRead(FinalDiagnosisListItem):
    """Full record — includes structured payload, markdown report, and source examinations."""

    clinical_context: str | None
    ai_payload: dict[str, Any] | None
    ai_report: str | None
    error_message: str | None
    examinations: list[ExaminationRead]
