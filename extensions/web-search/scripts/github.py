"""GitHub URL classification and ref resolution.

This module classifies ``github.com`` URLs into resource families
(repository-root, tree, blob, or non-specialized) and resolves
the identified ref and path components.

Functions:
    classify: URL string in → GitHubResource | NonSpecialized
    resolve_ref: Resolve an ambiguous ref string against the GitHub API.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import List, Literal, Optional, Union
from urllib.parse import quote, urlparse, unquote

import httpx

ResourceType = Literal["repository_root", "tree", "blob"]


@dataclass
class GitHubResource:
    """A recognized GitHub resource.

    Attributes:
        type: The resource family (repository_root, tree, or blob).
        owner: Repository owner (user or organisation).
        repo: Repository name.
        ref: Branch, tag, or commit SHA (None for repository-root URLs).
        path: Path within the repository (None for repo-root).
    """

    type: ResourceType
    owner: str
    repo: str
    ref: Optional[str] = None
    path: Optional[str] = None


@dataclass
class NonSpecialized:
    """A URL that is not a recognized GitHub resource.

    Attributes:
        url: The original URL.
        reason: Human-readable explanation.
    """

    url: str
    reason: str


def classify(url: str) -> Union[GitHubResource, NonSpecialized]:
    """Classify a ``github.com`` URL into a resource family.

    Args:
        url: The URL to classify.

    Returns:
        A ``GitHubResource`` if the URL is a recognised repository-root,
        tree, or blob URL.  A ``NonSpecialized`` result otherwise.
    """
    parsed = urlparse(url)

    # Must be github.com or www.github.com
    host = parsed.hostname
    if host is None:
        return NonSpecialized(url=url, reason="no hostname")
    if host not in ("github.com", "www.github.com"):
        return NonSpecialized(url=url, reason=f"unrecognised host: {host}")

    raw_path = parsed.path.rstrip("/")

    # Minimum path: /<owner>/<repo>
    raw_segments = [s for s in raw_path.split("/") if s]
    if len(raw_segments) < 2:
        return NonSpecialized(url=url, reason="path too short for owner/repo")

    owner = unquote(raw_segments[0])
    repo = unquote(raw_segments[1]).removesuffix(".git")

    if len(raw_segments) == 2:
        return GitHubResource(type="repository_root", owner=owner, repo=repo)

    # 3+ segments: check the third segment
    resource_indicator = raw_segments[2]

    if resource_indicator in ("tree", "blob") and len(raw_segments) >= 3:
        # Heuristic: first segment after tree/blob is the ref,
        # remaining segments are the path.
        ref = unquote(raw_segments[3]) if len(raw_segments) > 3 else None
        path_segments = [unquote(s) for s in raw_segments[4:]]
        path = "/".join(path_segments) if path_segments else None
        resource_type: ResourceType = "tree" if resource_indicator == "tree" else "blob"
        return GitHubResource(
            type=resource_type,
            owner=owner,
            repo=repo,
            ref=ref,
            path=path,
        )

    return NonSpecialized(url=url, reason="unrecognised URL pattern")


# ---------------------------------------------------------------------------
# Ref resolution
# ---------------------------------------------------------------------------

GITHUB_API = "https://api.github.com"

# Regex for a full 40-character hex commit SHA
_SHA_RE = re.compile(r"^[0-9a-f]{40}$", re.IGNORECASE)


@dataclass
class ResolvedRef:
    """Result of resolving an ambiguous GitHub ref against the API.

    Attributes:
        ref: The resolved branch, tag, or commit SHA.
        path_remainder: The portion of the original ref string that is not
            part of the ref — i.e., the resource path within the repository.
            ``None`` when the entire string was consumed by the ref.
    """

    ref: str
    path_remainder: Optional[str] = None


def _prefixes(ref: str) -> List[str]:
    """Generate all prefixes of *ref* from longest to shortest."""
    parts = ref.split("/")
    return ["/".join(parts[:i]) for i in range(len(parts), 0, -1)]


def _path_remainder(ref: str, full_ref: str) -> Optional[str]:
    """Return the portion of *full_ref* after the resolved *ref* prefix."""
    if ref == full_ref:
        return None
    remainder = full_ref[len(ref) + 1:]  # +1 for the separating "/"
    return remainder if remainder else None


def _resolve_token(token: Optional[str]) -> Optional[str]:
    """Resolve the effective GITHUB_TOKEN from explicit arg or environment."""
    return token if token is not None else os.environ.get("GITHUB_TOKEN")


def _headers(token: Optional[str]) -> dict:
    """Build request headers, optionally adding GITHUB_TOKEN auth."""
    effective = _resolve_token(token)
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "pi-agent/1.0",
    }
    if effective:
        headers["Authorization"] = f"Bearer {effective}"
    return headers


def resolve_ref(
    owner: str,
    repo: str,
    full_ref: str,
    *,
    token: Optional[str] = None,
) -> ResolvedRef:
    """Resolve an ambiguous GitHub ref string against the GitHub API.

    If the entire *full_ref* starts with a valid 40-character commit SHA,
    the SHA is used immediately without API calls.  Otherwise, each prefix
    of *full_ref* (longest first) is tried as a branch name, then as a tag
    name.  The longest valid ref wins.

    Args:
        owner: Repository owner.
        repo: Repository name.
        full_ref: The full ref string to resolve (may include path segments).
        token: Optional ``GITHUB_TOKEN`` for authenticated requests.

    Returns:
        A ``ResolvedRef`` with the resolved ref and any path remainder.

    Raises:
        ValueError: When *full_ref* cannot be resolved.
    """
    token = _resolve_token(token)

    # --- Short-circuit: commit SHA ---
    sha = full_ref[:40]
    if _SHA_RE.match(sha):
        return ResolvedRef(
            ref=sha,
            path_remainder=_path_remainder(sha, full_ref),
        )

    candidates = _prefixes(full_ref)

    # --- Try branches ---
    for prefix in candidates:
        url = f"{GITHUB_API}/repos/{owner}/{repo}/branches/{quote(prefix, safe='')}"
        resp = httpx.get(url, headers=_headers(token))
        if resp.status_code == 200:
            return ResolvedRef(
                ref=prefix,
                path_remainder=_path_remainder(prefix, full_ref),
            )

    # --- Try tags (via git ref API) ---
    for prefix in candidates:
        url = f"{GITHUB_API}/repos/{owner}/{repo}/git/ref/tags/{quote(prefix, safe='')}"
        resp = httpx.get(url, headers=_headers(token))
        if resp.status_code == 200:
            return ResolvedRef(
                ref=prefix,
                path_remainder=_path_remainder(prefix, full_ref),
            )

    # --- Try commit SHA ---
    sha = full_ref[:40]
    if _SHA_RE.match(sha):
        return ResolvedRef(
            ref=sha,
            path_remainder=_path_remainder(sha, full_ref),
        )

    raise ValueError(
        f"cannot resolve ref '{full_ref}' for {owner}/{repo}"
    )


# ---------------------------------------------------------------------------
# GitHub resource fetch (structured error handling)
# ---------------------------------------------------------------------------


def _build_api_url(resource: GitHubResource) -> str:
    """Build the GitHub API URL for a recognised resource."""
    if resource.type == "repository_root":
        return f"{GITHUB_API}/repos/{resource.owner}/{resource.repo}"
    # tree and blob both use the contents API; differences are handled
    # by the caller based on the response shape.
    path = resource.path or ""
    url = f"{GITHUB_API}/repos/{resource.owner}/{resource.repo}/contents/{quote(path, safe='')}"
    if resource.ref:
        url += f"?ref={quote(resource.ref, safe='')}"
    return url


def _http_error_details(response: httpx.Response, authenticated: bool) -> dict:
    """Build structured error details from an HTTP error response.

    Extracts rate-limit metadata from headers when present.
    """
    details: dict = {
        "statusCode": response.status_code,
        "authenticated": authenticated,
    }

    # Rate-limit headers (present on 429 and sometimes on 403)
    remaining = response.headers.get("x-ratelimit-remaining")
    if remaining is not None:
        details["remaining"] = int(remaining)
    reset_epoch = response.headers.get("x-ratelimit-reset")
    if reset_epoch is not None:
        import datetime
        details["resetAt"] = datetime.datetime.fromtimestamp(
            int(reset_epoch), tz=datetime.UTC
        ).isoformat()

    return details


def fetch_github_resource(url: str, *, token: Optional[str] = None) -> dict:
    """Fetch a recognised GitHub resource through the GitHub API.

    Classifies the URL and, if it is a recognised repository-root, tree,
    or blob URL, makes the appropriate GitHub API call.  On success the
    API response JSON is returned wrapped in a metadata dict.  On failure
    a structured error dict is returned — **no** generic HTML extraction
    fallback occurs.

    Args:
        url: The GitHub URL to fetch.
        token: Optional ``GITHUB_TOKEN`` for authenticated requests.

    Returns:
        A dict representing the result.  Success shape:

        .. code-block:: python

            {
                "url": str,
                "finalUrl": str,
                "statusCode": int,
                "contentType": "application/json",
                "data": dict | list,  # parsed API response
            }

        Error shape:

        .. code-block:: python

            {
                "error": str,
                "url": str,
                "details": dict,
            }
    """
    token = _resolve_token(token)
    authenticated = token is not None

    # 1. Classify URL
    classified = classify(url)
    if isinstance(classified, NonSpecialized):
        return {
            "error": f"Not a recognised GitHub resource: {classified.reason}",
            "url": url,
            "details": {},
        }

    # 2. Build API URL
    api_url = _build_api_url(classified)

    # 3. Make API call — reuse shared header builder
    try:
        response = httpx.get(api_url, headers=_headers(token), follow_redirects=True, timeout=20.0)
    except Exception as exc:
        return {
            "error": f"GitHub API request failed: {exc}",
            "url": url,
            "details": {"authenticated": authenticated},
        }

    final_url = str(response.url)

    # 4. Handle error responses
    if response.status_code >= 400:
        details = _http_error_details(response, authenticated)
        return {
            "error": f"GitHub API returned {response.status_code}: {response.reason_phrase}",
            "url": url,
            "details": details,
        }

    # 5. Check for unexpected media type (GitHub API always returns JSON)
    response_content_type = response.headers.get("content-type", "")
    if response_content_type and "json" not in response_content_type.lower():
        # GitHub's API always returns JSON (application/json or vendor-scoped
        # variants like application/vnd.github.v3+json). Anything else (HTML,
        # plain text, binary) is unexpected.
        return {
            "error": f"GitHub API returned unexpected media type: {response_content_type}",
            "url": url,
            "details": {
                "statusCode": response.status_code,
                "contentType": response_content_type,
                "authenticated": authenticated,
            },
        }

    # 6. Validate JSON body
    try:
        data = response.json()
    except Exception:
        return {
            "error": "GitHub API returned malformed JSON",
            "url": url,
            "details": {
                "statusCode": response.status_code,
                "contentType": response_content_type,
                "authenticated": authenticated,
            },
        }

    # 6. Success
    content_type = response.headers.get("content-type", "application/json")
    return {
        "url": url,
        "finalUrl": final_url,
        "statusCode": response.status_code,
        "contentType": content_type,
        "data": data,
    }
