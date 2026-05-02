"""normalise platform status values to uppercase (B-8)

The initial migration declared the platform status column as
Enum("ACTIVE","DEGRADED","BROKEN") — uppercase — but the seed inserts
used lowercase values ("active").  On SQLite this is harmless (no enum
enforcement), but on PostgreSQL the DB-level enum type would reject the
lowercase inserts at runtime.

This migration:
  1. Uppercases any existing lowercase status values in the platforms table.
  2. Adds HIDDEN to the enum type definition (PostgreSQL only, via ALTER TYPE).

The Python-side CaseInsensitiveEnum TypeDecorator already normalises
values on write (stores uppercase) and accepts both cases on read, so
new rows written after B-1 fixes are already uppercase.  This migration
only touches pre-existing rows that were inserted before that fix.

Revision ID: b8a2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-04-03 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b8a2c3d4e5f6"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # --- 1. Normalise platform status values to uppercase ---
    for lower, upper in [
        ("active", "ACTIVE"),
        ("degraded", "DEGRADED"),
        ("broken", "BROKEN"),
        ("hidden", "HIDDEN"),
    ]:
        op.execute(
            f"UPDATE platforms SET status = '{upper}' WHERE status = '{lower}'"
        )

    # --- 2. Normalise publication status values to uppercase ---
    for lower, upper in [
        ("pending", "PENDING"),
        ("published", "PUBLISHED"),
        ("failed", "FAILED"),
    ]:
        op.execute(
            f"UPDATE publications SET status = '{upper}' WHERE status = '{lower}'"
        )

    # --- 3. PostgreSQL only: add HIDDEN to the enum type ---
    if dialect == "postgresql":
        # ALTER TYPE … ADD VALUE is non-transactional on PostgreSQL and must
        # be run outside a transaction block.  Alembic wraps migrations in
        # transactions by default, so we execute it with COMMIT first.
        op.execute("COMMIT")
        op.execute("ALTER TYPE platformstatus ADD VALUE IF NOT EXISTS 'HIDDEN'")


def downgrade() -> None:
    # Normalising uppercase → there is no safe reverse without knowing the
    # original mixed state.  Downgrade is a no-op for data; schema is unchanged.
    pass
