"""Admin-only endpoints for managing doctors and surfacing system stats."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentAdmin, SessionDep
from app.models.user import UserRole
from app.schemas.admin import (
    AdminStats,
    DoctorCreate,
    DoctorListItem,
    DoctorRead,
    DoctorUpdate,
    PasswordReset,
)
from app.services import admin as admin_service
from app.services.auth import AuthError

router = APIRouter()


@router.get("/stats", response_model=AdminStats)
async def get_stats(session: SessionDep, _admin: CurrentAdmin) -> AdminStats:
    return await admin_service.get_stats(session)


@router.get("/users", response_model=list[DoctorListItem])
async def list_doctors(
    session: SessionDep,
    _admin: CurrentAdmin,
    search: str | None = None,
    role: UserRole | None = None,
    is_active: bool | None = None,
) -> list[DoctorListItem]:
    return await admin_service.list_doctors(
        session, search=search, role=role, is_active=is_active
    )


@router.post("/users", response_model=DoctorRead, status_code=status.HTTP_201_CREATED)
async def create_doctor(
    payload: DoctorCreate, session: SessionDep, _admin: CurrentAdmin
) -> DoctorRead:
    try:
        user = await admin_service.create_doctor(session, payload)
    except AuthError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    return DoctorRead.model_validate(user)


@router.get("/users/{user_id}", response_model=DoctorRead)
async def get_doctor(
    user_id: UUID, session: SessionDep, _admin: CurrentAdmin
) -> DoctorRead:
    user = await admin_service.get_doctor_by_id(session, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return DoctorRead.model_validate(user)


@router.patch("/users/{user_id}", response_model=DoctorRead)
async def update_doctor(
    user_id: UUID,
    payload: DoctorUpdate,
    session: SessionDep,
    admin: CurrentAdmin,
) -> DoctorRead:
    user = await admin_service.get_doctor_by_id(session, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Prevent admins from demoting themselves or deactivating themselves —
    # avoids accidentally locking out the only admin.
    if user.id == admin.id and (
        (payload.role is not None and payload.role != UserRole.ADMIN)
        or payload.is_active is False
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot demote or deactivate your own admin account",
        )

    user = await admin_service.update_doctor(session, user, payload)
    return DoctorRead.model_validate(user)


@router.post("/users/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    user_id: UUID,
    payload: PasswordReset,
    session: SessionDep,
    _admin: CurrentAdmin,
) -> None:
    user = await admin_service.get_doctor_by_id(session, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await admin_service.reset_password(session, user, payload.new_password)


@router.delete("/users/{user_id}", response_model=DoctorRead)
async def deactivate_doctor(
    user_id: UUID, session: SessionDep, admin: CurrentAdmin
) -> DoctorRead:
    user = await admin_service.get_doctor_by_id(session, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account",
        )
    user = await admin_service.deactivate_doctor(session, user)
    return DoctorRead.model_validate(user)
