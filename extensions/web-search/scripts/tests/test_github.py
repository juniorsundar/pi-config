"""Tests for the GitHub URL classification and ref resolution module."""

from __future__ import annotations

import httpx
import pytest

from github import GitHubResource, NonSpecialized, ResolvedRef, classify, fetch_github_resource, resolve_ref


# ===========================================================================
# Repository-root URLs
# ===========================================================================

class TestRepositoryRoot:
    """Repository-root URLs with and without .git suffix and www alias."""

    def test_plain_repository_root(self):
        """A plain https://github.com/owner/repo URL is a repository-root resource."""
        result = classify("https://github.com/owner/repo")
        assert isinstance(result, GitHubResource)
        assert result.type == "repository_root"
        assert result.owner == "owner"
        assert result.repo == "repo"
        assert result.ref is None
        assert result.path is None

    def test_with_git_suffix(self):
        """A .git suffix is stripped from the repo name."""
        result = classify("https://github.com/owner/repo.git")
        assert isinstance(result, GitHubResource)
        assert result.type == "repository_root"
        assert result.owner == "owner"
        assert result.repo == "repo"
        assert result.ref is None

    def test_with_www_alias(self):
        """www.github.com is accepted."""
        result = classify("https://www.github.com/owner/repo")
        assert isinstance(result, GitHubResource)
        assert result.type == "repository_root"
        assert result.owner == "owner"
        assert result.repo == "repo"

    def test_with_www_and_git(self):
        """www.github.com with .git suffix."""
        result = classify("https://www.github.com/owner/repo.git")
        assert isinstance(result, GitHubResource)
        assert result.type == "repository_root"
        assert result.owner == "owner"
        assert result.repo == "repo"


# ===========================================================================
# Tree URLs
# ===========================================================================

class TestTreeUrls:
    """Tree URLs with ref and optional path."""

    def test_tree_with_ref_only(self):
        """/tree/<ref> with no path component."""
        result = classify("https://github.com/owner/repo/tree/main")
        assert isinstance(result, GitHubResource)
        assert result.type == "tree"
        assert result.owner == "owner"
        assert result.repo == "repo"
        assert result.ref == "main"
        assert result.path is None

    def test_tree_with_ref_and_path(self):
        """/tree/<ref>/<path> splits ref and path at the first segment."""
        result = classify("https://github.com/owner/repo/tree/main/src/lib")
        assert isinstance(result, GitHubResource)
        assert result.type == "tree"
        assert result.ref == "main"
        assert result.path == "src/lib"

    def test_tree_with_slash_ref_heuristic(self):
        """Ambiguous slash-containing ref: first segment is heuristic ref."""
        result = classify("https://github.com/owner/repo/tree/feature/long/src")
        assert isinstance(result, GitHubResource)
        assert result.type == "tree"
        assert result.ref == "feature"
        assert result.path == "long/src"


# ===========================================================================
# Blob URLs
# ===========================================================================

class TestBlobUrls:
    """Blob URLs with ref and optional path."""

    def test_blob_with_ref_only(self):
        """/blob/<ref> with no path component."""
        result = classify("https://github.com/owner/repo/blob/main")
        assert isinstance(result, GitHubResource)
        assert result.type == "blob"
        assert result.owner == "owner"
        assert result.repo == "repo"
        assert result.ref == "main"
        assert result.path is None

    def test_blob_with_ref_and_path(self):
        """/blob/<ref>/<path> splits ref and path."""
        result = classify("https://github.com/owner/repo/blob/main/README.md")
        assert isinstance(result, GitHubResource)
        assert result.type == "blob"
        assert result.ref == "main"
        assert result.path == "README.md"

    def test_blob_with_nested_path(self):
        """/blob/<ref>/<path/to/file> splits correctly."""
        result = classify("https://github.com/owner/repo/blob/main/src/lib/utils.py")
        assert isinstance(result, GitHubResource)
        assert result.type == "blob"
        assert result.ref == "main"
        assert result.path == "src/lib/utils.py"


# ===========================================================================
# Percent-encoded paths
# ===========================================================================

class TestPercentEncoding:
    """Percent-encoded path segments are decoded."""

    def test_percent_encoded_path(self):
        """A percent-encoded file name is decoded in the path."""
        result = classify("https://github.com/owner/repo/blob/main/src/file%20name.py")
        assert isinstance(result, GitHubResource)
        assert result.type == "blob"
        assert result.path == "src/file name.py"

    def test_percent_encoded_ref(self):
        """Percent-encoding in the ref segment is decoded."""
        result = classify("https://github.com/owner/repo/tree/feature%2Fname/src")
        assert isinstance(result, GitHubResource)
        assert result.type == "tree"
        assert result.ref == "feature/name"
        assert result.path == "src"

    def test_percent_encoded_owner(self):
        """Percent-encoding in the owner segment."""
        result = classify("https://github.com/owner%2Fname/repo/tree/main")
        assert isinstance(result, GitHubResource)
        assert result.type == "tree"
        assert result.owner == "owner/name"


# ===========================================================================
# Non-specialized URLs
# ===========================================================================

class TestNonSpecialized:
    """URLs that should be classified as non-specialized."""

    def test_issues(self):
        """Issues URL is non-specialized."""
        result = classify("https://github.com/owner/repo/issues/42")
        assert isinstance(result, NonSpecialized)

    def test_pull_request(self):
        """Pull request URL is non-specialized."""
        result = classify("https://github.com/owner/repo/pull/42")
        assert isinstance(result, NonSpecialized)

    def test_releases(self):
        """Releases URL is non-specialized."""
        result = classify("https://github.com/owner/repo/releases")
        assert isinstance(result, NonSpecialized)

    def test_commit(self):
        """Specific commit URL is non-specialized."""
        result = classify("https://github.com/owner/repo/commit/abc123")
        assert isinstance(result, NonSpecialized)

    def test_gist(self):
        """Gist URL is non-specialized."""
        result = classify("https://gist.github.com/owner/abc123")
        assert isinstance(result, NonSpecialized)

    def test_raw_content_host(self):
        """raw.githubusercontent.com is non-specialized."""
        result = classify("https://raw.githubusercontent.com/owner/repo/main/file.py")
        assert isinstance(result, NonSpecialized)

    def test_non_github_host(self):
        """A non-github.com URL is non-specialized."""
        result = classify("https://gitlab.com/owner/repo")
        assert isinstance(result, NonSpecialized)

    def test_no_hostname(self):
        """A URL with no hostname is non-specialized."""
        result = classify("not-a-url")
        assert isinstance(result, NonSpecialized)

    def test_too_short_path(self):
        """github.com with just a single path segment is non-specialized."""
        result = classify("https://github.com/owner")
        assert isinstance(result, NonSpecialized)


# ===========================================================================
# Malformed / edge cases
# ===========================================================================

class TestMalformed:
    """Invalid or malformed inputs produce NonSpecialized results."""

    def test_empty_string(self):
        """Empty string is non-specialized."""
        result = classify("")
        assert isinstance(result, NonSpecialized)

    def test_github_dot_com_no_path(self):
        """github.com with no path is non-specialized."""
        result = classify("https://github.com")
        assert isinstance(result, NonSpecialized)

    def test_trailing_slash(self):
        """Trailing slash on repo root is still recognized."""
        result = classify("https://github.com/owner/repo/")
        assert isinstance(result, GitHubResource)
        assert result.type == "repository_root"


# ===========================================================================
# Ref resolution — simple branch (no /
# ===========================================================================

class TestResolveRefSimpleBranch:
    """Simple branch names with no slash resolve directly."""

    def test_known_branch_resolves_mock(self, httpx_mock):
        """A known branch name resolves with no path remainder."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/main",
            status_code=200,
            json={"name": "main", "commit": {"sha": "abc"}},
        )
        result = resolve_ref("owner", "repo", "main")
        assert isinstance(result, ResolvedRef)
        assert result.ref == "main"
        assert result.path_remainder is None

    def test_unknown_branch_fails(self, httpx_mock):
        """An unknown branch returns a failure."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/nonexistent",
            status_code=404,
        )
        # tag check must also return 404
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/git/ref/tags/nonexistent",
            status_code=404,
        )
        with pytest.raises(ValueError, match="cannot resolve ref"):
            resolve_ref("owner", "repo", "nonexistent")


# ===========================================================================
# Ref resolution — slash-containing refs
# ===========================================================================

class TestResolveRefSlashContaining:
    """Slash-containing branch and tag names resolve to longest valid prefix."""

    def test_longest_branch_prefix_wins(self, httpx_mock):
        """Longest valid branch prefix is selected."""
        # Encoded form: feature%2Flong%2Fv2, feature%2Flong, feature
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/feature%2Flong%2Fv2",
            status_code=404,
        )
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/feature%2Flong",
            status_code=404,
        )
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/feature",
            status_code=200,
            json={"name": "feature", "commit": {"sha": "abc"}},
        )
        result = resolve_ref("owner", "repo", "feature/long/v2")
        assert isinstance(result, ResolvedRef)
        assert result.ref == "feature"
        assert result.path_remainder == "long/v2"

    def test_longest_tag_prefix_wins(self, httpx_mock):
        """Longest valid tag prefix is selected when branch not found."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/v1.0%2Frc1",
            status_code=404,
        )
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/v1.0",
            status_code=404,
        )
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/git/ref/tags/v1.0%2Frc1",
            status_code=200,
            json={
                "ref": "refs/tags/v1.0/rc1",
                "object": {"sha": "abc", "type": "tag"},
            },
        )
        result = resolve_ref("owner", "repo", "v1.0/rc1")
        assert isinstance(result, ResolvedRef)
        assert result.ref == "v1.0/rc1"
        assert result.path_remainder is None

    def test_path_remainder_extracted(self, httpx_mock):
        """Path suffix after the resolved ref is returned as path_remainder."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/feature%2Flong%2Fv2%2Fsrc%2Flib",
            status_code=404,
        )
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/feature%2Flong%2Fv2%2Fsrc",
            status_code=404,
        )
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/feature%2Flong%2Fv2",
            status_code=404,
        )
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/feature%2Flong",
            status_code=200,
            json={"name": "feature/long", "commit": {"sha": "abc"}},
        )
        result = resolve_ref("owner", "repo", "feature/long/v2/src/lib")
        assert isinstance(result, ResolvedRef)
        assert result.ref == "feature/long"
        assert result.path_remainder == "v2/src/lib"


# ===========================================================================
# Ref resolution — commit SHA
# ===========================================================================

class TestResolveRefCommitSha:
    """Commit SHAs are accepted as valid refs."""

    def test_valid_sha(self):
        """A valid 40-character hex SHA resolves without API calls."""
        sha = "a" * 40
        result = resolve_ref("owner", "repo", sha)
        assert isinstance(result, ResolvedRef)
        assert result.ref == sha
        assert result.path_remainder is None

    def test_invalid_sha_non_hex(self, httpx_mock):
        """A non-hex SHA fails if not a branch either."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/not-a-sha",
            status_code=404,
        )
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/git/ref/tags/not-a-sha",
            status_code=404,
        )
        with pytest.raises(ValueError, match="cannot resolve ref"):
            resolve_ref("owner", "repo", "not-a-sha")

    def test_sha_with_path_remainder(self):
        """A SHA can have a path remainder."""
        sha = "a" * 40
        result = resolve_ref("owner", "repo", f"{sha}/src/lib")
        assert isinstance(result, ResolvedRef)
        assert result.ref == sha
        assert result.path_remainder == "src/lib"


# ===========================================================================
# GITHUB_TOKEN confinement
# ===========================================================================

class TestGithubToken:
    """GITHUB_TOKEN is sent only to fixed GitHub API hosts."""

    def test_token_sent_in_authorization_header(self, httpx_mock):
        """When token is provided, API requests include Bearer auth."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/main",
            status_code=200,
            json={"name": "main", "commit": {"sha": "abc"}},
        )
        resolve_ref("owner", "repo", "main", token="ghp_my-token")

        request = httpx_mock.get_request()
        assert request is not None
        assert request.headers.get("Authorization") == "Bearer ghp_my-token"

    def test_no_token_no_authorization_header(self, httpx_mock):
        """When no token is given, no Authorization header is sent."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/main",
            status_code=200,
            json={"name": "main", "commit": {"sha": "abc"}},
        )
        resolve_ref("owner", "repo", "main", token=None)

        request = httpx_mock.get_request()
        assert request is not None
        assert "Authorization" not in request.headers

    def test_token_extracted_from_environment(self, httpx_mock, monkeypatch):
        """When GITHUB_TOKEN env var is set, it is used by default."""
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_env-token")
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/branches/main",
            status_code=200,
            json={"name": "main", "commit": {"sha": "abc"}},
        )
        resolve_ref("owner", "repo", "main")

        request = httpx_mock.get_request()
        assert request is not None
        assert request.headers.get("Authorization") == "Bearer ghp_env-token"


# ===========================================================================
# fetch_github_resource — structured error responses
# ===========================================================================

class TestFetchResource404:
    """A recognized GitHub URL that fails with 404 returns a structured error."""

    def test_unauthenticated_404_returns_structured_error(self, httpx_mock):
        """An unauthenticated request that gets a 404 returns a structured error with status 404."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/missing/contents/README.md?ref=main",
            status_code=404,
            json={"message": "Not Found", "documentation_url": "https://docs.github.com/rest"},
        )
        result = fetch_github_resource("https://github.com/owner/missing/blob/main/README.md")
        assert "error" in result
        assert "url" in result
        assert result["url"] == "https://github.com/owner/missing/blob/main/README.md"
        details = result.get("details", {})
        assert details.get("statusCode") == 404
        assert details.get("authenticated") is False

    def test_authenticated_404_returns_structured_error(self, httpx_mock):
        """An authenticated request that gets a 404 returns a structured error with authenticated=True."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/missing/contents/README.md?ref=main",
            status_code=404,
            json={"message": "Not Found", "documentation_url": "https://docs.github.com/rest"},
        )
        result = fetch_github_resource(
            "https://github.com/owner/missing/blob/main/README.md",
            token="ghp_my-token",
        )
        assert "error" in result
        details = result.get("details", {})
        assert details.get("statusCode") == 404
        assert details.get("authenticated") is True


class TestFetchResource401:
    """An unauthorized GitHub API response returns a structured 401 error."""

    def test_unauthorized_returns_structured_error(self, httpx_mock):
        """A 401 response returns a structured error with status 401."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/private/contents/README.md?ref=main",
            status_code=401,
            json={"message": "Bad credentials", "documentation_url": "https://docs.github.com/rest"},
        )
        result = fetch_github_resource(
            "https://github.com/owner/private/blob/main/README.md",
            token="ghp_bad-token",
        )
        assert "error" in result
        details = result.get("details", {})
        assert details.get("statusCode") == 401
        assert details.get("authenticated") is True


class TestFetchResource403:
    """A forbidden GitHub API response returns a structured 403 error."""

    def test_forbidden_returns_structured_error(self, httpx_mock):
        """A 403 (non-rate-limit) response returns a structured error."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/restricted/contents/README.md?ref=main",
            status_code=403,
            json={"message": "Forbidden", "documentation_url": "https://docs.github.com/rest"},
        )
        result = fetch_github_resource(
            "https://github.com/owner/restricted/blob/main/README.md",
        )
        assert "error" in result
        details = result.get("details", {})
        assert details.get("statusCode") == 403
        # No rate-limit headers → no "remaining" key
        assert "remaining" not in details
        assert details.get("authenticated") is False


class TestFetchResourceRateLimit:
    """Rate-limited responses include quota metadata and are returned immediately."""

    def test_429_with_quota_metadata(self, httpx_mock):
        """A 429 response with rate-limit headers returns structured error with quota metadata."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/contents/README.md?ref=main",
            status_code=429,
            headers={
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "1700000000",
            },
            json={"message": "API rate limit exceeded", "documentation_url": "https://docs.github.com/rest"},
        )
        result = fetch_github_resource(
            "https://github.com/owner/repo/blob/main/README.md",
            token="ghp_my-token",
        )
        assert "error" in result
        details = result.get("details", {})
        assert details.get("statusCode") == 429
        assert details.get("remaining") == 0
        assert "resetAt" in details
        assert details.get("authenticated") is True

    def test_rate_limited_without_quota_metadata(self, httpx_mock):
        """A rate-limited 429 without rate-limit headers still returns its status."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/contents/README.md?ref=main",
            status_code=429,
            json={"message": "API rate limit exceeded"},
        )
        result = fetch_github_resource(
            "https://github.com/owner/repo/blob/main/README.md",
        )
        assert "error" in result
        details = result.get("details", {})
        assert details.get("statusCode") == 429
        assert "remaining" not in details
        assert "resetAt" not in details
        assert details.get("authenticated") is False

    def test_rate_limited_403_with_headers(self, httpx_mock):
        """A rate-limited 403 with rate-limit headers is treated as rate-limited."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/contents/README.md?ref=main",
            status_code=403,
            headers={
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "1700000000",
            },
            json={"message": "Rate limit exceeded", "documentation_url": "https://docs.github.com/rest"},
        )
        result = fetch_github_resource(
            "https://github.com/owner/repo/blob/main/README.md",
            token="ghp_my-token",
        )
        assert "error" in result
        details = result.get("details", {})
        assert details.get("statusCode") == 403
        assert details.get("remaining") == 0
        assert "resetAt" in details
        assert details.get("authenticated") is True


class TestFetchResourceMalformedJSON:
    """A GitHub API response with malformed JSON returns a structured failure."""

    def test_malformed_json_returns_structured_error(self, httpx_mock):
        """A 200 response with malformed JSON body returns a malformed-JSON error."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/contents/README.md?ref=main",
            status_code=200,
            headers={"content-type": "application/json"},
            text="this is not json",
        )
        result = fetch_github_resource(
            "https://github.com/owner/repo/blob/main/README.md",
        )
        assert "error" in result
        assert "malformed json" in result["error"].lower()
        details = result.get("details", {})
        assert details.get("statusCode") == 200
        assert details.get("authenticated") is False


class TestFetchResource5xx:
    """GitHub API server errors return structured failures."""

    @pytest.mark.parametrize("status_code", [500, 502, 503])
    def test_server_error_returns_structured_error(self, httpx_mock, status_code):
        """A {status_code} response returns a structured error with that status."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/contents/README.md?ref=main",
            status_code=status_code,
            json={"message": "Server Error"},
        )
        result = fetch_github_resource(
            "https://github.com/owner/repo/blob/main/README.md",
        )
        assert "error" in result
        details = result.get("details", {})
        assert details.get("statusCode") == status_code
        assert details.get("authenticated") is False


class TestFetchResourceUnexpectedMediaType:
    """A GitHub API response with an unexpected media type returns a structured failure."""

    def test_unexpected_media_type_returns_structured_error(self, httpx_mock):
        """A 200 response with text/html instead of JSON returns an unexpected-media-type error."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/contents/README.md?ref=main",
            status_code=200,
            headers={"content-type": "text/html; charset=utf-8"},
            text="<html><body>Not JSON</body></html>",
        )
        result = fetch_github_resource(
            "https://github.com/owner/repo/blob/main/README.md",
        )
        assert "error" in result
        assert "unexpected media type" in result["error"].lower()
        details = result.get("details", {})
        assert details.get("statusCode") == 200
        assert "text/html" in details.get("contentType", "")

    def test_malformed_json_still_caught_when_content_type_ok(self, httpx_mock):
        """A response with application/json but non-JSON body returns a malformed-JSON error."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/contents/README.md?ref=main",
            status_code=200,
            headers={"content-type": "application/json; charset=utf-8"},
            text="this is not json",
        )
        result = fetch_github_resource(
            "https://github.com/owner/repo/blob/main/README.md",
        )
        assert "error" in result
        assert "malformed json" in result["error"].lower()


class TestFetchResourceSuccess:
    """A successful GitHub API response returns the expected success shape."""

    def test_success_returns_expected_shape(self, httpx_mock):
        """A 200 response returns a dict with url, finalUrl, statusCode, contentType, and data."""
        httpx_mock.add_response(
            url="https://api.github.com/repos/owner/repo/contents/README.md?ref=main",
            status_code=200,
            json={"name": "README.md", "content": "IyBQcm9qZWN0\n", "encoding": "base64"},
        )
        result = fetch_github_resource(
            "https://github.com/owner/repo/blob/main/README.md",
        )
        assert "error" not in result
        assert result.get("url") == "https://github.com/owner/repo/blob/main/README.md"
        assert isinstance(result.get("statusCode"), int)
        assert result["statusCode"] == 200
        assert "finalUrl" in result
        assert "contentType" in result
        assert "data" in result
        assert isinstance(result["data"], dict)
        assert result["data"]["name"] == "README.md"


class TestFetchResourceNonGitHub:
    """A URL that is not a recognized GitHub resource returns an appropriate error."""

    def test_non_github_host_returns_error(self):
        """A non-github.com URL returns a 'not a recognised GitHub resource' error."""
        result = fetch_github_resource("https://example.com/page")
        assert "error" in result
        assert "not a recognised" in result["error"].lower()
