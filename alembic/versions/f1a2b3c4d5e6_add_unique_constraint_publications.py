"""add unique constraint to publications(article_id, platform_id)

Revision ID: f1a2b3c4d5e6
Revises: a3f1c4e28b90
Create Date: 2026-04-03 10:00:00.000000

Fixes B-1: duplicate Publication rows caused by concurrent publish clicks.
The constraint is UNIQUE (article_id, platform_id) so that the POST /publish
endpoint can use INSERT OR IGNORE / ON CONFLICT DO NOTHING safely.

Note: we deduplicate existing duplicates first (keep lowest id per pair)
before creating the constraint so the migration is safe on live databases.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "a3f1c4e28b90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: Remove duplicate rows, keeping the one with the smallest id per pair.
    # This ensures the migration succeeds on databases that already have duplicates.
    op.execute(
        """
        DELETE FROM publications
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM publications
            GROUP BY article_id, platform_id
        )
        """
    )

    # Step 2: Add the unique constraint.
    # SQLite does not support ADD CONSTRAINT, so we use batch_alter_table
    # which recreates the table with the new constraint.
    with op.batch_alter_table("publications", schema=None) as batch_op:
        batch_op.create_unique_constraint(
            "uq_publication_article_platform",
            ["article_id", "platform_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("publications", schema=None) as batch_op:
        batch_op.drop_constraint(
            "uq_publication_article_platform",
            type_="unique",
        )
