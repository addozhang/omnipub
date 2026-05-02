"""add category, tags, summary to articles

Revision ID: d1e2f3a4b5c6
Revises: c7d8e9f0a1b2
Create Date: 2026-04-07 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("articles", sa.Column("category", sa.String(100), nullable=True))
    op.add_column("articles", sa.Column("tags", sa.String(500), nullable=True))
    op.add_column("articles", sa.Column("summary", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("articles", "summary")
    op.drop_column("articles", "tags")
    op.drop_column("articles", "category")
