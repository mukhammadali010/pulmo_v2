from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field
from pydantic.alias_generators import to_camel

from app.models.examination import ExaminationStatus, ExaminationType


class _CamelModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )


class ExaminationRead(_CamelModel):
    id: UUID
    patient_id: UUID
    created_by_id: UUID
    type: ExaminationType
    status: ExaminationStatus
    attachment_filename: str | None
    attachment_mime: str | None
    parameters: dict[str, Any] | None
    notes: str | None
    ai_summary: str | None
    ai_report: str | None
    created_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def attachment_url(self) -> str | None:
        """Path relative to the API base. The frontend's HttpClient prepends
        the configured base URL (`/api/v1` in dev), so we return only the
        resource path here."""
        if not self.attachment_filename:
            return None
        return f"/files/examinations/{self.attachment_filename}"


class ExaminationUpdate(_CamelModel):
    notes: str | None = Field(default=None, max_length=2000)
    parameters: dict[str, Any] | None = None


class ParameterExaminationCreate(_CamelModel):
    patient_id: UUID
    parameters: dict[str, Any]
    notes: str | None = Field(default=None, max_length=2000)


class ClinicalScaleCreate(_CamelModel):
    """Request body for POST /examinations/clinical-scale.

    Doctor submits scale_type + raw inputs; the server runs the deterministic
    calculator and persists the result. Doctors do NOT submit pre-computed
    scores — the server is the source of truth so a buggy frontend can't
    record a bad score against a patient.
    """

    patient_id: UUID
    scale_type: str = Field(..., description="One of clinical_scales.ScaleType values, e.g. 'crb_65'")
    inputs: dict[str, Any] = Field(..., description="Raw inputs for the scale; shape depends on scale_type")
    notes: str | None = Field(default=None, max_length=2000)
