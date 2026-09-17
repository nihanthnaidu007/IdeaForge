"""Post generation schemas."""


from pydantic import BaseModel


class GeneratePostRequest(BaseModel):
    idea: dict
    format: str
    tone: str = "professional"
    custom_instructions: str | None = ""
    insights: dict | None = None


class TweakPostRequest(BaseModel):
    original_post: str
    tweak_instruction: str
    idea: dict
    format: str


class PostResponse(BaseModel):
    post: str
