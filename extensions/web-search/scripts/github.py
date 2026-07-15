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


def _headers(token: Optional[str]) -> dict:
    """Build request headers, optionally adding GITHUB_TOKEN auth."""
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "pi-agent/1.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
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
    # Fall back to env var when token is not explicitly provided
    if token is None:
        token = os.environ.get("GITHUB_TOKEN")

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
