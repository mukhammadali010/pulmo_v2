"""Google Gemini implementation of the AI diagnosis service.

Uses the unified `google-genai` SDK with vision support. The free tier
(15 RPM, 1500 req/day on `gemini-2.5-flash`) is enough for development.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from google import genai
from google.genai import types as genai_types

from app.config import get_settings
from app.db.session import AsyncSessionLocal
from app.models.examination import Examination, ExaminationStatus, ExaminationType
from app.services.ai_common import (
    SYSTEM_PROMPT_AUDIO,
    SYSTEM_PROMPT_IMAGE,
    SYSTEM_PROMPT_PARAMS,
    DiagnosisOutput,
    language_instruction,
    load_examination,
    patient_context,
)
from app.services.storage import examination_file_path

logger = logging.getLogger(__name__)

MAX_TOKENS = 4096

GEMINI_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}

# Gemini supports these audio MIME types directly. For our stored variants
# (e.g. audio/x-wav, audio/x-m4a), we normalize to a canonical form before sending.
GEMINI_AUDIO_MIME_MAP = {
    "audio/wav": "audio/wav",
    "audio/x-wav": "audio/wav",
    "audio/mpeg": "audio/mp3",
    "audio/mp3": "audio/mp3",
    "audio/ogg": "audio/ogg",
    "audio/aac": "audio/aac",
    "audio/flac": "audio/flac",
    "audio/aiff": "audio/aiff",
    "audio/mp4": "audio/aac",
    "audio/m4a": "audio/aac",
    "audio/x-m4a": "audio/aac",
}


async def analyze_examination(examination_id: UUID, language: str = "uz") -> None:
    settings = get_settings()
    client = genai.Client(api_key=settings.google_api_key)

    async with AsyncSessionLocal() as session:
        examination = await load_examination(session, examination_id)
        if examination is None:
            logger.warning("Examination %s not found for analysis", examination_id)
            return

        try:
            if examination.type in (
                ExaminationType.XRAY,
                ExaminationType.CT,
                ExaminationType.MRI,
            ):
                output = await _analyze_image(
                    client, settings.gemini_model, examination, language
                )
            elif examination.type == ExaminationType.PARAMETERS:
                output = await _analyze_parameters(
                    client, settings.gemini_model, examination, language
                )
            elif examination.type == ExaminationType.AUDIO:
                output = await _analyze_audio(
                    client, settings.gemini_model, examination, language
                )
            else:
                raise ValueError(f"Unsupported examination type: {examination.type}")

            examination.ai_summary = output.summary
            examination.ai_report = output.report
            examination.status = ExaminationStatus.DONE
        except Exception as exc:
            logger.exception("Gemini analysis failed for %s", examination_id)
            examination.status = ExaminationStatus.FAILED
            examination.ai_summary = None
            examination.ai_report = f"AI analysis failed: {exc!s}"[:2000]

        await session.commit()


async def _analyze_image(
    client: genai.Client, model: str, examination: Examination, language: str
) -> DiagnosisOutput:
    if not examination.attachment_filename or not examination.attachment_mime:
        raise ValueError("Image examination has no attachment")
    if examination.attachment_mime not in GEMINI_IMAGE_MIMES:
        raise ValueError(
            f"Image MIME type {examination.attachment_mime} is not supported by Gemini"
        )

    image_path = examination_file_path(examination.attachment_filename)
    if image_path is None:
        raise ValueError("Image file not found on disk")

    image_part = genai_types.Part.from_bytes(
        data=image_path.read_bytes(), mime_type=examination.attachment_mime
    )

    type_label = {
        ExaminationType.XRAY: "Chest X-ray",
        ExaminationType.CT: "CT scan",
        ExaminationType.MRI: "MRI scan",
    }[examination.type]

    user_text = (
        f"Examination type: {type_label}\n\n"
        f"{patient_context(examination.patient)}\n\n"
        f"Physician's notes: {examination.notes or '(none provided)'}\n\n"
        f"Please analyze this image.\n\n{language_instruction(language)}"
    )

    response = await client.aio.models.generate_content(
        model=model,
        contents=[image_part, user_text],
        config=_json_config(SYSTEM_PROMPT_IMAGE, MAX_TOKENS),
    )

    return _parse_output(response)


async def _analyze_parameters(
    client: genai.Client, model: str, examination: Examination, language: str
) -> DiagnosisOutput:
    if not examination.parameters:
        raise ValueError("Parameter examination has no parameters")

    param_lines = "\n".join(f"- {k}: {v}" for k, v in examination.parameters.items())

    user_text = (
        f"{patient_context(examination.patient)}\n\n"
        f"Pulmonary function and vital sign parameters:\n{param_lines}\n\n"
        f"Physician's notes: {examination.notes or '(none provided)'}\n\n"
        f"Please interpret these values.\n\n{language_instruction(language)}"
    )

    response = await client.aio.models.generate_content(
        model=model,
        contents=user_text,
        config=_json_config(SYSTEM_PROMPT_PARAMS, MAX_TOKENS),
    )

    return _parse_output(response)


async def _analyze_audio(
    client: genai.Client, model: str, examination: Examination, language: str
) -> DiagnosisOutput:
    if not examination.attachment_filename or not examination.attachment_mime:
        raise ValueError("Audio examination has no attachment")

    gemini_mime = GEMINI_AUDIO_MIME_MAP.get(examination.attachment_mime)
    if gemini_mime is None:
        raise ValueError(
            f"Audio MIME type {examination.attachment_mime} is not supported by Gemini"
        )

    audio_path = examination_file_path(examination.attachment_filename)
    if audio_path is None:
        raise ValueError("Audio file not found on disk")

    audio_part = genai_types.Part.from_bytes(
        data=audio_path.read_bytes(), mime_type=gemini_mime
    )

    user_text = (
        f"{patient_context(examination.patient)}\n\n"
        f"Physician's notes (supplementary context, may be empty): "
        f"{examination.notes or '(none provided)'}\n\n"
        f"Listen to the attached respiratory audio recording and analyze the "
        f"acoustic findings directly.\n\n"
        f"{language_instruction(language)}"
    )

    response = await client.aio.models.generate_content(
        model=model,
        contents=[audio_part, user_text],
        config=_json_config(SYSTEM_PROMPT_AUDIO, MAX_TOKENS),
    )

    return _parse_output(response)


def _json_config(system: str, max_tokens: int) -> genai_types.GenerateContentConfig:
    """Use Gemini's structured output to force a {summary, report} JSON shape.

    Disable thinking: on Gemini 2.5 Flash, thinking tokens count toward
    max_output_tokens and routinely truncate JSON responses mid-string.
    Structured output is reasoning-bounded already, so we don't need thinking.
    """
    return genai_types.GenerateContentConfig(
        system_instruction=system,
        max_output_tokens=max_tokens,
        response_mime_type="application/json",
        response_schema=DiagnosisOutput,
        thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
    )


def _parse_output(response) -> DiagnosisOutput:
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, DiagnosisOutput):
        return parsed
    text = getattr(response, "text", None)
    if not text:
        raise ValueError("Gemini returned no content")
    try:
        data = json.loads(text)
        return DiagnosisOutput.model_validate(data)
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"Gemini returned malformed JSON: {exc}") from exc
