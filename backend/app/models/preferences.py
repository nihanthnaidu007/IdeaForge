"""User preferences / BYOK key schemas.

Keys are accepted as plaintext in the request (unavoidable — the user is
handing us a key) and stored only as envelope-encrypted blobs; responses
expose ``has_*_key`` booleans exactly as the scaffold did, never key material.
"""


from pydantic import BaseModel


class PreferencesUpdate(BaseModel):
    default_tone: str | None = None
    default_niche: str | None = None
    tavily_api_key: str | None = None
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
