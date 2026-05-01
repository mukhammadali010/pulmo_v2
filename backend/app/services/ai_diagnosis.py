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
from app.services.ai_common import mark_failed

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
