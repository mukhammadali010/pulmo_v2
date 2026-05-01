from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr
from pydantic.alias_generators import to_camel

from app.models.user import UserRole


class UserRead(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: UUID
    email: EmailStr
    full_name: str
    role: UserRole
    avatar_url: str | None = None
