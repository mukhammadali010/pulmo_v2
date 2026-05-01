"""Provider-agnostic helpers and prompts shared across the AI backends.

Both `ai_claude.py` and `ai_gemini.py` import from here so the system prompts
and DB plumbing are not duplicated.
"""

from __future__ import annotations

import logging
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import AsyncSessionLocal
from app.models.examination import Examination, ExaminationStatus
from app.models.patient import Patient

logger = logging.getLogger(__name__)


class DiagnosisOutput(BaseModel):
    """Structured AI response — used as the JSON schema for both providers."""

    summary: str
    report: str


# JSON schema for providers that take dict-shaped schemas.
DIAGNOSIS_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "summary": {
            "type": "string",
            "description": (
                "A brief 2-3 sentence clinical summary of the most important findings, "
                "severity, and the recommended next action. Plain text, no Markdown headers."
            ),
        },
        "report": {
            "type": "string",
            "description": (
                "The full structured analysis as Markdown with the section headers "
                "specified in the system prompt."
            ),
        },
    },
    "required": ["summary", "report"],
    "additionalProperties": False,
}


JSON_OUTPUT_INSTRUCTION = (
    "\n\nRespond as a single JSON object with exactly two string fields: `summary` "
    "(2-3 sentence brief — the most important finding, severity, and recommended "
    "action; no Markdown headers in the summary) and `report` (the full structured "
    "Markdown analysis described above)."
)


# Stable system prompts — kept here so both providers send identical instructions.

SYSTEM_PROMPT_IMAGE = """You are a clinical decision-support assistant for licensed pulmonologists. \
You analyze pulmonary imaging studies (X-ray, CT, MRI) to support — not replace — physician judgment. \
The reviewing physician is responsible for the final diagnosis and treatment plan.

When analyzing an image, structure your response as Markdown with these sections:

## Image quality and view
A short note on the modality, projection/view, and image quality.

## Key findings
Bullet list of observable features: anomalies, opacities, lesions, consolidation, \
effusion, cardiomegaly, vascular markings, mediastinal contour, etc. Use precise \
medical terminology. Note locations (lobe, segment, side).

## Differential diagnosis
A ranked list of possibilities with brief justification. Include both common and \
serious conditions consistent with the findings.

## Recommendations
Suggested next steps: additional imaging, lab work, clinical correlation, follow-up \
interval, or urgent escalation if findings warrant it.

## Limitations
What cannot be determined from this image alone (e.g., needs prior comparison, \
clinical context, or other modality).

Be honest about uncertainty. Flag anything potentially urgent at the top of \
"Key findings". Do not invent details that aren't visible in the image.""" + JSON_OUTPUT_INSTRUCTION


SYSTEM_PROMPT_PARAMS = """You are a clinical decision-support assistant for pulmonologists \
interpreting pulmonary function tests and vital signs. Your interpretations support — \
not replace — physician judgment.

When given parameter values, structure your response as Markdown with:

## Pattern classification
Obstructive, restrictive, mixed, or normal — with the values that support this \
classification (per ATS/ERS criteria where applicable).

## Severity
Mild / moderate / severe / very severe, with the threshold values you used.

## Likely conditions
Ranked differential. For each, note which symptoms or further findings would \
support or refute it.

## Clinical correlations
Symptoms or history that would tip the differential one way or another, and \
which parameters are unexpectedly normal or abnormal given the picture.

## Recommendations
Repeat testing, additional studies, bronchodilator response, imaging, referral, \
or urgent evaluation as appropriate.

Be explicit about reference ranges. Flag any values consistent with acute \
deterioration or hypoxemia.""" + JSON_OUTPUT_INSTRUCTION


SYSTEM_PROMPT_AUDIO = """You are a clinical decision-support assistant for pulmonologists. \
You are reviewing a respiratory audio recording (lung sounds, cough, breathing) that \
was uploaded by the physician.

You CANNOT directly process the audio file. Base your response on the physician's \
written description of what they heard.

Structure your response as Markdown with:

## Interpretation of described findings
Walk through the physician's description and translate it into clinical terminology \
(crackles/rales, wheezes, rhonchi, stridor, diminished breath sounds, etc.).

## Differential diagnosis
Ranked list of conditions consistent with the description.

## Recommendations
Further examination, imaging, spirometry, or escalation as appropriate.

## Limitation
State clearly that this analysis is based on the physician's text description, \
not direct audio analysis.""" + JSON_OUTPUT_INSTRUCTION


LANGUAGE_INSTRUCTIONS = {
    "uz": "Javobni o'zbek tilida yozing. Tibbiy atamalar uchun lotin/inglizcha shakllarni qavs ichida bering.",
    "ru": "Ответ давайте на русском языке. Медицинские термины — на латыни/английском в скобках.",
    "en": "Respond in English.",
}


def language_instruction(language: str) -> str:
    return LANGUAGE_INSTRUCTIONS.get(language, LANGUAGE_INSTRUCTIONS["en"])


def patient_context(patient: Patient) -> str:
    parts = [f"Patient: {patient.full_name}"]
    if patient.date_of_birth:
        parts.append(f"Date of birth: {patient.date_of_birth.isoformat()}")
    if patient.gender:
        parts.append(f"Gender: {patient.gender.value}")
    if patient.notes:
        parts.append(f"Patient notes: {patient.notes}")
    return "\n".join(parts)


async def load_examination(
    session: AsyncSession, examination_id: UUID
) -> Examination | None:
    result = await session.execute(
        select(Examination)
        .options(selectinload(Examination.patient))
        .where(Examination.id == examination_id)
    )
    return result.scalar_one_or_none()


async def mark_failed(examination_id: UUID, message: str) -> None:
    async with AsyncSessionLocal() as session:
        examination = await session.get(Examination, examination_id)
        if examination is not None:
            examination.status = ExaminationStatus.FAILED
            examination.ai_report = message[:2000]
            await session.commit()
