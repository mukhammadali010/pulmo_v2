"""Provider-agnostic helpers and prompts shared across the AI backends.

Both `ai_claude.py` and `ai_gemini.py` import from here so the system prompts
and DB plumbing are not duplicated.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings, get_settings
from app.db.session import AsyncSessionLocal
from app.models.examination import Examination, ExaminationStatus
from app.models.final_diagnosis import FinalDiagnosis
from app.models.patient import Patient

logger = logging.getLogger(__name__)


T = TypeVar("T")


def gemini_configured(settings: Settings) -> bool:
    """Whether a Gemini client can be constructed from current settings."""
    if settings.google_genai_use_vertexai:
        return bool(settings.google_cloud_project)
    return bool(settings.google_api_key)


def make_genai_client():
    """Create a `google-genai` client in either AI Studio or Vertex AI mode.

    Vertex mode authenticates through Application Default Credentials and routes
    calls through the configured Google Cloud project, sidestepping the regional
    blocks that the AI Studio endpoint applies to some countries.
    """
    from google import genai

    settings = get_settings()
    if settings.google_genai_use_vertexai:
        if not settings.google_cloud_project:
            raise ValueError(
                "GOOGLE_CLOUD_PROJECT is required when GOOGLE_GENAI_USE_VERTEXAI=true"
            )
        return genai.Client(
            vertexai=True,
            project=settings.google_cloud_project,
            location=settings.google_cloud_location,
        )
    if not settings.google_api_key:
        raise ValueError("GOOGLE_API_KEY is required when GOOGLE_GENAI_USE_VERTEXAI=false")
    return genai.Client(api_key=settings.google_api_key)

# 5xx and 429 are transient — retry. Other 4xx are caller errors — don't retry.
_RETRY_STATUS_CODES = {429, 500, 502, 503, 504}
_DEFAULT_MAX_RETRIES = 3
_BASE_BACKOFF_S = 1.5


async def call_gemini_with_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    label: str,
    max_retries: int = _DEFAULT_MAX_RETRIES,
) -> T:
    """Run a Gemini API call with exponential backoff on transient errors.

    Gemini 2.5 Flash regularly returns 503 UNAVAILABLE during demand spikes;
    treating those as a hard failure surfaces a confusing error to the doctor
    when a single retry would have succeeded.
    """
    from google.genai.errors import APIError

    attempt = 0
    while True:
        try:
            return await fn()
        except APIError as exc:
            code = getattr(exc, "code", None)
            if code not in _RETRY_STATUS_CODES or attempt >= max_retries:
                raise
            wait = _BASE_BACKOFF_S * (2**attempt)
            logger.warning(
                "Gemini %s transient error (code=%s, attempt=%d/%d); retrying in %.1fs",
                label,
                code,
                attempt + 1,
                max_retries,
                wait,
            )
            await asyncio.sleep(wait)
            attempt += 1


class DiagnosisOutput(BaseModel):
    """Structured AI response — used as the JSON schema for both providers."""

    summary: str
    report: str


# ---- Final (multi-modal synthesis) AI output schema ----

ConfidenceLevel = Literal["low", "moderate", "high"]
UrgencyLevel = Literal["green", "yellow", "red"]
ModalityVerdict = Literal["support", "contradict", "silent"]
ModalityName = Literal["image", "audio", "parameters"]
LobeRegion = Literal[
    "left_upper",
    "left_lower",
    "right_upper",
    "right_middle",
    "right_lower",
    "bilateral",
    "pleural",
    "mediastinal",
    "airways",
]
SeverityLevel = Literal["mild", "moderate", "severe"]


class AffectedRegion(BaseModel):
    """One anatomical region implicated by the synthesized findings."""

    region: LobeRegion
    finding: str = Field(
        description=(
            "Short clinical phrase describing what was found in this region "
            "(e.g., 'consolidation', 'honeycombing', 'ground-glass opacity', "
            "'effusion', 'atelectasis')."
        ),
    )
    severity: SeverityLevel
    modalities: list[ModalityName] = Field(
        default_factory=list,
        description="Which input modalities supported this localization.",
    )


class DifferentialItem(BaseModel):
    rank: int = Field(description="1 = most likely. Lower rank = higher likelihood.")
    diagnosis: str
    probability: ConfidenceLevel
    supports: list[ModalityName] = Field(
        default_factory=list,
        description="Modalities whose findings support this diagnosis.",
    )
    contradicts: list[ModalityName] = Field(
        default_factory=list,
        description="Modalities whose findings contradict this diagnosis.",
    )


class ModalityConsensus(BaseModel):
    verdict: ModalityVerdict
    note: str = Field(description="One-sentence rationale for the verdict.")


class ModalityConsensusMap(BaseModel):
    """Per-modality verdict. A modality omitted from the input set should be 'silent'."""

    image: ModalityConsensus
    audio: ModalityConsensus
    parameters: ModalityConsensus


class FinalDiagnosisOutput(BaseModel):
    """Structured AI response for the unified multi-modal diagnosis."""

    summary: str = Field(
        description="2–3 sentence brief: top diagnosis, confidence, urgency, key next step."
    )
    primary_diagnosis: str
    icd10: str | None = Field(default=None, description="ICD-10 code if confidently inferable.")
    confidence: ConfidenceLevel
    urgency: UrgencyLevel
    differential: list[DifferentialItem] = Field(
        description="Ranked differential, 1–4 items, top first.",
    )
    modality_consensus: ModalityConsensusMap
    recommended_next_steps: list[str] = Field(
        description="Concrete next actions, ordered by priority.",
    )
    limitations: list[str] = Field(
        default_factory=list,
        description="What the synthesis cannot resolve and what was not collected.",
    )
    affected_regions: list[AffectedRegion] = Field(
        default_factory=list,
        description=(
            "Anatomical lung regions implicated by the synthesized findings, "
            "drawn from the controlled vocabulary. Empty list if the modalities "
            "do not localize the disease to a specific region."
        ),
    )
    report_markdown: str = Field(
        description="Full Markdown report with the section headers specified in the system prompt.",
    )


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
You are listening to a respiratory audio recording (lung sounds, cough, breathing, \
heart-lung auscultation) that was uploaded by the physician.

LISTEN to the audio directly and analyze the acoustic findings yourself. The \
physician's notes (if any) are supplementary context only — your interpretation \
must come from what you actually hear.

Structure your response as Markdown with:

## Acoustic findings
What you hear in the recording, in clinical terminology: crackles/rales (fine, \
medium, coarse — inspiratory or expiratory), wheezes (monophonic vs polyphonic, \
inspiratory vs expiratory), rhonchi, stridor, pleural friction rub, diminished \
or absent breath sounds, cough character (productive vs dry, paroxysmal, \
brassy, whooping), respiratory rate and rhythm, audible pleural or cardiac sounds. \
Note timing within the respiratory cycle and lateralization if discernible. \
If the recording is too noisy, too short, or contains no respiratory sounds, \
say so explicitly here.

## Recording quality
Brief note on signal clarity, background noise, duration, and whether the \
quality is sufficient for interpretation.

## Differential diagnosis
Ranked list of conditions consistent with the acoustic findings — pneumonia, \
bronchitis, asthma exacerbation, COPD, pulmonary fibrosis, pleural effusion, \
pneumothorax, pertussis, croup, etc. Tie each to the specific sounds that \
support it.

## Recommendations
Suggested next steps: imaging (chest X-ray, CT), spirometry, sputum culture, \
clinical correlation, or urgent escalation if findings warrant it.

## Limitations
What the audio alone cannot determine — the physician's physical exam, history, \
and other studies remain essential. Flag explicitly if audio quality limits \
confident interpretation.

Be honest about uncertainty. If you cannot identify a specific finding with \
confidence, say so rather than inventing details.""" + JSON_OUTPUT_INSTRUCTION


SYSTEM_PROMPT_FINAL_DIAGNOSIS = """You are a senior pulmonology consultant performing multi-modal SYNTHESIS. \
You receive N independent AI analyses (some combination of imaging, audio, and pulmonary \
parameters) for ONE patient and must produce ONE unified clinical conclusion.

CRITICAL RULES:
- Synthesize, do NOT re-diagnose. You do NOT have access to the raw images/audio/raw values. \
  You only have the prior AI reports. Do not invent findings that are not in those reports.
- Cite which modality supports each claim using bracket tags, e.g. \
  "consolidation [image]; coarse crackles [audio]; mild restrictive pattern [parameters]".
- If modalities CONFLICT on a finding, name the conflict explicitly and state which signal \
  is more reliable for the candidate diagnosis and why.
- If a modality was NOT provided for this patient, mark it "silent" in modality_consensus \
  and do not penalize confidence for its absence — but reflect the gap in `limitations`.
- Confidence reflects how strongly the COMBINED evidence supports your top diagnosis: \
  `low` = single weak signal, `moderate` = one strong or two concordant signals, \
  `high` = concordant signal in two or more modalities with no significant contradiction.
- Urgency: `green` (routine follow-up), `yellow` (expedited evaluation within days), \
  `red` (urgent — same-day or ED). Err on the side of higher urgency when any modality \
  flags an acute or life-threatening finding.
- The differential must be ranked 1..N (1 = most likely). Include 1–4 items.
- ICD-10 only if confidently inferable from the synthesized picture; otherwise null.
- `affected_regions` MUST list every anatomical region implicated by the input \
  reports, using ONLY this controlled vocabulary: \
  `left_upper`, `left_lower`, `right_upper`, `right_middle`, `right_lower`, \
  `bilateral`, `pleural`, `mediastinal`, `airways`. \
  For each region, provide: `finding` (one short clinical phrase, e.g. \
  "consolidation", "honeycombing", "ground-glass opacity", "effusion"), \
  `severity` (mild | moderate | severe), and `modalities` (which inputs \
  localized this finding — image / audio / parameters). \
  Use `bilateral` only when the finding is diffuse and clearly involves both \
  lungs without a dominant lobe. If the inputs do not localize the disease \
  to any specific region, return an empty list.

Structure the `report_markdown` field as Markdown with these sections:

## Final diagnosis
One line: the primary diagnosis.

## Differential
Ranked list (1–4). For each item, list the supporting and contradicting modalities.

## Modality consensus
For image, audio, and parameters: state support / contradict / silent + one sentence why.

## Confidence and rationale
Low / moderate / high + the reasoning that justifies that level.

## Urgency
Green / yellow / red + the reasoning.

## Recommended next steps
Concrete next actions, ordered by priority.

## Affected regions
Brief enumeration of the lung regions implicated and the modality that supports each. \
Mirror the structured `affected_regions` field — one bullet per region.

## Limitations
What synthesis cannot resolve and what was not collected.

The `summary` field is a 2–3 sentence brief: top diagnosis, confidence, urgency, and key \
next step. Plain text, no Markdown headers in the summary.""" + JSON_OUTPUT_INSTRUCTION


SYSTEM_PROMPT_AUDIO_TEXT_ONLY = """You are a clinical decision-support assistant for pulmonologists. \
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
    "uz": (
        "CRITICAL: The ENTIRE response — including the `summary` field, all Markdown "
        "section headings (the `## Heading` lines), every bullet, and every sentence "
        "of the `report` field — MUST be written in Uzbek (o'zbek tili, lotin yozuvi). "
        "Translate the section headings shown in the system prompt into Uzbek. "
        "DO NOT mix English or Russian into headings or body. The only exception: "
        "established medical terms may be given in Latin/English inside parentheses "
        "after the Uzbek translation, e.g. \"sotali o'pka (honeycombing)\". "
        "If you output any heading or paragraph in English or Russian, the response "
        "is INVALID."
    ),
    "ru": (
        "CRITICAL: ВЕСЬ ответ — включая поле `summary`, все Markdown-заголовки разделов "
        "(строки `## Заголовок`), каждый пункт списка и каждое предложение поля `report` — "
        "ДОЛЖЕН быть написан на русском языке. Переведите заголовки разделов из системного "
        "промпта на русский. НЕ смешивайте английский или узбекский в заголовках или тексте. "
        "Единственное исключение: устоявшиеся медицинские термины можно указывать на "
        "латыни/английском в скобках после русского эквивалента, например "
        "«сотовое лёгкое (honeycombing)». Если хотя бы один заголовок или абзац выйдет на "
        "английском или узбекском — ответ НЕДЕЙСТВИТЕЛЕН."
    ),
    "en": (
        "Respond entirely in English — both the summary and every section of the report "
        "(headings, bullets, prose). Use the section headings as written in this system prompt."
    ),
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


async def load_final_diagnosis(
    session: AsyncSession, final_diagnosis_id: UUID
) -> FinalDiagnosis | None:
    result = await session.execute(
        select(FinalDiagnosis)
        .options(
            selectinload(FinalDiagnosis.patient),
            selectinload(FinalDiagnosis.examinations),
        )
        .where(FinalDiagnosis.id == final_diagnosis_id)
    )
    return result.scalar_one_or_none()


async def mark_final_failed(final_diagnosis_id: UUID, message: str) -> None:
    async with AsyncSessionLocal() as session:
        final = await session.get(FinalDiagnosis, final_diagnosis_id)
        if final is not None:
            final.status = ExaminationStatus.FAILED
            final.error_message = message[:2000]
            await session.commit()
