"""add clinical_scale to examination_type enum

Revision ID: c5e8f2a91b03
Revises: 1b4f7323eb3c
Create Date: 2026-05-06 09:30:00.000000

"""
from collections.abc import Sequence
from typing import Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c5e8f2a91b03"
down_revision: Union[str, None] = "1b4f7323eb3c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older
    # Postgres versions; rely on Alembic's transactional DDL having committed
    # by the time this runs on PG 12+.
    op.execute("ALTER TYPE examination_type ADD VALUE IF NOT EXISTS 'clinical_scale'")


def downgrade() -> None:
    # Removing enum values requires recreating the type; not handled here.
    pass
