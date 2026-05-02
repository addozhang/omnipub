from markdown_it import MarkdownIt


_md = MarkdownIt("commonmark", {"html": False}).enable("table")


def markdown_to_html(markdown_content: str) -> str:
    """Convert Markdown text to HTML."""
    return _md.render(markdown_content)
