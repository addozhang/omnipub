"""remove itpub platform

Revision ID: a3f1c4e28b90
Revises: e1bb3dedb5a1
Create Date: 2026-04-02 14:40:00.000000

"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "a3f1c4e28b90"
down_revision: Union[str, None] = "e1bb3dedb5a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "DELETE FROM publication_stats WHERE publication_id IN "
        "(SELECT p.id FROM publications p JOIN platforms pl ON p.platform_id = pl.id WHERE pl.slug = 'itpub')"
    )
    op.execute(
        "DELETE FROM publications WHERE platform_id IN "
        "(SELECT id FROM platforms WHERE slug = 'itpub')"
    )
    op.execute("DELETE FROM user_platform_configs WHERE platform_slug = 'itpub'")
    op.execute("DELETE FROM platforms WHERE slug = 'itpub'")


def downgrade() -> None:
    platforms_table = sa.table(
        "platforms",
        sa.column("name", sa.String),
        sa.column("slug", sa.String),
        sa.column("icon_url", sa.String),
        sa.column("new_article_url", sa.String),
        sa.column("article_url_pattern", sa.String),
        sa.column("editor_config", sa.Text),
        sa.column("login_check_config", sa.Text),
        sa.column("stats_config", sa.Text),
        sa.column("status", sa.String),
        sa.column("config_version", sa.Integer),
    )
    op.bulk_insert(platforms_table, [{
        "name": "ITPUB",
        "slug": "itpub",
        "icon_url": "https://blog.itpub.net/favicon.ico",
        "new_article_url": "https://blog.itpub.net/write",
        "article_url_pattern": "https://blog.itpub.net/{article_id}.html",
        "editor_config": json.dumps({"editor_type": "iframe_richtext"}),
        "login_check_config": json.dumps({"check_url": "https://blog.itpub.net"}),
        "stats_config": json.dumps({"method": "dom"}),
        "status": "active",
        "config_version": 1,
    }])
