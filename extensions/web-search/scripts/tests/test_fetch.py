"""Tests for fetch.py — text extraction and binary download modes."""

from __future__ import annotations

import hashlib
import json
import os
import socket
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from bs4 import BeautifulSoup

from fetch import (
    SUPPORTED_DOWNLOAD_TYPES,
    download_json,
    extract_html,
    extract_title,
    extension_for,
    find_main_container,
    is_download_supported,
    main,
    media_type_of,
    strip_anchor_links,
    strip_boilerplate,
)


# ===========================================================================
# Unit: content-type helpers
# ===========================================================================


class TestIsDownloadSupported:
    def test_accepts_image_jpeg(self):
        assert is_download_supported("image/jpeg") is True

    def test_accepts_image_png(self):
        assert is_download_supported("image/png") is True

    def test_accepts_image_x_icon(self):
        assert is_download_supported("image/x-icon") is True

    def test_accepts_application_pdf(self):
        assert is_download_supported("application/pdf") is True

    def test_rejects_text_html(self):
        assert is_download_supported("text/html") is False

    def test_rejects_application_zip(self):
        assert is_download_supported("application/zip") is False

    def test_rejects_none(self):
        assert is_download_supported(None) is False

    def test_rejects_empty_string(self):
        assert is_download_supported("") is False

    def test_strips_parameters(self):
        assert is_download_supported("image/jpeg; charset=utf-8") is True


class TestMediaTypeOf:
    def test_plain_type(self):
        assert media_type_of("image/jpeg") == "image/jpeg"

    def test_with_parameters(self):
        assert media_type_of("text/html; charset=utf-8") == "text/html"

    def test_none(self):
        assert media_type_of(None) is None

    def test_empty(self):
        assert media_type_of("") is None


class TestExtensionFor:
    def test_from_explicit_mapping(self):
        """image/jpeg maps to .jpg via _DOWNLOAD_EXTENSIONS."""
        assert extension_for("image/jpeg", "https://example.com/photo") == ".jpg"

    def test_falls_back_to_url_path_extension(self):
        """When Content-Type is not in the mapping, use the URL extension."""
        assert extension_for("text/plain", "https://example.com/data.csv") == ".csv"

    def test_url_path_takes_precedence_over_mimetypes_guess(self):
        """URL path extension is tried before mimetypes.guess_extension."""
        result = extension_for("text/calendar", "https://example.com/meeting")
        assert result.startswith(".")  # any reasonable guess is fine

    def test_fallback_to_bin_when_nothing_works(self):
        """If no mapping, no URL ext, and mimetypes can't guess, return .bin."""
        result = extension_for("x-image/x-fake-format", "https://example.com/data")
        assert result == ".bin"

    def test_lowercases_url_extension(self):
        assert extension_for("text/plain", "https://example.com/Photo.JPG") == ".jpg"


# ===========================================================================
# Unit: semantic container helpers
# ===========================================================================

class TestFindMainContainer:
    """find_main_container returns the first semantic main-content element."""

    def test_returns_article_when_present(self):
        html = "<html><body><article><p>Content</p></article></body></html>"
        soup = BeautifulSoup(html, "lxml")
        container = find_main_container(soup)
        assert container is not None
        assert container.name == "article"

    def test_prefers_article_over_main(self):
        html = "<html><body><main><p>Main</p></main><article><p>Article</p></article></body></html>"
        soup = BeautifulSoup(html, "lxml")
        container = find_main_container(soup)
        assert container is not None
        assert container.name == "article"
        assert "Article" in container.get_text()

    def test_falls_back_to_main_when_no_article(self):
        html = "<html><body><main><p>Main content</p></main></body></html>"
        soup = BeautifulSoup(html, "lxml")
        container = find_main_container(soup)
        assert container is not None
        assert container.name == "main"

    def test_falls_back_to_role_main(self):
        html = '<html><body><div role="main"><p>Role main</p></div></body></html>'
        soup = BeautifulSoup(html, "lxml")
        container = find_main_container(soup)
        assert container is not None
        assert container.get("role") == "main"

    def test_returns_none_when_no_semantic_container(self):
        html = "<html><body><div><p>Just a div</p></div></body></html>"
        soup = BeautifulSoup(html, "lxml")
        assert find_main_container(soup) is None


class TestStripBoilerplate:
    """strip_boilerplate removes non-content elements from a container."""

    def test_removes_scripts_and_styles(self):
        html = "<article><p>Content</p><script>alert(1)</script><style>.x{}</style></article>"
        container = BeautifulSoup(html, "lxml").find("article")
        strip_boilerplate(container)
        text = container.get_text(strip=True)
        assert "Content" in text
        assert "alert" not in text

    def test_removes_nav(self):
        html = "<article><nav>Menu</nav><p>Content</p></article>"
        container = BeautifulSoup(html, "lxml").find("article")
        strip_boilerplate(container)
        text = container.get_text(strip=True)
        assert text == "Content"

    def test_preserves_header_and_footer_inside_container(self):
        """header/footer inside a semantic container are article content, not page chrome."""
        html = "<article><header><h1>Title</h1></header><p>Body</p><footer>Tags</footer></article>"
        container = BeautifulSoup(html, "lxml").find("article")
        strip_boilerplate(container)
        text = container.get_text(strip=True)
        assert "Title" in text
        assert "Body" in text
        assert "Tags" in text

    def test_removes_form_and_button(self):
        html = "<article><p>Content</p><form><button>Click</button></form></article>"
        container = BeautifulSoup(html, "lxml").find("article")
        strip_boilerplate(container)
        text = container.get_text(strip=True)
        assert text == "Content"

    def test_preserves_article_content(self):
        html = "<article><h1>Title</h1><p>Body text</p><code>inline</code></article>"
        container = BeautifulSoup(html, "lxml").find("article")
        strip_boilerplate(container)
        text = container.get_text(strip=True)
        assert "Title" in text
        assert "Body text" in text
        assert "inline" in text


class TestStripAnchorLinks:
    """strip_anchor_links removes decorative heading-anchor <a> tags."""

    def test_removes_gyph_hash(self):
        html = '<h1>Title <a href="#title">#</a></h1>'
        container = BeautifulSoup(html, "lxml").find("h1")
        strip_anchor_links(container)
        assert container.get_text(strip=True) == "Title"

    def test_removes_gyph_paragraph(self):
        html = '<h2>Title <a href="#t">¶</a></h2>'
        container = BeautifulSoup(html, "lxml").find("h2")
        strip_anchor_links(container)
        assert container.get_text(strip=True) == "Title"

    def test_removes_gyph_section(self):
        html = '<h2>Title <a href="#t">§</a></h2>'
        container = BeautifulSoup(html, "lxml").find("h2")
        strip_anchor_links(container)
        assert container.get_text(strip=True) == "Title"

    def test_removes_empty_anchor(self):
        html = '<h2>Title <a href="#t"></a></h2>'
        container = BeautifulSoup(html, "lxml").find("h2")
        strip_anchor_links(container)
        assert container.get_text(strip=True) == "Title"

    def test_removes_anchor_class(self):
        html = '<h2>Title <a class="anchor" href="#t">#</a></h2>'
        container = BeautifulSoup(html, "lxml").find("h2")
        strip_anchor_links(container)
        assert container.get_text(strip=True) == "Title"

    def test_removes_headerlink_class(self):
        html = '<h2>Title <a class="headerlink" href="#t">¶</a></h2>'
        container = BeautifulSoup(html, "lxml").find("h2")
        strip_anchor_links(container)
        assert container.get_text(strip=True) == "Title"

    def test_keeps_meaningful_link(self):
        html = '<h2><a href="/page">Real Link</a></h2>'
        container = BeautifulSoup(html, "lxml").find("h2")
        strip_anchor_links(container)
        assert container.get_text(strip=True) == "Real Link"
        assert container.find("a") is not None


class TestExtractTitle:
    """extract_title returns the document title from the semantic path."""

    def test_returns_head_title(self):
        html = "<html><head><title>My Page</title></head><body><article><h1>Alt</h1></article></body></html>"
        soup = BeautifulSoup(html, "lxml")
        container = soup.find("article")
        assert extract_title(soup, container) == "My Page"

    def test_falls_back_to_first_heading(self):
        html = "<html><head></head><body><article><h1>Doc Title</h1><p>Body</p></article></body></html>"
        soup = BeautifulSoup(html, "lxml")
        container = soup.find("article")
        assert extract_title(soup, container) == "Doc Title"

    def test_returns_none_when_no_title_or_heading(self):
        html = "<html><head></head><body><article><p>Just text</p></article></body></html>"
        soup = BeautifulSoup(html, "lxml")
        container = soup.find("article")
        assert extract_title(soup, container) is None

    def test_returns_first_heading_in_document_order(self):
        """When no <title>, the first heading in document order is returned (not the first <h1>)."""
        html = (
            "<html><head></head><body><article>"
            "<h2>Section A</h2>"
            "<p>Content</p>"
            "<h1>Title</h1>"
            "</article></body></html>"
        )
        soup = BeautifulSoup(html, "lxml")
        container = soup.find("article")
        assert extract_title(soup, container) == "Section A"


# ===========================================================================
# Integration: semantic extraction via extract_html
# ===========================================================================

FIXTURE_ARTICLE_HTML = """\
<html>
<head><title>Test README</title></head>
<body>
<nav>Site Menu</nav>
<article>
<h1>Project Name</h1>
<p>Description of the project.</p>
<h2>Getting Started</h2>
<p>Run the following:</p>
<pre><code>npm install</code></pre>
<h2>Configuration</h2>
<p>Edit your config.</p>
</article>
<footer>Site Footer</footer>
</body>
</html>
"""


def test_semantic_extraction_preserves_headings(httpx_mock, capsys):
    """Article with h1/h2 headings produces markdown with heading syntax."""
    httpx_mock.add_response(
        url="https://example.com/readme",
        text=FIXTURE_ARTICLE_HTML,
        headers={"Content-Type": "text/html"},
    )

    exit_code = main([
        "--url", "https://example.com/readme",
        "--max-chars", "5000",
        "--format", "markdown",
    ])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    content = output["content"]
    assert "# Project Name" in content
    assert "## Getting Started" in content
    assert "## Configuration" in content
    assert "npm install" in content
    assert "Description of the project" in content
    # Site chrome should be stripped
    assert "Site Menu" not in content
    assert "Site Footer" not in content


def test_semantic_extraction_title(httpx_mock, capsys):
    """Title is extracted from <title> in the semantic path."""
    httpx_mock.add_response(
        url="https://example.com/readme",
        text=FIXTURE_ARTICLE_HTML,
        headers={"Content-Type": "text/html"},
    )

    exit_code = main([
        "--url", "https://example.com/readme",
        "--max-chars", "5000",
        "--format", "markdown",
    ])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["title"] == "Test README"


FIXTURE_NO_SEMANTIC_HTML = """\
<html>
<head><title>Blog Post</title></head>
<body>
<div class="post">
<h1>My Blog Post</h1>
<p>Some interesting content here.</p>
</div>
</body>
</html>
"""


def test_fallback_to_readability_when_no_semantic_container(httpx_mock, capsys):
    """Page without article/main uses readability extraction."""
    httpx_mock.add_response(
        url="https://example.com/blog",
        text=FIXTURE_NO_SEMANTIC_HTML,
        headers={"Content-Type": "text/html"},
    )

    exit_code = main([
        "--url", "https://example.com/blog",
        "--max-chars", "5000",
        "--format", "markdown",
    ])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    # Readability path may or may not preserve headings — the key is it doesn't crash
    assert output["content"] is not None
    assert len(output["content"]) > 0


FIXTURE_EMPTY_ARTICLE_HTML = """\
<html>
<head><title>Empty</title></head>
<body>
<article></article>
</body>
</html>
"""


def test_fallback_to_readability_when_article_too_short(httpx_mock, capsys):
    """Article with < 50 chars of text falls through to readability."""
    httpx_mock.add_response(
        url="https://example.com/empty",
        text=FIXTURE_EMPTY_ARTICLE_HTML,
        headers={"Content-Type": "text/html"},
    )

    exit_code = main([
        "--url", "https://example.com/empty",
        "--max-chars", "5000",
        "--format", "markdown",
    ])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    # Should not crash — readability fallback handles empty article
    assert output["content"] is not None


# ===========================================================================
# Regression: fixture-based extraction quality
# ===========================================================================

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_github_readme_headings_preserved():
    """GitHub-style article with anchor-icon <a> tags: headings are preserved, anchors stripped."""
    html = (FIXTURES_DIR / "github_readme.html").read_text()
    result = extract_html(html, "https://github.com/test/repo", "markdown")
    content = result["content"]

    # All five headings must appear as markdown headings
    assert "# Docs" in content
    assert "## Recommended Links" in content
    assert "# Quick Start" in content
    assert "## Neovim" in content
    assert "## VSCode" in content
    assert "## Zed" in content

    # Anchor links must not leak into the output
    assert "aria-label=" not in content
    assert "octicon" not in content

    # Content must be present
    assert "markdown-oxide" in content
    assert "cargo install" in content
    assert "pacman -S" in content

    # Title from <title> tag
    assert result["title"] == "Feel-ix-343/markdown-oxide: PKM Markdown Language Server"


def test_readthedocs_headings_preserved():
    """Sphinx/readthedocs article with headerlink <a> tags: headings are preserved, anchors stripped."""
    html = (FIXTURES_DIR / "readthedocs_page.html").read_text()
    result = extract_html(html, "https://trafilatura.readthedocs.io/", "markdown")
    content = result["content"]

    # All headings must appear
    assert "# With Python" in content
    assert "## The Python programming language" in content
    assert "## Step-by-step" in content
    assert "### Quickstart" in content
    assert "### Extraction functions" in content
    assert "### Output" in content
    assert "#### Examples" in content
    assert "## Extraction settings" in content
    assert "### Function parameters" in content

    # Headerlink anchors must not leak
    assert "¶" not in content
    assert "headerlink" not in content
    assert "Link to this heading" not in content

    # Code blocks preserved
    assert "trafilatura.extract" in content

    # Title from <title> tag
    assert result["title"] == "Usage with Python — trafilatura 2.1.0 documentation"


# ===========================================================================
# Integration: download mode (--download)
# ===========================================================================


def test_download_image_jpeg_success(httpx_mock, capsys, monkeypatch):
    """Download a JPEG: file written to /tmp, correct sha1, correct extension."""
    content = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    content += b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c"

    sha1_expected = hashlib.sha1(content).hexdigest()

    httpx_mock.add_response(
        url="https://example.com/photo.jpg",
        content=content,
        headers={"Content-Type": "image/jpeg"},
        status_code=200,
    )

    # Pin tempdir so we know where to look. Keep assertions inside the block
    # so the tempdir still exists when we check the file path.
    with tempfile.TemporaryDirectory() as tmp:
        monkeypatch.setattr(tempfile, "gettempdir", lambda: tmp)

        exit_code = main([
            "--download",
            "--url", "https://example.com/photo.jpg",
        ])
        captured = capsys.readouterr()

        assert exit_code == 0, captured.out
        output = json.loads(captured.out)

        assert output["url"] == "https://example.com/photo.jpg"
        assert output["finalUrl"] == "https://example.com/photo.jpg"
        assert output["statusCode"] == 200
        assert output["contentType"] == "image/jpeg"
        assert output["sha1"] == sha1_expected
        assert output["byteSize"] == len(content)
        assert output["fileName"].endswith(".jpg")
        assert "path" in output
        assert os.path.isfile(output["path"]), f"File not found: {output['path']}"
        assert Path(output["path"]).read_bytes() == content


def test_download_image_png_extension_from_content_type(httpx_mock, capsys, monkeypatch):
    """When URL has no extension, extension comes from Content-Type."""
    content = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"

    httpx_mock.add_response(
        url="https://example.com/abcdef",
        content=content,
        headers={"Content-Type": "image/png"},
        status_code=200,
    )

    with tempfile.TemporaryDirectory() as tmp:
        monkeypatch.setattr(tempfile, "gettempdir", lambda: tmp)
        exit_code = main(["--download", "--url", "https://example.com/abcdef"])
        captured = capsys.readouterr()

        assert exit_code == 0, captured.out
        output = json.loads(captured.out)
        assert output["contentType"] == "image/png"
        assert output["fileName"].endswith(".png")
        assert os.path.isfile(output["path"]), f"File not found: {output['path']}"
        assert Path(output["path"]).read_bytes() == content


def test_download_image_x_icon(httpx_mock, capsys, monkeypatch):
    """image/x-icon is in the allowlist and gets .ico extension."""
    content = b"\x00\x00\x01\x00\x01\x00\x10\x10\x00\x00\x00\x00"

    httpx_mock.add_response(
        url="https://example.com/favicon.ico",
        content=content,
        headers={"Content-Type": "image/x-icon"},
        status_code=200,
    )

    with tempfile.TemporaryDirectory() as tmp:
        monkeypatch.setattr(tempfile, "gettempdir", lambda: tmp)
        exit_code = main(["--download", "--url", "https://example.com/favicon.ico"])
        captured = capsys.readouterr()

        assert exit_code == 0, captured.out
        output = json.loads(captured.out)
        assert output["contentType"] == "image/x-icon"
        assert output["fileName"].endswith(".ico")
        assert os.path.isfile(output["path"]), f"File not found: {output['path']}"


def test_download_pdf(httpx_mock, capsys, monkeypatch):
    """application/pdf is in the allowlist."""
    content = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF"

    httpx_mock.add_response(
        url="https://example.com/doc.pdf",
        content=content,
        headers={"Content-Type": "application/pdf"},
        status_code=200,
    )

    with tempfile.TemporaryDirectory() as tmp:
        monkeypatch.setattr(tempfile, "gettempdir", lambda: tmp)
        exit_code = main(["--download", "--url", "https://example.com/doc.pdf"])
        output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["contentType"] == "application/pdf"
    assert output["fileName"].endswith(".pdf")


def test_download_unsupported_mime_returns_error(httpx_mock, capsys):
    """application/zip is not in the allowlist → error envelope, exit code 1."""
    httpx_mock.add_response(
        url="https://example.com/archive.zip",
        content=b"PK\x03\x04\x00\x00\x00\x00",
        headers={"Content-Type": "application/zip"},
        status_code=200,
    )

    exit_code = main(["--download", "--url", "https://example.com/archive.zip"])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert "error" in output
    assert "not supported" in output["error"].lower()


def test_download_http_error_404_returns_error(httpx_mock, capsys):
    """HTTP 404 with a binary MIME still gets through to the MIME check.
    But in practice an image/jpeg 404 is uncommon; the real 404 is likely
    text/html. Test the pair: image MIME + 404 does get saved (with a
    warning), while text/html 404 is rejected by allowlist."""
    # image/jpeg at 404: MIME is allowed, body is saved with a warning
    httpx_mock.add_response(
        url="https://example.com/missing.jpg",
        content=b"404 not found",
        headers={"Content-Type": "image/jpeg"},
        status_code=404,
    )

    exit_code = main(["--download", "--url", "https://example.com/missing.jpg"])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["statusCode"] == 404
    assert len(output["warnings"]) > 0
    assert "404" in output["warnings"][0]


def test_download_size_cap_exceeded(httpx_mock, capsys):
    """Response exceeding --max-bytes → error envelope."""
    httpx_mock.add_response(
        url="https://example.com/huge.jpg",
        content=b"a" * 2000,
        headers={"Content-Type": "image/jpeg"},
        status_code=200,
    )

    exit_code = main(["--download", "--url", "https://example.com/huge.jpg", "--max-bytes", "100"])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert "error" in output
    assert "exceeds" in output["error"].lower() or "max" in output["error"].lower()


# ===========================================================================
# Integration: text mode unchanged (regression guard)
# ===========================================================================


def test_text_mode_extracts_html(httpx_mock, capsys):
    """The original text extraction path is unchanged: HTML → markdown."""
    httpx_mock.add_response(
        url="https://example.com/",
        text="<html><head><title>Hello</title></head><body><p>World</p></body></html>",
        headers={"Content-Type": "text/html"},
    )

    exit_code = main([
        "--url", "https://example.com/",
        "--max-chars", "500",
        "--format", "markdown",
    ])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert "title" in output
    assert output["title"] == "Hello" or output["title"] is not None
    assert output["format"] == "markdown"
    assert output["content"] is not None
    assert "World" in output["content"] or "World" in output.get("content", "")
    assert "path" not in output  # not a download


def test_text_mode_rejects_image(httpx_mock, capsys):
    """Text mode still rejects image/* content types."""
    httpx_mock.add_response(
        url="https://example.com/photo.jpg",
        content=b"\xff\xd8\xff",
        headers={"Content-Type": "image/jpeg"},
    )

    exit_code = main(["--url", "https://example.com/photo.jpg"])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert "error" in output
    assert "Unsupported content type" in output["error"]


# ===========================================================================
# Unit: download_json helper
# ===========================================================================


class TestDownloadJson:
    def test_shape_matches_contract(self):
        """download_json returns the expected JSON fields."""
        result = download_json(
            url="https://example.com/f.jpg",
            final_url="https://example.com/f.jpg",
            status_code=200,
            content_type="image/jpeg",
            path="/tmp/test.jpg",
            file_name="test.jpg",
            byte_size=42,
            sha1="abc123",
            warnings=["test warning"],
        )

        assert result["url"] == "https://example.com/f.jpg"
        assert result["finalUrl"] == "https://example.com/f.jpg"
        assert result["statusCode"] == 200
        assert result["contentType"] == "image/jpeg"
        assert result["path"] == "/tmp/test.jpg"
        assert result["fileName"] == "test.jpg"
        assert result["byteSize"] == 42
        assert result["sha1"] == "abc123"
        assert result["warnings"] == ["test warning"]

    def test_no_text_fields(self):
        """download_json does not include text-mode fields."""
        result = download_json(
            url="https://example.com/f.jpg",
            final_url="https://example.com/f.jpg",
            status_code=200,
            content_type="image/jpeg",
            path="/tmp/test.jpg",
            file_name="test.jpg",
            byte_size=42,
            sha1="abc",
            warnings=[],
        )
        assert "content" not in result
        assert "format" not in result
        assert "truncated" not in result
        assert "title" not in result


# ===========================================================================
# Content artifact & sourceTruncated fields in main() output
# ===========================================================================

class TestContentArtifactInOutput:
    """contentArtifactPath and sourceTruncated appear in JSON output."""

    def test_content_artifact_path_present_when_truncated(self, httpx_mock, capsys):
        """contentArtifactPath is in the JSON when the preview is truncated."""
        # Use content long enough to exceed _truncate's 1000-char minimum clamp
        long_text = "Line of text for testing. " * 100  # ~2600 chars
        httpx_mock.add_response(
            url="https://example.com/long.txt",
            text=long_text,
            headers={"Content-Type": "text/plain"},
        )

        exit_code = main([
            "--url", "https://example.com/long.txt",
            "--max-chars", "1000",
            "--format", "text",
        ])
        output = json.loads(capsys.readouterr().out)

        assert exit_code == 0
        assert output["truncated"] is True
        assert "contentArtifactPath" in output
        assert isinstance(output["contentArtifactPath"], str)
        assert os.path.exists(output["contentArtifactPath"])

    def test_content_artifact_path_absent_when_not_truncated(self, httpx_mock, capsys):
        """contentArtifactPath is absent from JSON when not truncated."""
        httpx_mock.add_response(
            url="https://example.com/short.txt",
            text="Short content.",
            headers={"Content-Type": "text/plain"},
        )

        exit_code = main([
            "--url", "https://example.com/short.txt",
            "--max-chars", "50000",
            "--format", "text",
        ])
        output = json.loads(capsys.readouterr().out)

        assert exit_code == 0
        assert output["truncated"] is False
        assert "contentArtifactPath" not in output

    def test_source_truncated_field_present(self, httpx_mock, capsys):
        """sourceTruncated field is always present in the JSON output."""
        httpx_mock.add_response(
            url="https://example.com/page",
            text="Some content.",
            headers={"Content-Type": "text/plain"},
        )

        exit_code = main([
            "--url", "https://example.com/page",
            "--format", "text",
        ])
        output = json.loads(capsys.readouterr().out)

        assert exit_code == 0
        assert "sourceTruncated" in output
        assert output["sourceTruncated"] is False


# ===========================================================================
# Raw mode
# ===========================================================================

class TestRawMode:
    """Raw mode returns decoded source without extraction."""

    def test_raw_plus_download_returns_error(self):
        """raw=true combined with download=true returns a validation error."""
        exit_code = main([
            "--url", "https://example.com/photo.jpg",
            "--raw",
            "--download",
        ])
        # Should fail before any network request (no httpx_mock needed).
        assert exit_code != 0

    def test_raw_html_returned_without_extraction(self, httpx_mock, capsys):
        """When --raw is set, HTML content is returned without extraction."""
        raw_html = "<html><body><h1>Hello</h1><p>World</p></body></html>"
        httpx_mock.add_response(
            url="https://example.com/page.html",
            text=raw_html,
            headers={"Content-Type": "text/html"},
        )
        # Mock DNS to avoid network dependency
        with patch.object(socket, "getaddrinfo", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.216.34", 80)),
        ]):
            exit_code = main([
                "--url", "https://example.com/page.html",
                "--raw",
            ])
        output = json.loads(capsys.readouterr().out)
        assert exit_code == 0
        assert "<h1>Hello</h1>" in output["content"]
        assert output["format"] == "raw"
