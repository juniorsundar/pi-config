#!/usr/bin/env python3
"""Pi web-fetch helper: fetch HTTP(S) URLs, extract readable content, return JSON."""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import mimetypes
import socket
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

import httpx
from bs4 import BeautifulSoup, Tag
from markdownify import markdownify as md
from readability import Document as ReadabilityDoc

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

OutputFormat = Literal["markdown", "text"]
ContentCategory = Literal["html", "text_like", "unsupported"]

ExtractedDocument = Dict[str, Any]
"""
Stable shape expected by the TypeScript side:
{
  "url": str,
  "finalUrl": str,
  "statusCode": int,
  "contentType": str | None,
  "title": str | None,
  "format": str,
  "content": str,
  "truncated": bool,
  "contentLength": int,
  "fetchedBytes": int,
  "warnings": List[str],
}
On error:
{
  "error": str,
  "url": str,
  "details": dict | None,
}
"""

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SUPPORTED_HTML_TYPES = {
    "text/html",
    "application/xhtml+xml",
}

SUPPORTED_TEXT_TYPES = {
    "text/plain",
    "text/markdown",
}

SUPPORTED_DATA_TYPES = {
    "application/json",
    "application/xml",
    "text/xml",
}

SUPPORTED_TYPES = SUPPORTED_HTML_TYPES | SUPPORTED_TEXT_TYPES | SUPPORTED_DATA_TYPES

# Binary types accepted only in --download mode.
# Keep this list small and intentional: images + PDFs. Add more only with
# matching test coverage in test_fetch.py.
SUPPORTED_DOWNLOAD_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/bmp",
    "image/tiff",
    "image/x-icon",
    "image/vnd.microsoft.icon",
    "application/pdf",
}

# Map media types → canonical file extensions used for the temp file.
# Falls back to mimetypes.guess_extension or ".bin" if not listed.
_DOWNLOAD_EXTENSIONS: Dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
    "application/pdf": ".pdf",
}

PRIVATE_HOST_CACHE: Dict[str, bool] = {}

USER_AGENT = (
    "pi-web-fetch/0.1 "
    "(+https://github.com/earendil-works/pi-coding-agent; "
    "like curl/8.0)"
)

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class FetchError(Exception):
    """Controlled error that produces a structured JSON response."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None) -> None:
        self.message = message
        self.details = details or {}
        super().__init__(message)


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch a URL and extract readable content.",
    )
    parser.add_argument("--url", "-u", required=True, help="HTTP(S) URL to fetch")
    parser.add_argument(
        "--max-chars",
        "-m",
        type=int,
        default=30_000,
        help="Max characters of extracted content (default 30000, max 100000)",
    )
    parser.add_argument(
        "--format",
        "-f",
        choices=["markdown", "text"],
        default="markdown",
        help="Output format (default markdown)",
    )
    parser.add_argument(
        "--timeout",
        "-t",
        type=int,
        default=20,
        help="Request timeout in seconds (default 20)",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=5_242_880,
        help="Max fetch bytes (default 5 MiB)",
    )
    parser.add_argument(
        "--download",
        action="store_true",
        help=(
            "Download the response body to a local temp file and return its path "
            "instead of extracting readable text. Accepts image/* and application/pdf. "
            "Ignores --max-chars and --format."
        ),
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# URL validation + SSRF protection
# ---------------------------------------------------------------------------


def is_private_or_local_address(hostname: str) -> Tuple[bool, str]:
    """Check if hostname resolves to a private/local IP."""
    # Check cache first
    cached = PRIVATE_HOST_CACHE.get(hostname)
    if cached is not None:
        return cached, ""

    try:
        addrinfos = socket.getaddrinfo(hostname, 80, type=socket.SOCK_STREAM)
    except OSError as exc:
        PRIVATE_HOST_CACHE[hostname] = True
        return True, f"DNS resolution failed: {exc}"

    for addr_info in addrinfos:
        addr = addr_info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue

        if ip.is_loopback:
            PRIVATE_HOST_CACHE[hostname] = True
            return True, f"Host resolves to loopback address: {addr}"
        if ip.is_private:
            PRIVATE_HOST_CACHE[hostname] = True
            return True, f"Host resolves to private address: {addr}"
        if ip.is_link_local:
            PRIVATE_HOST_CACHE[hostname] = True
            return True, f"Host resolves to link-local address: {addr}"
        if ip.is_multicast:
            PRIVATE_HOST_CACHE[hostname] = True
            return True, f"Host resolves to multicast address: {addr}"
        if ip.is_unspecified:
            PRIVATE_HOST_CACHE[hostname] = True
            return True, f"Host resolves to unspecified address: {addr}"
        if ip.is_reserved:
            PRIVATE_HOST_CACHE[hostname] = True
            return True, f"Host resolves to reserved address: {addr}"

    PRIVATE_HOST_CACHE[hostname] = False
    return False, ""


def validate_url(url: str) -> httpx.URL:
    """Validate URL scheme/format/SSRF, returning parsed URL or raising FetchError."""
    try:
        parsed = httpx.URL(url)
    except Exception as exc:
        raise FetchError(
            "Invalid URL format",
            {"url": url, "detail": str(exc)},
        ) from exc

    if parsed.scheme not in ("http", "https"):
        raise FetchError(
            f"Unsupported URL scheme: '{parsed.scheme}'. Only http and https are allowed.",
            {"url": url, "scheme": parsed.scheme},
        )

    host = parsed.host
    if not host:
        raise FetchError("URL has no hostname", {"url": url})

    # Check for credentials in URL
    if parsed.username or parsed.password:
        raise FetchError(
            "URL contains embedded credentials (username:password). Refusing to fetch.",
            {"url": url},
        )

    # SSRF guard
    is_private, reason = is_private_or_local_address(host)
    if is_private:
        raise FetchError(
            f"Fetch refused: {reason}",
            {"url": url, "host": host},
        )

    return parsed


# ---------------------------------------------------------------------------
# HTTP fetching
# ---------------------------------------------------------------------------


def fetch_response(
    url: str,
    timeout: float,
    max_bytes: int,
    mode: Literal["text", "download"] = "text",
) -> Dict[str, Any]:
    """Fetch URL and return response metadata + body bytes.

    mode="text" (default): reject responses whose Content-Type is not
        HTML or text-like. Used by the text extraction path.
    mode="download": reject responses whose Content-Type is not in the
        binary download allowlist (image/*, application/pdf).
    """
    parsed = validate_url(url)
    url_str = str(parsed)

    with httpx.Client(
        follow_redirects=True,
        max_redirects=5,
        timeout=httpx.Timeout(timeout),
    ) as client:
        response = client.get(
            url_str,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html, application/xhtml+xml, text/plain, "
                "text/markdown, application/json, application/xml, text/xml;q=0.9, */*;q=0.1",
            },
        )

        final_url = str(response.url)
        # Re-validate final URL after redirects
        if final_url != url_str:
            validate_url(final_url)

        content_type = response.headers.get("content-type")

        if mode == "download":
            allowed = is_download_supported(content_type)
            unsupported_msg = (
                f"Content type '{content_type or 'unknown'}' is not supported in --download mode. "
                f"Allowed: {sorted(SUPPORTED_DOWNLOAD_TYPES)}"
            )
        else:
            category = categorize_content(content_type)
            allowed = category != "unsupported"
            unsupported_msg = f"Unsupported content type: {content_type or 'unknown'}"

        if not allowed:
            raise FetchError(
                unsupported_msg,
                {
                    "url": url_str,
                    "finalUrl": final_url,
                    "statusCode": response.status_code,
                    "contentType": content_type,
                },
            )

        # Stream body with size limit
        body_chunks: List[bytes] = []
        total_bytes = 0
        for chunk in response.iter_bytes(chunk_size=65536):
            total_bytes += len(chunk)
            if total_bytes > max_bytes:
                raise FetchError(
                    f"Response exceeds maximum fetch size ({max_bytes} bytes)",
                    {
                        "url": url_str,
                        "finalUrl": final_url,
                        "statusCode": response.status_code,
                        "contentType": content_type,
                        "maxBytes": max_bytes,
                    },
                )
            body_chunks.append(chunk)

        body = b"".join(body_chunks)

        return {
            "url": url_str,
            "finalUrl": final_url,
            "statusCode": response.status_code,
            "contentType": content_type,
            "body": body,
            "fetchedBytes": total_bytes,
        }


# ---------------------------------------------------------------------------
# Content categorization
# ---------------------------------------------------------------------------


def categorize_content(content_type: Optional[str]) -> ContentCategory:
    """Determine if the content type is HTML, text-like, or unsupported."""
    if not content_type:
        return "html"  # Assume HTML if no content-type

    media_type = content_type.split(";")[0].strip().lower()

    if media_type in SUPPORTED_HTML_TYPES:
        return "html"
    if media_type in SUPPORTED_TEXT_TYPES or media_type in SUPPORTED_DATA_TYPES:
        return "text_like"

    return "unsupported"


def is_download_supported(content_type: Optional[str]) -> bool:
    """Return True if the content type is in the binary download allowlist."""
    if not content_type:
        return False
    media_type = content_type.split(";")[0].strip().lower()
    return media_type in SUPPORTED_DOWNLOAD_TYPES


def media_type_of(content_type: Optional[str]) -> Optional[str]:
    """Return the lowercased media type without parameters, or None."""
    if not content_type:
        return None
    return content_type.split(";")[0].strip().lower() or None


def extension_for(content_type: Optional[str], url: str) -> str:
    """Pick a sensible file extension for a downloaded binary.

    Order of preference:
      1. Explicit mapping in _DOWNLOAD_EXTENSIONS for the Content-Type.
      2. Extension already present in the URL path (lower-cased).
      3. mimetypes.guess_extension() on the media type.
      4. ".bin" fallback.
    """
    media_type = media_type_of(content_type)

    if media_type and media_type in _DOWNLOAD_EXTENSIONS:
        return _DOWNLOAD_EXTENSIONS[media_type]

    # Try the URL path before falling back.
    try:
        url_path = httpx.URL(url).path
    except Exception:
        url_path = ""

    url_ext = Path(url_path).suffix.lower()
    if url_ext and len(url_ext) <= 6 and url_ext.isascii():
        return url_ext

    if media_type:
        guessed = mimetypes.guess_extension(media_type)
        if guessed:
            return guessed

    return ".bin"


def is_supported_content_type(content_type: Optional[str]) -> bool:
    """Return True if the content type is in the supported set."""
    return categorize_content(content_type) != "unsupported"


# ---------------------------------------------------------------------------
# Body decoding
# ---------------------------------------------------------------------------


def decode_body(body: bytes, content_type: Optional[str]) -> str:
    """Decode bytes to string using charset from Content-Type or UTF-8 fallback."""
    charset = "utf-8"
    if content_type:
        for part in content_type.split(";"):
            part = part.strip()
            if part.lower().startswith("charset="):
                charset = part[8:].strip().strip("'\"")
                break

    try:
        return body.decode(charset)
    except (LookupError, UnicodeDecodeError):
        return body.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Content extraction
# ---------------------------------------------------------------------------

# Tags to strip from extracted semantic containers.
# Note: header/footer are NOT stripped here because the semantic container
# (article/main) IS the content boundary — page-level header/footer are
# already excluded. Stripping them inside the container risks losing
# article-level headings and metadata.
SemanticStripTags = ["script", "style", "noscript", "nav", "form", "button"]

# Anchor-link classes known to be decorative heading icons (additive).
AnchorClasses = {"anchor", "headerlink", "header-anchor"}

# Glyph-only text patterns that indicate decorative anchor links.
AnchorGlyphs = {"#", "¶", "§"}


def find_main_container(soup: BeautifulSoup) -> Optional[Tag]:
    """Return the first semantic main-content element, or None.

    Search order: <article>, <main>, [role="main"].
    This is the primary content-detection heuristic used before falling
    back to readability-lxml.
    """
    for selector in ("article", "main"):
        container = soup.find(selector)
        if container is not None:
            return container
    return soup.find(attrs={"role": "main"})


def extract_title(soup: BeautifulSoup, container: Optional[Tag]) -> Optional[str]:
    """Return the document title for the semantic extraction path.

    Search order: ``<title>`` in ``<head>``, then the first heading
    (``<h1>``–``<h6>``) in document order inside *container*, then ``None``.
    """
    # 1. <title> from <head>
    head_title = soup.find("title")
    if head_title:
        text = head_title.get_text(strip=True)
        if text:
            return text

    # 2. First heading in document order inside the container
    if container is not None:
        heading = container.find(["h1", "h2", "h3", "h4", "h5", "h6"])
        if heading is not None:
            text = heading.get_text(strip=True)
            if text:
                return text

    return None


def strip_boilerplate(container: Tag) -> None:
    """Remove non-content elements from *container* in-place.

    Strips scripts, styles, navigation, site chrome, forms, and buttons.
    """
    for tag in container.find_all(SemanticStripTags):
        tag.decompose()


def strip_anchor_links(container: Tag) -> None:
    """Remove decorative heading-anchor links from *container* in-place.

    An anchor link is removed when its class matches a known pattern
    (``anchor``, ``headerlink``, ``header-anchor``) **or** its text
    content is a decorative glyph (``#``, ``¶``, ``§``) or empty.
    """
    for a_tag in container.find_all("a"):
        text = a_tag.get_text(strip=True)
        if text in AnchorGlyphs or text == "":
            a_tag.decompose()
            continue
        classes = set(a_tag.get("class", []))
        if classes & AnchorClasses:
            a_tag.decompose()


def _extract_via_readability(
    html_text: str,
    url: str,
    output_format: OutputFormat,
) -> ExtractedDocument:
    """Extract content using readability-lxml (fallback path)."""
    warnings: List[str] = []

    doc = ReadabilityDoc(html_text, url=url)
    title = doc.short_title() or doc.title() or None
    summary_html = doc.summary()

    soup = BeautifulSoup(summary_html, "lxml")
    for tag in soup.find_all(["script", "style", "noscript", "nav", "footer", "header"]):
        tag.decompose()

    readable_html = str(soup)
    extracted_text = soup.get_text(separator="\n", strip=True)

    if len(extracted_text.strip()) < 50:
        warnings.append(
            "Readability extraction returned very little content; "
            "page may require JavaScript. Falling back to raw HTML text."
        )
        full_soup = BeautifulSoup(html_text, "lxml")
        for tag in full_soup.find_all(["script", "style", "noscript"]):
            tag.decompose()
        body = full_soup.find("body")
        if body:
            extracted_text = body.get_text(separator="\n", strip=True)
        else:
            extracted_text = full_soup.get_text(separator="\n", strip=True)

    if output_format == "markdown":
        try:
            content = md(
                readable_html,
                heading_style="ATX",
                bullets="-",
                strip=["script", "style", "noscript", "nav", "footer", "header"],
            )
            content = normalize_whitespace(content)
            if len(content.strip()) < 50:
                warnings.append(
                    "Markdown conversion produced minimal output; falling back to plain text."
                )
                content = extracted_text
        except Exception as exc:
            warnings.append(f"Markdown conversion failed: {exc}; using plain text.")
            content = extracted_text
    else:
        content = extracted_text

    return {"title": title, "content": normalize_whitespace(content), "warnings": warnings}


def extract_html(
    html_text: str,
    url: str,
    output_format: OutputFormat,
) -> ExtractedDocument:
    """Extract readable content from HTML.

    Primary path: semantic container (``<article>`` / ``<main>`` / ``[role="main"]``)
    with markdownify conversion — preserves headings, code blocks, and structure.
    Fallback: readability-lxml when no container is found or its output is too short.
    """
    warnings: List[str] = []
    full_soup = BeautifulSoup(html_text, "lxml")

    # --- Primary: semantic container extraction ---
    container = find_main_container(full_soup)
    use_readability = False

    if container is not None:
        # Clone so we don't mutate the parsed tree (readability may need it)
        from copy import copy
        container = copy(container)
        strip_boilerplate(container)
        strip_anchor_links(container)

        extracted_text = container.get_text(separator="\n", strip=True)
        if len(extracted_text.strip()) < 50:
            warnings.append(
                "Semantic container contained very little text; "
                "falling back to readability extraction."
            )
            use_readability = True
    else:
        use_readability = True

    if use_readability:
        return _extract_via_readability(html_text, url, output_format)

    title = extract_title(full_soup, container)

    if output_format == "markdown":
        try:
            content = md(
                str(container),
                heading_style="ATX",
                bullets="-",
                strip=["script", "style", "noscript", "nav", "footer", "header"],
            )
            content = normalize_whitespace(content)
            if len(content.strip()) < 50:
                warnings.append(
                    "Markdown conversion produced minimal output; falling back to plain text."
                )
                content = extracted_text
        except Exception as exc:
            warnings.append(f"Markdown conversion failed: {exc}; using plain text.")
            content = extracted_text
    else:
        content = extracted_text

    return {
        "title": title,
        "content": normalize_whitespace(content),
        "warnings": warnings,
    }


def extract_text_like(
    text: str,
    content_type: Optional[str],
    output_format: OutputFormat,
) -> ExtractedDocument:
    """Extract content from plain text, markdown, JSON, or XML responses."""
    title: Optional[str] = None
    warnings: List[str] = []
    content = text
    media_type = (content_type or "").split(";")[0].strip().lower()

    # For JSON, try pretty-printing
    if media_type == "application/json":
        try:
            parsed = json.loads(text)
            content = json.dumps(parsed, indent=2, ensure_ascii=False)
        except json.JSONDecodeError:
            content = text
            warnings.append("Content type is JSON but body is not valid JSON; returning raw text.")

    # For XML, keep raw XML
    if media_type in ("application/xml", "text/xml"):
        content = normalize_whitespace(text)

    # For markdown, use directly
    if media_type == "text/markdown" and output_format == "text":
        # Convert markdown to plain text if text output requested
        soup = BeautifulSoup(f"<pre>{text}</pre>", "lxml")
        content = soup.get_text(separator="\n", strip=True)

    return {"title": title, "content": normalize_whitespace(content), "warnings": warnings}


# ---------------------------------------------------------------------------
# Text utilities
# ---------------------------------------------------------------------------


def normalize_whitespace(text: str) -> str:
    """Collapse excessive blank lines and trim trailing whitespace."""
    lines = text.splitlines()
    result: List[str] = []
    blank_count = 0
    for line in lines:
        stripped = line.rstrip()
        if stripped:
            result.append(stripped)
            blank_count = 0
        else:
            blank_count += 1
            if blank_count <= 2:
                result.append("")
    # Trim leading/trailing blank lines
    while result and result[0] == "":
        result.pop(0)
    while result and result[-1] == "":
        result.pop()
    return "\n".join(result)


def truncate_content(text: str, max_chars: int) -> Tuple[str, bool]:
    """Truncate text to max_chars, with message if truncated."""
    max_chars = max(1_000, min(max_chars, 100_000))
    if len(text) <= max_chars:
        return text, False
    # Try to break at a natural boundary within the limit
    truncated = text[:max_chars]
    last_newline = truncated.rfind("\n")
    if last_newline > max_chars // 2:
        truncated = text[:last_newline]
    truncated += (
        f"\n\n[... Content truncated at {max_chars} characters. "
        f"Total document length: {len(text)} characters. "
        f"Use --max-chars to increase limit up to 100,000.]"
    )
    return truncated, True


# ---------------------------------------------------------------------------
# JSON response builders
# ---------------------------------------------------------------------------


def download_json(
    url: str,
    final_url: str,
    status_code: int,
    content_type: Optional[str],
    path: str,
    file_name: str,
    byte_size: int,
    sha1: str,
    warnings: List[str],
) -> Dict[str, Any]:
    """Build success JSON response for --download mode."""
    return {
        "url": url,
        "finalUrl": final_url,
        "statusCode": status_code,
        "contentType": content_type,
        "path": path,
        "fileName": file_name,
        "byteSize": byte_size,
        "sha1": sha1,
        "warnings": warnings,
    }


def success_json(
    url: str,
    final_url: str,
    status_code: int,
    content_type: Optional[str],
    title: Optional[str],
    output_format: OutputFormat,
    content: str,
    truncated: bool,
    fetched_bytes: int,
    warnings: List[str],
) -> Dict[str, Any]:
    """Build success JSON response."""
    return {
        "url": url,
        "finalUrl": final_url,
        "statusCode": status_code,
        "contentType": content_type,
        "title": title,
        "format": output_format,
        "content": content,
        "truncated": truncated,
        "contentLength": len(content),
        "fetchedBytes": fetched_bytes,
        "warnings": warnings,
    }


def error_json(
    message: str,
    url: str,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build error JSON response."""
    result: Dict[str, Any] = {
        "error": message,
        "url": url,
    }
    if details:
        result["details"] = details
    return result


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def run_download(
    url: str,
    timeout: float,
    max_bytes: int,
) -> Dict[str, Any]:
    """Download a binary response to a temp file and return its metadata.

    Raises FetchError on validation/HTTP/MIME/size failures using the same
    error envelope as the text path; never returns a partial file.
    """
    fetch_result = fetch_response(
        url=url,
        timeout=timeout,
        max_bytes=max_bytes,
        mode="download",
    )

    final_url = fetch_result["finalUrl"]
    status_code = fetch_result["statusCode"]
    content_type = fetch_result.get("contentType")
    body: bytes = fetch_result["body"]
    fetched_bytes = fetch_result["fetchedBytes"]

    if not body:
        raise FetchError(
            "Response body was empty; nothing to download.",
            {
                "url": url,
                "finalUrl": final_url,
                "statusCode": status_code,
                "contentType": content_type,
            },
        )

    # SHA-1 is used purely as a content address for the temp file name;
    # not for security.
    sha1 = hashlib.sha1(body).hexdigest()  # noqa: S324
    extension = extension_for(content_type, final_url)
    file_name = f"web-fetch-{sha1[:12]}{extension}"
    # Use the process-shared temp dir; cleanup is delegated to the OS.
    target_dir = tempfile.gettempdir()
    target_path = str(Path(target_dir) / file_name)

    # Refuse to clobber an unrelated file at the same path.
    target = Path(target_path)
    if target.exists() and target.stat().st_size != len(body):
        raise FetchError(
            f"Refusing to overwrite existing file at {target_path} with different content.",
            {"url": url, "path": target_path},
        )

    target.write_bytes(body)

    warnings: List[str] = []
    if status_code and status_code >= 400:
        warnings.append(f"HTTP {status_code} — saved body anyway, but the response is an error page.")

    return download_json(
        url=url,
        final_url=final_url,
        status_code=status_code,
        content_type=content_type,
        path=target_path,
        file_name=file_name,
        byte_size=len(body),
        sha1=sha1,
        warnings=warnings,
    )


def main(argv: Optional[List[str]] = None) -> int:
    """Validate, fetch, extract, print JSON. Return 0 on success, 1 on error."""
    args = parse_args(argv)

    try:
        if args.download:
            result = run_download(
                url=args.url,
                timeout=float(args.timeout),
                max_bytes=args.max_bytes,
            )
            print(json.dumps(result, ensure_ascii=False))
            return 0

        # Fetch
        fetch_result = fetch_response(
            url=args.url,
            timeout=float(args.timeout),
            max_bytes=args.max_bytes,
        )

        url = fetch_result["url"]
        final_url = fetch_result["finalUrl"]
        status_code = fetch_result["statusCode"]
        content_type = fetch_result.get("contentType")
        body = fetch_result["body"]
        fetched_bytes = fetch_result["fetchedBytes"]

        # Decode
        text = decode_body(body, content_type)

        # Categorize and extract
        category = categorize_content(content_type)

        if category == "html":
            doc = extract_html(text, url, args.format)
        else:
            doc = extract_text_like(text, content_type, args.format)

        title = doc["title"]
        content = doc["content"]
        base_warnings = doc.get("warnings", [])

        # Truncate
        content, truncated = truncate_content(content, args.max_chars)

        # Build success JSON
        result = success_json(
            url=url,
            final_url=final_url,
            status_code=status_code,
            content_type=content_type,
            title=title,
            output_format=args.format,
            content=content,
            truncated=truncated,
            fetched_bytes=fetched_bytes,
            warnings=base_warnings,
        )

        print(json.dumps(result, ensure_ascii=False))
        return 0

    except FetchError as exc:
        print(json.dumps(error_json(exc.message, args.url, exc.details), ensure_ascii=False))
        return 1

    except Exception as exc:
        print(
            json.dumps(
                error_json(f"Internal error: {exc}", args.url),
                ensure_ascii=False,
            )
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
