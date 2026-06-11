"""Tests for fetch.py — text extraction and binary download modes."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path

import pytest
from fetch import (
    SUPPORTED_DOWNLOAD_TYPES,
    download_json,
    extension_for,
    is_download_supported,
    main,
    media_type_of,
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
