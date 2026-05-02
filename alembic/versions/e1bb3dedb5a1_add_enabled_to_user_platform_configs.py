"""add enabled to user_platform_configs

Revision ID: e1bb3dedb5a1
Revises: 2e4e0889c062
Create Date: 2026-03-13 11:02:11.881406

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e1bb3dedb5a1"
down_revision: Union[str, None] = "2e4e0889c062"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_platform_configs",
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("user_platform_configs", "enabled")
