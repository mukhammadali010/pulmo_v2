"""Admin-only user management. Listing, creation, updates, password reset.

These functions are intentionally separated from the regular auth flow so the
admin surface is clearly delineated and easy to audit.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.examination import Examination, ExaminationStatus
from app.models.patient import Patient
from app.models.user import User, UserRole
from app.schemas.admin import AdminStats, DoctorCreate, DoctorListItem, DoctorUpdate
from app.services.auth import AuthError, get_user_by_email


async def list_doctors(
    session: AsyncSession,
    *,
    search: str | None = None,
    role: UserRole | None = None,
    is_active: bool | None = None,
) -> list[DoctorListItem]:
    patient_count = (
        select(Patient.created_by_id, func.count(Patient.id).label("c"))
        .group_by(Patient.created_by_id)
        .subquery()
    )
    exam_count = (
        select(Examination.created_by_id, func.count(Examination.id).label("c"))
        .group_by(Examination.created_by_id)
        .subquery()
    )

    stmt = (
        select(
            User,
            func.coalesce(patient_count.c.c, 0).label("patients"),
            func.coalesce(exam_count.c.c, 0).label("exams"),
        )
        .join(patient_count, patient_count.c.created_by_id == User.id, isouter=True)
        .join(exam_count, exam_count.c.created_by_id == User.id, isouter=True)
        .order_by(User.created_at.desc())
    )

    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.where(
            or_(func.lower(User.email).like(like), func.lower(User.full_name).like(like))
        )
    if role is not None:
        stmt = stmt.where(User.role == role)
    if is_active is not None:
        stmt = stmt.where(User.is_active == is_active)

    result = await session.execute(stmt)
    rows = result.all()

    return [
        DoctorListItem(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role,
            is_active=user.is_active,
            avatar_url=user.avatar_url,
            created_at=user.created_at,
            patient_count=int(patients),
            examination_count=int(exams),
        )
        for user, patients, exams in rows
    ]


async def create_doctor(session: AsyncSession, payload: DoctorCreate) -> User:
    existing = await get_user_by_email(session, payload.email)
    if existing is not None:
        raise AuthError("Email already registered")

    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def update_doctor(session: AsyncSession, user: User, payload: DoctorUpdate) -> User:
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(user, field, value)
    await session.commit()
    await session.refresh(user)
    return user


async def reset_password(session: AsyncSession, user: User, new_password: str) -> None:
    user.password_hash = hash_password(new_password)
    await session.commit()


async def deactivate_doctor(session: AsyncSession, user: User) -> User:
    user.is_active = False
    await session.commit()
    await session.refresh(user)
    return user


async def get_stats(session: AsyncSession) -> AdminStats:
    total_doctors = await session.scalar(
        select(func.count(User.id)).where(User.role == UserRole.DOCTOR)
    )
    active_doctors = await session.scalar(
        select(func.count(User.id)).where(
            User.role == UserRole.DOCTOR, User.is_active.is_(True)
        )
    )
    total_patients = await session.scalar(select(func.count(Patient.id)))
    total_examinations = await session.scalar(select(func.count(Examination.id)))
    pending = await session.scalar(
        select(func.count(Examination.id)).where(
            Examination.status.in_(
                [ExaminationStatus.PENDING, ExaminationStatus.ANALYZING]
            )
        )
    )
    done = await session.scalar(
        select(func.count(Examination.id)).where(
            Examination.status == ExaminationStatus.DONE
        )
    )

    return AdminStats(
        total_doctors=total_doctors or 0,
        active_doctors=active_doctors or 0,
        total_patients=total_patients or 0,
        total_examinations=total_examinations or 0,
        examinations_pending=pending or 0,
        examinations_done=done or 0,
    )


async def get_doctor_by_id(session: AsyncSession, user_id: UUID) -> User | None:
    return await session.get(User, user_id)
