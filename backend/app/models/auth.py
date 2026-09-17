"""Auth schemas. Response shapes match the scaffold exactly; TokenResponse
gains an additive refresh_token (existing clients read token/user only)."""


from pydantic import BaseModel, EmailStr, Field, field_validator

_BCRYPT_MAX_BYTES = 72  # bcrypt silently truncates input beyond 72 bytes


class _EmailCredentials(BaseModel):
    """Shared email/password contract for register + login (M4 bounds, L1
    canonicalization)."""

    email: EmailStr
    password: str

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        # L1: case-preserved addresses let one mailbox hold many accounts and
        # make duplicate-email checks meaningless. Canonical form: stripped,
        # lower-cased — applied before EmailStr validation so both routes see
        # identical input.
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("password")
    @classmethod
    def _bcrypt_cap(cls, value: str) -> str:
        # L3: guard the byte cap, not the character count — multibyte
        # characters make short strings exceed bcrypt's 72-byte input limit.
        if len(value.encode("utf-8")) > _BCRYPT_MAX_BYTES:
            raise ValueError("password must be at most 72 bytes")
        return value


class UserCreate(_EmailCredentials):
    # min 8 = strength floor; max 72 = bcrypt's input cap (L3).
    password: str = Field(min_length=8, max_length=_BCRYPT_MAX_BYTES)
    name: str | None = Field(default=None, max_length=100)


class UserLogin(_EmailCredentials):
    # Login enforces only non-empty — registration policy is not a login check.
    password: str = Field(min_length=1, max_length=_BCRYPT_MAX_BYTES)


class TokenResponse(BaseModel):
    token: str
    user: dict
    refresh_token: str = ""


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=4096)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=4096)
