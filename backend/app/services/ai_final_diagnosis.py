"""Multi-modal synthesis: combines existing examination reports into one
unified `FinalDiagnosis`. Currently Gemini-only — Claude support can be added
later by branching on settings.ai_provider, mirroring `ai_diagnosis.py`.

Synthesis does NOT re-process raw images/audio. It consumes the per-examination
`ai_report` Markdown that was produced earlier and asks the model to produce
ONE structured conclusion across modalities.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from google.genai import types as genai_types

from app.config import get_settings
from app.db.session import AsyncSessionLocal
from app.models.examination import Examination, ExaminationStatus, ExaminationType
from app.models.final_diagnosis import (
    FinalDiagnosis,
    FinalDiagnosisConfidence,
    FinalDiagnosisUrgency,
)
from app.services.ai_common import (
    SYSTEM_PROMPT_FINAL_DIAGNOSIS,
    FinalDiagnosisOutput,
    gemini_configured,
    generate_with_gemini,
    language_instruction,
    load_final_diagnosis,
    mark_final_failed,
    patient_context,
)

logger = logging.getLogger(__name__)

MAX_TOKENS = 6144  # Synthesis output is richer than per-modality reports.

_TYPE_LABEL = {
    ExaminationType.XRAY: "Chest X-ray",
    ExaminationType.CT: "CT scan",
    ExaminationType.MRI: "MRI scan",
    ExaminationType.AUDIO: "Respiratory audio",
    ExaminationType.PARAMETERS: "Pulmonary parameters",
    ExaminationType.CLINICAL_SCALE: "Clinical scoring scale",
}

_CLINICAL_SCALE_LABEL = {
    "crb_65": "CRB-65 (CAP severity)",
    "cat": "CAT (COPD Assessment Test)",
    "gina_severity": "GINA asthma exacerbation severity",
    "mmrc": "mMRC dyspnea grade",
    "gold_stage": "GOLD COPD spirometric stage",
}


async def analyze_final_diagnosis(
    final_diagnosis_id: UUID, language: str = "uz"
) -> None:
    settings = get_settings()
    if not gemini_configured(settings):
        await mark_final_failed(
            final_diagnosis_id,
            "Gemini is not configured. Set GOOGLE_API_KEY, or set "
            "GOOGLE_GENAI_USE_VERTEXAI=true with GOOGLE_CLOUD_PROJECT, to enable "
            "final-diagnosis synthesis.",
        )
        return

    async with AsyncSessionLocal() as session:
        final = await load_final_diagnosis(session, final_diagnosis_id)
        if final is None:
            logger.warning("FinalDiagnosis %s not found for synthesis", final_diagnosis_id)
            return

        try:
            _validate_inputs(final)
            user_text = _build_user_text(final, language)

            response = await generate_with_gemini(
                lambda c: c.aio.models.generate_content(
                    model=settings.gemini_model,
                    contents=user_text,
                    config=_json_config(SYSTEM_PROMPT_FINAL_DIAGNOSIS, MAX_TOKENS),
                ),
                label="final-synthesis",
            )
            output = _parse_output(response)

            final.ai_payload = output.model_dump(mode="json")
            final.ai_summary = output.summary
            final.ai_report = output.report_markdown
            final.primary_diagnosis = output.primary_diagnosis
            final.icd10 = output.icd10
            final.confidence = FinalDiagnosisConfidence(output.confidence)
            final.urgency = FinalDiagnosisUrgency(output.urgency)
            final.error_message = None
            final.status = ExaminationStatus.DONE
        except Exception as exc:
            logger.exception("Final-diagnosis synthesis failed for %s", final_diagnosis_id)
            final.status = ExaminationStatus.FAILED
            final.error_message = f"Synthesis failed: {exc!s}"[:2000]

        await session.commit()


def _validate_inputs(final: FinalDiagnosis) -> None:
    if not final.examinations:
        raise ValueError("Final diagnosis has no source examinations")
    not_done = [
        e for e in final.examinations if e.status != ExaminationStatus.DONE
    ]
    if not_done:
        ids = ", ".join(str(e.id) for e in not_done)
        raise ValueError(f"Source examinations not analyzed yet: {ids}")
    # Clinical-scale examinations are deterministic (no AI step) so they have
    # ai_report=None by design — exempt them from the report-required check.
    no_report = [
        e
        for e in final.examinations
        if not e.ai_report and e.type != ExaminationType.CLINICAL_SCALE
    ]
    if no_report:
        ids = ", ".join(str(e.id) for e in no_report)
        raise ValueError(f"Source examinations missing AI report: {ids}")


def _build_user_text(final: FinalDiagnosis, language: str) -> str:
    parts: list[str] = [patient_context(final.patient)]

    if final.clinical_context:
        parts.append(f"Physician's clinical context: {final.clinical_context}")
    else:
        parts.append("Physician's clinical context: (none provided)")

    parts.append(
        f"Below are {len(final.examinations)} independent AI analyses for this patient. "
        "Treat each as a separate observation source. Synthesize them into ONE unified "
        "conclusion — do not re-interpret raw data, you only have the prior reports."
    )

    for idx, exam in enumerate(_sorted_for_prompt(final.examinations), start=1):
        label = _TYPE_LABEL.get(exam.type, exam.type.value)
        date = exam.created_at.date().isoformat() if exam.created_at else "unknown date"
        if exam.type == ExaminationType.CLINICAL_SCALE:
            block = _format_clinical_scale_block(exam, idx, date)
        else:
            block = (
                f"=== Examination {idx} — {label} ({date}) ===\n"
                f"Summary: {exam.ai_summary or '(no summary)'}\n"
                f"Full report:\n{exam.ai_report}"
            )
        parts.append(block)

    parts.append(language_instruction(language))
    return "\n\n".join(parts)


def _format_clinical_scale_block(exam: Examination, idx: int, date: str) -> str:
    """Render a clinical-scale examination as a structured prompt block.

    Clinical scales are deterministic and have no `ai_report`, so we project
    their JSONB result (score, severity, breakdown, recommendation) into a
    block the synthesis model can cite alongside imaging/audio/parameter
    reports. The breakdown matters: it tells the model which criteria
    actually contributed (e.g. "Age ≥65 contributed 1 point") so the model
    can reason about the score, not just quote it.
    """
    p = exam.parameters or {}
    scale_type = str(p.get("scaleType", "unknown"))
    scale_label = _CLINICAL_SCALE_LABEL.get(scale_type, scale_type)
    score = p.get("score", "?")
    score_max = p.get("scoreMax", "?")
    severity = p.get("severity", "unknown")
    severity_label = p.get("severityLabel", severity)
    recommendation = p.get("recommendation", "(no recommendation)")
    reference = p.get("reference", "")

    breakdown_lines: list[str] = []
    for item in p.get("breakdown", []):
        key = item.get("key", "?")
        label_en = item.get("labelEn", key)
        value = item.get("value")
        points = item.get("points", 0)
        missing = item.get("missing", False)
        line = f"  - {label_en}: value={value}, points=+{points}"
        if missing:
            line += " (NOT MEASURED)"
        breakdown_lines.append(line)
    breakdown_text = "\n".join(breakdown_lines) if breakdown_lines else "  (no breakdown)"

    return (
        f"=== Examination {idx} — Clinical scoring scale ({date}) ===\n"
        f"Scale: {scale_label}\n"
        f"Score: {score}/{score_max} — {severity} ({severity_label})\n"
        f"Per-criterion breakdown:\n{breakdown_text}\n"
        f"Built-in recommendation: {recommendation}\n"
        f"Reference: {reference}"
    )


def _sorted_for_prompt(examinations: list[Examination]) -> list[Examination]:
    """Stable order: image → audio → parameters, then by created_at within each group.

    Helps the model anchor on the same modality order across runs and makes the
    consensus map (image/audio/parameters) easier to fill consistently.
    """
    type_order = {
        ExaminationType.XRAY: 0,
        ExaminationType.CT: 0,
        ExaminationType.MRI: 0,
        ExaminationType.AUDIO: 1,
        ExaminationType.PARAMETERS: 2,
        ExaminationType.CLINICAL_SCALE: 3,
    }
    return sorted(
        examinations,
        key=lambda e: (type_order.get(e.type, 99), e.created_at or 0),
    )


def _json_config(system: str, max_tokens: int) -> genai_types.GenerateContentConfig:
    return genai_types.GenerateContentConfig(
        system_instruction=system,
        max_output_tokens=max_tokens,
        response_mime_type="application/json",
        response_schema=FinalDiagnosisOutput,
        thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
    )


def _parse_output(response) -> FinalDiagnosisOutput:
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, FinalDiagnosisOutput):
        return parsed
    text = getattr(response, "text", None)
    if not text:
        raise ValueError("Gemini returned no content")
    try:
        data = json.loads(text)
        return FinalDiagnosisOutput.model_validate(data)
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"Gemini returned malformed JSON: {exc}") from exc
