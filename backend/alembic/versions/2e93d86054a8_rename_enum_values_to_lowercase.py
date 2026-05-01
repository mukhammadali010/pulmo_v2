"""rename enum values to lowercase

Revision ID: 2e93d86054a8
Revises: a66f327c15b2
Create Date: 2026-05-01 21:41:20.658591

"""
from collections.abc import Sequence
from typing import Union

from alembic import op


revision: str = "2e93d86054a8"
down_revision: Union[str, None] = "a66f327c15b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


RENAMES = {
    "examination_type": [("XRAY", "xray"), ("CT", "ct"), ("MRI", "mri")],
    "examination_status": [
        ("PENDING", "pending"),
        ("ANALYZING", "analyzing"),
        ("DONE", "done"),
        ("FAILED", "failed"),
    ],
    "user_role": [("ADMIN", "admin"), ("DOCTOR", "doctor"), ("USER", "user")],
    "gender": [("MALE", "male"), ("FEMALE", "female"), ("OTHER", "other")],
}


def upgrade() -> None:
    for type_name, pairs in RENAMES.items():
        for old, new in pairs:
            op.execute(f"ALTER TYPE {type_name} RENAME VALUE '{old}' TO '{new}'")


def downgrade() -> None:
    for type_name, pairs in RENAMES.items():
        for old, new in pairs:
            op.execute(f"ALTER TYPE {type_name} RENAME VALUE '{new}' TO '{old}'")
