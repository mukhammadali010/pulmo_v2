from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from app.models.user import User, UserRole
from app.schemas.auth import RegisterRequest


class AuthError(Exception):
    """Raised when authentication fails for a known reason."""


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    result = await session.execute(select(User).where(User.email == email.lower()))
    return result.scalar_one_or_none()


async def get_user_by_id(session: AsyncSession, user_id: UUID) -> User | None:
    return await session.get(User, user_id)


async def register_user(session: AsyncSession, payload: RegisterRequest) -> User:
    existing = await get_user_by_email(session, payload.email)
    if existing is not None:
        raise AuthError("Email already registered")

    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role=UserRole.DOCTOR,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def authenticate(session: AsyncSession, email: str, password: str) -> User:
    user = await get_user_by_email(session, email)
    if user is None or not user.is_active:
        raise AuthError("Invalid credentials")
    if not verify_password(password, user.password_hash):
        raise AuthError("Invalid credentials")
    return user


def issue_tokens(user: User) -> tuple[str, str]:
    return create_access_token(user.id), create_refresh_token(user.id)
