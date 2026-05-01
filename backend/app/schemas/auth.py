from pydantic import BaseModel, ConfigDict, EmailStr, Field
from pydantic.alias_generators import to_camel

from app.schemas.user import UserRead


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class LoginRequest(_CamelModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class RegisterRequest(_CamelModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)


class RefreshRequest(_CamelModel):
    refresh_token: str


class TokenPair(_CamelModel):
    access_token: str
    refresh_token: str


class AuthResponse(_CamelModel):
    access_token: str
    refresh_token: str
    user: UserRead
