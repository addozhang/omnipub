"""add remaining 9 platforms

Revision ID: 0002_add_remaining_platforms
Revises: 0001_seed_platforms
Create Date: 2026-03-12 03:30:00.000000

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_add_remaining_platforms"
down_revision: Union[str, None] = "0001_seed_platforms"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PLATFORMS = [
    {
        "name": "博客园",
        "slug": "cnblogs",
        "icon_url": "https://www.cnblogs.com/favicon.ico",
        "new_article_url": "https://i.cnblogs.com/posts/edit",
        "article_url_pattern": "https://www.cnblogs.com/{username}/p/{article_id}.html",
        "editor_config": json.dumps({
            "editor_type": "mixed",
            "note": "博客园支持多种编辑器，需检测当前模式",
            "title_selectors": [
                "#Editor_Edit_txbTitle",
                "input#post-title",
                "input[name='Editor$Edit$txbTitle']",
                "input[placeholder*='标题']",
                "input[name*='Title']",
            ],
            "content_selectors": [
                "#Editor_Edit_EditorBody",
                "textarea#Editor_Edit_EditorBody",
                "textarea[name='Editor$Edit$EditorBody']",
                ".CodeMirror",
                ".cm-editor",
                "[contenteditable='true']",
                "#md-editor",
            ],
            "editor_switcher_selector": "#editor-switcher",
        }),
        "login_check_config": json.dumps({
            "check_url": "https://www.cnblogs.com",
            "logged_selectors": [
                "#lnk_current_user",
                ".site_nav_right .user_nick",
                ".navbar .dropdown.user",
            ],
            "not_logged_selectors": [
                "#lnkLogin",
                "a[href*='/signin']",
                "a[href*='/login']",
            ],
            "login_url": "https://account.cnblogs.com/signin",
        }),
        "stats_config": json.dumps({
            "view_selector": "#post_view_count, span#post_view_count",
            "like_selector": "#post_digg_count, span#post_digg_count",
            "comment_selector": "#post_comment_count, span#post_comment_count",
            "collect_selector": None,
            "method": "dom",
        }),
        "status": "active",
        "config_version": 1,
    },
    {
        "name": "今日头条",
        "slug": "toutiao",
        "icon_url": "https://mp.toutiao.com/favicon.ico",
        "new_article_url": "https://mp.toutiao.com/profile_v4/graphic/publish",
        "article_url_pattern": "https://www.toutiao.com/article/{article_id}/",
        "editor_config": json.dumps({
            "editor_type": "prosemirror",
            "title_selectors": [
                ".editor-title textarea",
                ".autofit-textarea-wrapper textarea",
                ".publish-editor-title textarea",
            ],
            "content_selectors": [
                ".syl-editor .ProseMirror[contenteditable='true']",
                ".ProseMirror[contenteditable='true']",
                ".syl-editor-wrap .ProseMirror",
            ],
            "fill_method": "innerHTML",
            "note": "头条使用 ProseMirror 编辑器，需通过 innerHTML 注入 HTML 内容",
        }),
        "login_check_config": json.dumps({
            "check_url": "https://mp.toutiao.com",
            "login_url": "https://sso.toutiao.com/login/",
            "note": "头条号后台需要登录头条号账号",
        }),
        "stats_config": json.dumps({
            "method": "script_data",
            "script_selector": "script#RENDER_DATA",
            "data_path": "data.itemCell.itemCounter",
            "fields": {
                "view_count": "readCount",
                "like_count": "diggCount",
                "comment_count": "commentCount",
                "collect_count": "repinCount",
            },
        }),
        "status": "active",
        "config_version": 1,
    },
    {
        "name": "腾讯云",
        "slug": "tencent-cloud",
        "icon_url": "https://cloudcache.tencent-cloud.com/open_proj/proj_qcloud_v2/gateway/portal/css/img/favicon.ico",
        "new_article_url": "https://cloud.tencent.com/developer/article/write",
        "article_url_pattern": "https://cloud.tencent.com/developer/article/{article_id}",
        "editor_config": json.dumps({
            "editor_type": "auto_detect",
            "note": "腾讯云可能使用 Monaco / CodeMirror / Draft.js 等，需运行时检测",
            "title_selectors": [
                "textarea.article-title",
                "textarea.article-title[placeholder*='标题']",
            ],
            "content_selectors": [
                ".monaco-editor",
                ".CodeMirror",
                ".cm-editor",
                ".DraftEditor-root .public-DraftEditor-content[contenteditable='true']",
                "textarea[placeholder*='Markdown']",
                ".markdown-editor textarea",
                ".editor-wrapper textarea",
                ".editor-wrapper [contenteditable='true']",
            ],
            "success_selectors": [
                "a[href*='/developer/article/']",
                ".operate-item[href*='/developer/article/']",
            ],
        }),
        "login_check_config": json.dumps({
            "check_url": "https://cloud.tencent.com/developer",
            "login_url": "https://cloud.tencent.com/login",
        }),
        "stats_config": json.dumps({
            "method": "script_data",
            "script_selector": "script#__NEXT_DATA__",
            "fields": {
                "view_count": "showReadNum",
                "like_count": "likeNum",
                "comment_count": "commentNum",
                "collect_count": "favNum",
            },
        }),
        "status": "active",
        "config_version": 1,
    },
    {
        "name": "51CTO",
        "slug": "51cto",
        "icon_url": "https://blog.51cto.com/favicon.ico",
        "new_article_url": "https://blog.51cto.com/blogger/publish",
        "article_url_pattern": "https://blog.51cto.com/{username}/{article_id}",
        "editor_config": json.dumps({
            "editor_type": "textarea",
            "title_selectors": ["#title"],
            "content_selectors": ["textarea.auto-textarea-input"],
            "wait_selectors": [".form-title", "#title"],
            "fill_method": "value",
            "note": "51CTO 使用 textarea，直接设 value 即可",
        }),
        "login_check_config": json.dumps({
            "check_url": "https://blog.51cto.com",
            "logged_selectors": [
                ".user-info",
                ".user-avatar",
                ".header-user",
                ".user-dropdown",
                ".user-profile",
            ],
            "not_logged_selectors": [
                ".login-btn",
                ".signin-btn",
                "a[href*='/login']",
                "a[href*='/signin']",
            ],
            "login_url": "https://home.51cto.com/index",
        }),
        "stats_config": json.dumps({
            "method": "api",
            "note": "51CTO 通过 API 返回统计数据，字段: pv/apraise/favorite/comments",
            "fields": {
                "view_count": "pv",
                "like_count": "apraise",
                "collect_count": "favorite",
                "comment_count": "comments",
            },
        }),
        "status": "active",
        "config_version": 1,
    },
    {
        "name": "思否",
        "slug": "segmentfault",
        "icon_url": "https://static.segmentfault.com/main_site_next/a]favicon.ico",
        "new_article_url": "https://segmentfault.com/write",
        "article_url_pattern": "https://segmentfault.com/a/{article_id}",
        "editor_config": json.dumps({
            "editor_type": "codemirror",
            "title_selectors": [
                "input[name='title']",
                "input[id='title']",
                "input[placeholder*='标题']",
            ],
            "content_selectors": [
                ".sf-editor .CodeMirror",
                ".CodeMirror",
                ".sf-editor-wrap .CodeMirror",
            ],
            "fill_method": "codemirror_api",
            "note": "思否使用 CodeMirror 编辑器，通过 cm.setValue() 注入",
        }),
        "login_check_config": json.dumps({
            "check_url": "https://segmentfault.com",
            "logged_selectors": [
                ".user-info",
                ".user-avatar",
                ".dropdown-user",
                ".nav-user",
                ".header-user-menu",
            ],
            "not_logged_selectors": [
                ".login-btn",
                ".signin-btn",
                "a[href*='/signin']",
                "a[href*='/user/login']",
            ],
            "login_url": "https://segmentfault.com/user/login",
        }),
        "stats_config": json.dumps({
            "method": "dom",
            "note": "思否阅读数在底部统计区域，需在包含'发布于'和'阅读'的容器中查找 span",
            "view_strategy": "find_container_with_text",
            "container_keywords": ["发布于", "阅读"],
            "view_selector": "span",
        }),
        "status": "active",
        "config_version": 1,
    },
    {
        "name": "开源中国",
        "slug": "oschina",
        "icon_url": "https://www.oschina.net/favicon.ico",
        "new_article_url": "https://my.oschina.net/blog/write",
        "article_url_pattern": "https://my.oschina.net/{username}/blog/{article_id}",
        "editor_config": json.dumps({
            "editor_type": "codemirror",
            "note": "开源中国支持多种编辑器模式，需先切换到 Markdown 模式",
            "title_selectors": ["input[name='title']"],
            "content_selectors": [
                ".CodeMirror",
                "#editormd .CodeMirror",
            ],
            "editor_tab_selector": "#editorTabList",
            "markdown_tab_selector": "#editorTabList a[data-value='3']",
            "fill_method": "codemirror_api",
        }),
        "login_check_config": json.dumps({
            "check_url": "https://www.oschina.net",
            "login_url": "https://www.oschina.net/home/login",
            "detection_selectors": [
                ".blog-item",
                ".write-blog",
                ".user-menu",
                "a[href*='/blog/write']",
            ],
        }),
        "stats_config": json.dumps({
            "method": "dom",
            "note": "阅读数在包含'阅读数'文本的 div.item 中",
            "view_selectors": [".item.lm"],
            "view_text_keyword": "阅读数",
        }),
        "status": "active",
        "config_version": 1,
    },
    {
        "name": "InfoQ",
        "slug": "infoq",
        "icon_url": "https://xie.infoq.cn/favicon.ico",
        "new_article_url": "https://xie.infoq.cn/",
        "article_url_pattern": "https://xie.infoq.cn/article/{article_id}",
        "editor_config": json.dumps({
            "editor_type": "prosemirror",
            "note": "InfoQ 使用 ProseMirror 编辑器，需先点击'立即创作'按钮进入编辑器",
            "create_button_selectors": [
                "div[gk-button]",
                "button",
                ".Button_button_3onsJ",
            ],
            "create_button_text": "立即创作",
            "title_selectors": [
                "input.draft-title",
                "input[placeholder*='标题']",
            ],
            "content_selectors": [
                ".ProseMirror[contenteditable='true']",
                "div[contenteditable='true'].ProseMirror",
            ],
            "fill_method": "innerHTML",
        }),
        "login_check_config": json.dumps({
            "check_url": "https://xie.infoq.cn",
            "logged_selectors": [
                ".user-info",
                ".user-avatar",
                ".avatar-container",
                ".com-avatar-wrap",
                "img[alt*='头像']",
                "a[href*='/u/']",
            ],
            "not_logged_selectors": [
                ".login",
                ".signin",
                "a[href*='/login']",
            ],
            "login_url": "https://xie.infoq.cn/login",
        }),
        "stats_config": json.dumps({
            "method": "dom",
            "view_selectors": [
                ".author-information .views",
                ".after-content .views",
                "span.views",
                ".article-information .views",
            ],
            "view_text_keyword": "阅读数",
        }),
        "status": "active",
        "config_version": 1,
    },
    {
        "name": "哔哩哔哩",
        "slug": "bilibili",
        "icon_url": "https://www.bilibili.com/favicon.ico",
        "new_article_url": "https://member.bilibili.com/platform/upload/text/edit",
        "article_url_pattern": "https://www.bilibili.com/read/cv{article_id}",
        "editor_config": json.dumps({
            "editor_type": "quill",
            "note": "B站专栏使用 Quill 富文本编辑器",
            "title_selectors": [".bre-title-input textarea"],
            "content_selectors": [".ql-editor[contenteditable='true']"],
            "fill_method": "innerHTML",
        }),
        "login_check_config": json.dumps({
            "check_url": "https://member.bilibili.com",
            "login_url": "https://passport.bilibili.com/login",
        }),
        "stats_config": json.dumps({
            "method": "dom",
            "note": "B站专栏统计数据暂无 stats collector，需后续适配",
        }),
        "status": "active",
        "config_version": 1,
    },
]


def upgrade() -> None:
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
    op.execute(
        "DELETE FROM platforms WHERE slug IN ("
        "'cnblogs','toutiao','tencent-cloud','51cto',"
        "'segmentfault','oschina','infoq','bilibili'"
        ")"
    )
