from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from app.config import get_settings

_settings = get_settings()
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

TokenType = Literal["access", "refresh"]


class TokenPayload(BaseModel):
    sub: str
    type: TokenType
    exp: int


def hash_password(plain: str) -> str:
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


def _create_token(subject: UUID | str, token_type: TokenType, expires_delta: timedelta) -> str:
    expire = datetime.now(UTC) + expires_delta
    payload = {
        "sub": str(subject),
        "type": token_type,
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, _settings.jwt_secret, algorithm=_settings.jwt_algorithm)


def create_access_token(subject: UUID | str) -> str:
    return _create_token(
        subject,
        "access",
        timedelta(minutes=_settings.access_token_expire_minutes),
    )


def create_refresh_token(subject: UUID | str) -> str:
    return _create_token(
        subject,
        "refresh",
        timedelta(days=_settings.refresh_token_expire_days),
    )


def decode_token(token: str, expected_type: TokenType) -> TokenPayload:
    try:
        raw = jwt.decode(token, _settings.jwt_secret, algorithms=[_settings.jwt_algorithm])
    except JWTError as e:
        raise ValueError("Invalid token") from e

    payload = TokenPayload.model_validate(raw)
    if payload.type != expected_type:
        raise ValueError(f"Expected {expected_type} token, got {payload.type}")
    return payload
