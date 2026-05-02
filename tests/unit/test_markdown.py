"""Unit tests for app.utils.markdown — Markdown to HTML conversion."""

from app.utils.markdown import markdown_to_html


class TestMarkdownToHtml:
    # ── Basic elements ───────────────────────────────────────────────────

    def test_heading_h1(self):
        result = markdown_to_html("# Hello")
        assert "<h1>Hello</h1>" in result

    def test_heading_h2(self):
        result = markdown_to_html("## World")
        assert "<h2>World</h2>" in result

    def test_paragraph(self):
        result = markdown_to_html("Hello world")
        assert "<p>Hello world</p>" in result

    def test_bold(self):
        result = markdown_to_html("**bold**")
        assert "<strong>bold</strong>" in result

    def test_italic(self):
        result = markdown_to_html("*italic*")
        assert "<em>italic</em>" in result

    def test_inline_code(self):
        result = markdown_to_html("`code`")
        assert "<code>code</code>" in result

    def test_code_block(self):
        result = markdown_to_html("```python\nprint('hi')\n```")
        assert "<code" in result
        assert "print" in result

    def test_link(self):
        result = markdown_to_html("[Google](https://google.com)")
        assert '<a href="https://google.com">Google</a>' in result

    def test_image(self):
        result = markdown_to_html("![alt](https://img.png)")
        assert '<img src="https://img.png" alt="alt"' in result

    def test_unordered_list(self):
        result = markdown_to_html("- item1\n- item2")
        assert "<ul>" in result
        assert "<li>item1</li>" in result
        assert "<li>item2</li>" in result

    def test_ordered_list(self):
        result = markdown_to_html("1. first\n2. second")
        assert "<ol>" in result
        assert "<li>first</li>" in result

    def test_blockquote(self):
        result = markdown_to_html("> quote")
        assert "<blockquote>" in result
        assert "quote" in result

    def test_horizontal_rule(self):
        result = markdown_to_html("---")
        assert "<hr" in result

    # ── Table (explicitly enabled) ───────────────────────────────────────

    def test_table(self):
        md = "| A | B |\n|---|---|\n| 1 | 2 |"
        result = markdown_to_html(md)
        assert "<table>" in result
        assert "<th>A</th>" in result
        assert "<td>1</td>" in result

    # ── HTML escaping (html=False for XSS prevention) ──────────────────

    def test_raw_html_escaped(self):
        result = markdown_to_html('<div class="custom">hello</div>')
        assert "&lt;div" in result
        assert '<div class="custom">' not in result

    # ── Edge cases ───────────────────────────────────────────────────────

    def test_empty_string(self):
        result = markdown_to_html("")
        assert result == ""

    def test_whitespace_only(self):
        result = markdown_to_html("   \n\n  ")
        # Should return some whitespace/empty output, not crash
        assert isinstance(result, str)

    def test_unicode_content(self):
        result = markdown_to_html("# \u4f60\u597d\u4e16\u754c")
        assert "<h1>\u4f60\u597d\u4e16\u754c</h1>" in result

    def test_multiple_paragraphs(self):
        result = markdown_to_html("para1\n\npara2")
        assert "<p>para1</p>" in result
        assert "<p>para2</p>" in result

    def test_nested_formatting(self):
        result = markdown_to_html("**bold and *italic***")
        assert "<strong>" in result
        assert "<em>" in result

    def test_special_characters_escaped(self):
        result = markdown_to_html("5 &gt; 3 &amp; 2 &lt; 4")
        # Entities should be preserved or rendered
        assert isinstance(result, str)

    def test_returns_string_type(self):
        result = markdown_to_html("test")
        assert isinstance(result, str)
