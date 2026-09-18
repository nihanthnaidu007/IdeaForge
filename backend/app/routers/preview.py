"""LinkedIn preview route — the backend half of the LinkedIn-accurate preview.

The linter is pure (services/linkedin_preview.py) and free — no provider call,
no usage event. The char limit comes from settings (`linkedin_char_limit`,
default 3000) because feed policy drifts and the UI pack requires the number
be configurable, not hardcoded (UI pack §6.1 check 3, §9.2 #1).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.config import Settings
from app.deps import get_current_user, get_settings_dep
from app.models.preview import LinkedInPreview, PreviewRequest
from app.services.linkedin_preview import lint_for_linkedin

router = APIRouter()


@router.post("/preview/linkedin", response_model=LinkedInPreview)
async def preview_linkedin(
    data: PreviewRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    settings: Settings = Depends(get_settings_dep),
) -> LinkedInPreview:
    return LinkedInPreview(**lint_for_linkedin(data.text, settings.linkedin_char_limit))
