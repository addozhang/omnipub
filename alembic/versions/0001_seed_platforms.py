"""seed initial platform data

Revision ID: 0001_seed_platforms
Revises:
Create Date: 2025-01-01 00:00:00.000000

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_seed_platforms"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PLATFORMS = [
    {
        "name": "掘金",
        "slug": "juejin",
        "icon_url": "https://lf3-cdn-tos.bytescm.com/obj/static/xitu_juejin_web/img/juejin.7ทhVrV.png",
        "new_article_url": "https://juejin.cn/editor/drafts/new",
        "article_url_pattern": "https://juejin.cn/post/{article_id}",
        "editor_config": json.dumps({
            "editor_type": "bytemd",
            "title_selector": ".title-input",
            "content_selector": ".bytemd-body .CodeMirror",
            "publish_button_selector": ".publish-popup .submit-btn",
            "category_selector": ".category-list .item",
            "tag_selector": ".tag-input",
        }),
        "login_check_config": json.dumps({
            "check_url": "https://juejin.cn",
            "login_indicator_selector": ".avatar-wrapper",
            "login_url": "https://juejin.cn/login",
        }),
        "stats_config": json.dumps({
            "view_selector": ".article-suspended-panel .view-count",
            "like_selector": ".article-suspended-panel .like-count",
            "comment_selector": ".article-suspended-panel .comment-count",
            "collect_selector": ".article-suspended-panel .collect-count",
        }),
        "status": "active",
        "config_version": 1,
    },
    {
        "name": "CSDN",
        "slug": "csdn",
        "icon_url": "https://g.csdnimg.cn/static/logo/favicon32.ico",
        "new_article_url": "https://editor.csdn.net/md",
        "article_url_pattern": "https://blog.csdn.net/{username}/article/details/{article_id}",
        "editor_config": json.dumps({
            "editor_type": "markdown",
            "title_selector": ".article-bar__title input",
            "content_selector": ".editor__inner .CodeMirror",
            "publish_button_selector": ".btn-publish",
            "category_selector": ".tag__btn-tag",
            "tag_selector": ".mark_selection",
        }),
        "login_check_config": json.dumps({
            "check_url": "https://www.csdn.net",
            "login_indicator_selector": ".toolbar-btn-profile",
            "login_url": "https://passport.csdn.net/login",
        }),
        "stats_config": json.dumps({
            "view_selector": ".read-count",
            "like_selector": ".like-count",
            "comment_selector": ".comment-count",
            "collect_selector": ".collect-count",
        }),
        "status": "active",
        "config_version": 1,
    },
    {
        "name": "知乎",
        "slug": "zhihu",
        "icon_url": "https://static.zhihu.com/heifetz/favicon.ico",
        "new_article_url": "https://zhuanlan.zhihu.com/write",
        "article_url_pattern": "https://zhuanlan.zhihu.com/p/{article_id}",
        "editor_config": json.dumps({
            "editor_type": "richtext",
            "title_selector": ".WriteIndex-titleInput input",
            "content_selector": ".public-DraftEditor-content",
            "publish_button_selector": ".PublishPanel-button",
            "category_selector": ".TopicSelector",
            "tag_selector": ".TopicSelector-input",
        }),
        "login_check_config": json.dumps({
            "check_url": "https://www.zhihu.com",
            "login_indicator_selector": ".AppHeader-profileEntry",
            "login_url": "https://www.zhihu.com/signin",
        }),
        "stats_config": json.dumps({
            "view_selector": ".ContentItem-statusBar .ViewCount",
            "like_selector": ".VoteButton--up",
            "comment_selector": ".ContentItem-action:nth-child(2)",
            "collect_selector": ".ContentItem-action:nth-child(3)",
        }),
        "status": "active",
        "config_version": 1,
    },
]


def upgrade() -> None:
    # Create all tables first
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("username"),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_username", "users", ["username"])

    op.create_table(
        "articles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("markdown_content", sa.Text(), nullable=False),
        sa.Column("html_content", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("DRAFT", "PUBLISHED", name="articlestatus"),
            default="DRAFT",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "platforms",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(50), nullable=False),
        sa.Column("icon_url", sa.String(500), nullable=True),
        sa.Column("new_article_url", sa.String(500), nullable=False),
        sa.Column("article_url_pattern", sa.String(500), nullable=True),
        sa.Column("editor_config", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("login_check_config", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("stats_config", sa.Text(), nullable=False, server_default="{}"),
        sa.Column(
            "status",
            sa.Enum("ACTIVE", "DEGRADED", "BROKEN", name="platformstatus"),
            default="ACTIVE",
            nullable=False,
        ),
        sa.Column("config_version", sa.Integer(), default=1, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_platforms_slug", "platforms", ["slug"])

    op.create_table(
        "publications",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("article_id", sa.Integer(), sa.ForeignKey("articles.id"), nullable=False),
        sa.Column("platform_id", sa.Integer(), sa.ForeignKey("platforms.id"), nullable=False),
        sa.Column("platform_article_id", sa.String(255), nullable=True),
        sa.Column("article_url", sa.String(500), nullable=True),
        sa.Column(
            "status",
            sa.Enum("PENDING", "PUBLISHED", "FAILED", name="publicationstatus"),
            default="PENDING",
            nullable=False,
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "publication_stats",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "publication_id", sa.Integer(), sa.ForeignKey("publications.id"), nullable=False
        ),
        sa.Column("view_count", sa.Integer(), default=0),
        sa.Column("like_count", sa.Integer(), default=0),
        sa.Column("comment_count", sa.Integer(), default=0),
        sa.Column("collect_count", sa.Integer(), default=0),
        sa.Column("collected_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    # Seed platform data
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
    op.bulk_insert(platforms_table, PLATFORMS)


def downgrade() -> None:
    op.drop_table("publication_stats")
    op.drop_table("publications")
    op.drop_table("platforms")
    op.drop_table("articles")
    op.drop_table("users")
