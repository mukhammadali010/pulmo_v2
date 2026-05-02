"""On startup tasks — currently provisions an initial admin if none exists."""

from __future__ import annotations

import logging

from sqlalchemy import select

from app.config import get_settings
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)


async def ensure_initial_admin() -> None:
    settings = get_settings()
    if not settings.initial_admin_email or not settings.initial_admin_password:
        return

    async with AsyncSessionLocal() as session:
        existing_admin = await session.scalar(
            select(User).where(User.role == UserRole.ADMIN).limit(1)
        )
        if existing_admin is not None:
            return

        email = settings.initial_admin_email.lower()
        existing_email = await session.scalar(select(User).where(User.email == email))
        if existing_email is not None:
            # An account with that email already exists but is not admin —
            # promote it instead of failing.
            existing_email.role = UserRole.ADMIN
            existing_email.is_active = True
            await session.commit()
            logger.info("Promoted existing user %s to admin role", email)
            return

        admin = User(
            email=email,
            password_hash=hash_password(settings.initial_admin_password),
            full_name=settings.initial_admin_name,
            role=UserRole.ADMIN,
            is_active=True,
        )
        session.add(admin)
        await session.commit()
        logger.info("Provisioned initial admin %s", email)
