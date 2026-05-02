"""Anthropic Claude implementation of the AI diagnosis service."""

from __future__ import annotations

import base64
import json
import logging
from uuid import UUID

from anthropic import APIError, AsyncAnthropic

from app.config import get_settings
from app.db.session import AsyncSessionLocal
from app.models.examination import Examination, ExaminationStatus, ExaminationType
from app.services.ai_common import (
    DIAGNOSIS_JSON_SCHEMA,
    SYSTEM_PROMPT_AUDIO_TEXT_ONLY,
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
CLAUDE_IMAGE_MIMES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


async def analyze_examination(examination_id: UUID, language: str = "uz") -> None:
    settings = get_settings()
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

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
                    client, settings.anthropic_model, examination, language
                )
            elif examination.type == ExaminationType.PARAMETERS:
                output = await _analyze_parameters(
                    client, settings.anthropic_model, examination, language
                )
            elif examination.type == ExaminationType.AUDIO:
                output = await _analyze_audio(
                    client, settings.anthropic_model, examination, language
                )
            else:
                raise ValueError(f"Unsupported examination type: {examination.type}")

            examination.ai_summary = output.summary
            examination.ai_report = output.report
            examination.status = ExaminationStatus.DONE
        except APIError as exc:
            logger.exception("Anthropic API error analyzing %s", examination_id)
            examination.status = ExaminationStatus.FAILED
            examination.ai_summary = None
            examination.ai_report = f"AI analysis failed: {exc!s}"[:2000]
        except Exception as exc:
            logger.exception("Unexpected error analyzing %s", examination_id)
            examination.status = ExaminationStatus.FAILED
            examination.ai_summary = None
            examination.ai_report = f"AI analysis failed: {exc!s}"[:2000]

        await session.commit()


async def _analyze_image(
    client: AsyncAnthropic, model: str, examination: Examination, language: str
) -> DiagnosisOutput:
    if not examination.attachment_filename or not examination.attachment_mime:
        raise ValueError("Image examination has no attachment")
    if examination.attachment_mime not in CLAUDE_IMAGE_MIMES:
        raise ValueError(
            f"Image MIME type {examination.attachment_mime} is not supported by Claude vision"
        )

    image_path = examination_file_path(examination.attachment_filename)
    if image_path is None:
        raise ValueError("Image file not found on disk")

    image_b64 = base64.standard_b64encode(image_path.read_bytes()).decode("ascii")

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

    response = await client.messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        thinking={"type": "adaptive"},
        output_config={
            "effort": "high",
            "format": {"type": "json_schema", "schema": DIAGNOSIS_JSON_SCHEMA},
        },
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT_IMAGE,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": examination.attachment_mime,
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": user_text},
                ],
            }
        ],
    )

    return _parse_output(response)


async def _analyze_parameters(
    client: AsyncAnthropic, model: str, examination: Examination, language: str
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

    response = await client.messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        thinking={"type": "adaptive"},
        output_config={
            "effort": "high",
            "format": {"type": "json_schema", "schema": DIAGNOSIS_JSON_SCHEMA},
        },
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT_PARAMS,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_text}],
    )

    return _parse_output(response)


async def _analyze_audio(
    client: AsyncAnthropic, model: str, examination: Examination, language: str
) -> DiagnosisOutput:
    user_text = (
        f"{patient_context(examination.patient)}\n\n"
        f"Physician's description of the recording: "
        f"{examination.notes or '(no description provided)'}\n\n"
        f"{language_instruction(language)}"
    )

    response = await client.messages.create(
        model=model,
        max_tokens=MAX_TOKENS // 2,
        thinking={"type": "adaptive"},
        output_config={
            "effort": "medium",
            "format": {"type": "json_schema", "schema": DIAGNOSIS_JSON_SCHEMA},
        },
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT_AUDIO_TEXT_ONLY,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_text}],
    )

    return _parse_output(response)


def _parse_output(response) -> DiagnosisOutput:
    text_parts = [block.text for block in response.content if block.type == "text"]
    raw = "\n".join(text_parts).strip()
    if not raw:
        raise ValueError("Claude returned no content")
    data = json.loads(raw)
    return DiagnosisOutput.model_validate(data)
