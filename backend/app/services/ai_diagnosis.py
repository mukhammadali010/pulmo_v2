"""Public AI-diagnosis facade. Dispatches to whichever provider is configured.

Selection rules (settings.ai_provider):
  - "anthropic" → always use Claude (requires ANTHROPIC_API_KEY)
  - "gemini"    → always use Gemini   (requires GOOGLE_API_KEY)
  - "auto"      → use whichever key is set; if both, prefer Gemini (free tier)
"""

from __future__ import annotations

import logging
from uuid import UUID

from app.config import get_settings
from app.services.ai_common import mark_failed, mark_final_failed

logger = logging.getLogger(__name__)


async def analyze_examination(examination_id: UUID, language: str = "uz") -> None:
    settings = get_settings()
    provider = _resolve_provider(settings.ai_provider, settings.google_api_key, settings.anthropic_api_key)

    if provider == "gemini":
        from app.services import ai_gemini

        await ai_gemini.analyze_examination(examination_id, language)
    elif provider == "anthropic":
        from app.services import ai_claude

        await ai_claude.analyze_examination(examination_id, language)
    else:
        message = (
            "AI service is not configured. Set GOOGLE_API_KEY (free tier at "
            "https://aistudio.google.com/app/apikey) or ANTHROPIC_API_KEY."
        )
        logger.error(message)
        await mark_failed(examination_id, message)


async def analyze_final_diagnosis(
    final_diagnosis_id: UUID, language: str = "uz"
) -> None:
    """MVP: synthesis is Gemini-only. Claude support can be added later.

    Synthesis consumes the per-examination Markdown reports (already produced),
    so it works even when the per-examination provider was Claude — but it
    requires GOOGLE_API_KEY for the synthesis step itself.
    """
    settings = get_settings()
    if not settings.google_api_key:
        message = (
            "Final-diagnosis synthesis requires GOOGLE_API_KEY (Gemini). "
            "Get a free key at https://aistudio.google.com/app/apikey."
        )
        logger.error(message)
        await mark_final_failed(final_diagnosis_id, message)
        return

    from app.services import ai_final_diagnosis

    await ai_final_diagnosis.analyze_final_diagnosis(final_diagnosis_id, language)


def _resolve_provider(
    setting: str, google_key: str | None, anthropic_key: str | None
) -> str | None:
    if setting == "gemini" and google_key:
        return "gemini"
    if setting == "anthropic" and anthropic_key:
        return "anthropic"
    if setting == "auto":
        if google_key:
            return "gemini"
        if anthropic_key:
            return "anthropic"
    return None
