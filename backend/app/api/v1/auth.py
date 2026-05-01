from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, SessionDep
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
)
from app.schemas.user import UserRead
from app.services.auth import (
    AuthError,
    authenticate,
    get_user_by_id,
    issue_tokens,
    register_user,
)

router = APIRouter()


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, session: SessionDep) -> AuthResponse:
    try:
        user = await register_user(session, payload)
    except AuthError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    access, refresh = issue_tokens(user)
    return AuthResponse(
        access_token=access,
        refresh_token=refresh,
        user=UserRead.model_validate(user),
    )


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, session: SessionDep) -> AuthResponse:
    try:
        user = await authenticate(session, payload.email, payload.password)
    except AuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)
        ) from e

    access, refresh = issue_tokens(user)
    return AuthResponse(
        access_token=access,
        refresh_token=refresh,
        user=UserRead.model_validate(user),
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, session: SessionDep) -> TokenPair:
    try:
        token_payload = decode_token(payload.refresh_token, expected_type="refresh")
        user_id = UUID(token_payload.sub)
    except (ValueError, TypeError) as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        ) from e

    user = await get_user_by_id(session, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.get("/me", response_model=UserRead)
async def me(current_user: CurrentUser) -> UserRead:
    return UserRead.model_validate(current_user)
