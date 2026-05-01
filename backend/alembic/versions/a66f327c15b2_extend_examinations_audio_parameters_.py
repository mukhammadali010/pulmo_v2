"""extend examinations: audio, parameters, attachment fields

Revision ID: a66f327c15b2
Revises: d4c08b1c5ceb
Create Date: 2026-05-01 21:29:39.762058

"""
from collections.abc import Sequence
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a66f327c15b2"
down_revision: Union[str, None] = "d4c08b1c5ceb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Extend the examination_type enum with the new kinds.
    #    ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older
    #    Postgres versions, so we emit raw SQL and rely on Alembic's transactional
    #    DDL having committed by the time these run on PG 12+.
    op.execute("ALTER TYPE examination_type ADD VALUE IF NOT EXISTS 'audio'")
    op.execute("ALTER TYPE examination_type ADD VALUE IF NOT EXISTS 'parameters'")

    # 2. Add new columns as nullable.
    op.add_column(
        "examinations",
        sa.Column("attachment_filename", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "examinations",
        sa.Column("attachment_mime", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "examinations",
        sa.Column("parameters", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    # 3. Carry over existing image_* values into the new attachment_* columns.
    op.execute(
        "UPDATE examinations SET attachment_filename = image_filename, "
        "attachment_mime = image_mime"
    )

    # 4. Drop the old columns.
    op.drop_column("examinations", "image_mime")
    op.drop_column("examinations", "image_filename")


def downgrade() -> None:
    op.add_column(
        "examinations",
        sa.Column("image_filename", sa.VARCHAR(length=255), nullable=True),
    )
    op.add_column(
        "examinations",
        sa.Column("image_mime", sa.VARCHAR(length=64), nullable=True),
    )
    op.execute(
        "UPDATE examinations SET image_filename = attachment_filename, "
        "image_mime = attachment_mime"
    )
    op.alter_column("examinations", "image_filename", nullable=False)
    op.alter_column("examinations", "image_mime", nullable=False)
    op.drop_column("examinations", "parameters")
    op.drop_column("examinations", "attachment_mime")
    op.drop_column("examinations", "attachment_filename")
    # Note: removing enum values requires recreating the type; not handled here.
