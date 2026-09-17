"""Auth schemas. Response shapes match the scaffold exactly; TokenResponse
gains an additive refresh_token (existing clients read token/user only)."""


from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    email: str
    password: str = Field(min_length=8)  # strength floor; was unchecked in the scaffold
    name: str | None = None


class UserLogin(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    token: str
    user: dict
    refresh_token: str = ""


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str
