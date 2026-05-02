"""add is_admin column to users table

Revision ID: c7d8e9f0a1b2
Revises: b8a2c3d4e5f6
Create Date: 2026-04-03 12:00:00.000000

S-C1: Any authenticated user could modify global platform configs.
This adds is_admin (default False) so only admins can update platform configs.
The first registered user is automatically promoted to admin by the app.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, None] = "b8a2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("is_admin", sa.Boolean(), server_default="0", nullable=False)
        )
    # Promote the first registered user (lowest id) to admin
    op.execute(
        """
        UPDATE users SET is_admin = 1
        WHERE id = (SELECT MIN(id) FROM users)
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("is_admin")
