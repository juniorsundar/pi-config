"""Tests for search.py — SearXNG search backend."""

from __future__ import annotations

import json
import httpx
import pytest
from search import main, normalize_result


# ---------------------------------------------------------------------------
# Unit: result normalization
# ---------------------------------------------------------------------------


def test_normalize_result_maps_searxng_fields():
    """SearXNG result fields url/title/content map to href/title/body."""
    normalized = normalize_result({
        "url": "https://example.com",
        "title": "Example Title",
        "content": "Example snippet.",
        "engines": ["google", "duckduckgo"],
        "score": 0.95,
        "publishedDate": "2024-01-01",
    })
    assert normalized == {
        "title": "Example Title",
        "href": "https://example.com",
        "body": "Example snippet.",
    }


def test_normalize_result_handles_missing_fields():
    """Missing fields default to empty strings."""
    assert normalize_result({}) == {"title": "", "href": "", "body": ""}


def test_normalize_result_handles_none_values():
    """None values become empty strings."""
    normalized = normalize_result({
        "url": None,
        "title": None,
        "content": None,
    })
    assert normalized == {"title": "", "href": "", "body": ""}


# ---------------------------------------------------------------------------
# Integration: CLI → SearXNG API → JSON output
# ---------------------------------------------------------------------------


def test_search_happy_path_returns_results(httpx_mock, capsys):
    """Full CLI invocation: correct SearXNG URL, JSON output with results."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test+query&safesearch=1&language=all",
        json={
            "query": "test query",
            "number_of_results": 2,
            "results": [
                {
                    "title": "First Result",
                    "url": "https://first.example.com",
                    "content": "First snippet.",
                },
                {
                    "title": "Second Result",
                    "url": "https://second.example.com",
                    "content": "Second snippet.",
                },
            ],
        },
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test query",
        "--max-results", "10",
    ])

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    assert exit_code == 0
    assert "results" in output
    assert len(output["results"]) == 2
    assert output["results"][0] == {
        "title": "First Result",
        "href": "https://first.example.com",
        "body": "First snippet.",
    }
    assert output["results"][1] == {
        "title": "Second Result",
        "href": "https://second.example.com",
        "body": "Second snippet.",
    }


def test_search_max_results_slices_client_side(httpx_mock, capsys):
    """maxResults is enforced client-side by slicing the response."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&language=all",
        json={
            "query": "test",
            "number_of_results": 5,
            "results": [
                {"title": f"R{i}", "url": f"https://{i}.com", "content": f"S{i}"}
                for i in range(5)
            ],
        },
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
        "--max-results", "3",
    ])

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    assert exit_code == 0
    assert len(output["results"]) == 3


def test_search_empty_results(httpx_mock, capsys):
    """SearXNG returns no results → empty results list, no error."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=nothing&safesearch=1&language=all",
        json={
            "query": "nothing",
            "number_of_results": 0,
            "results": [],
        },
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "nothing",
    ])

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    assert exit_code == 0
    assert output["results"] == []


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


def test_unreachable_instance_produces_clear_error(httpx_mock, capsys):
    """Connection refused → JSON error, exit code 1."""
    # Not adding a mock response → httpx will raise ConnectError
    # when pytest-httpx's can_send is False for unmatched requests.
    httpx_mock.add_exception(
        httpx.ConnectError("Connection refused"),
        url="http://127.0.0.1:9999/search?format=json&q=test&safesearch=1&language=all",
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:9999",
        "--query", "test",
    ])

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    assert exit_code == 1
    assert "error" in output
    assert "SearXNG request failed" in output["error"]


def test_http_error_response_produces_error(httpx_mock, capsys):
    """HTTP 500 → JSON error, exit code 1."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&language=all",
        status_code=500,
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
    ])

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    assert exit_code == 1
    assert "error" in output
    assert "SearXNG request failed" in output["error"]


def test_non_json_response_produces_error(httpx_mock, capsys):
    """Non-JSON response → JSON error, exit code 1."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&language=all",
        text="<html>Internal Server Error</html>",
        headers={"content-type": "text/html"},
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
    ])

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    assert exit_code == 1
    assert "error" in output
    assert "non-JSON" in output["error"]


def test_negative_max_results_clamped(httpx_mock, capsys):
    """Negative --max-results is clamped to 1 (no negative slicing)."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&language=all",
        json={
            "query": "test",
            "number_of_results": 2,
            "results": [
                {"title": "R1", "url": "https://1.com", "content": "S1"},
                {"title": "R2", "url": "https://2.com", "content": "S2"},
            ],
        },
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
        "--max-results", "-1",
    ])

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    assert exit_code == 0
    # Must return exactly 1 result (clamped from -1 → 1).
    # Negative slicing (results[:-1]) would return [R1] which looks right
    # for a 2-item list but is wrong for other sizes. We verify the
    # first result is R1, confirming forward slicing (results[:1]).
    assert len(output["results"]) == 1
    assert output["results"][0]["title"] == "R1"


# ---------------------------------------------------------------------------
# Parameter mapping
# ---------------------------------------------------------------------------


def test_safesearch_on_maps_to_2(httpx_mock, capsys):
    """safesearch 'on' → SearXNG safesearch=2."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=2&language=all",
        json={"query": "test", "number_of_results": 0, "results": []},
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
        "--safesearch", "on",
    ])

    assert exit_code == 0


def test_safesearch_off_maps_to_0(httpx_mock, capsys):
    """safesearch 'off' → SearXNG safesearch=0."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=0&language=all",
        json={"query": "test", "number_of_results": 0, "results": []},
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
        "--safesearch", "off",
    ])

    assert exit_code == 0


def test_timelimit_d_maps_to_day(httpx_mock, capsys):
    """timelimit 'd' → SearXNG time_range=day."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&time_range=day&language=all",
        json={"query": "test", "number_of_results": 0, "results": []},
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
        "--timelimit", "d",
    ])

    assert exit_code == 0


def test_timelimit_w_maps_to_week(httpx_mock, capsys):
    """timelimit 'w' → SearXNG time_range=week."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&time_range=week&language=all",
        json={"query": "test", "number_of_results": 0, "results": []},
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
        "--timelimit", "w",
    ])

    assert exit_code == 0


def test_timelimit_not_specified_omits_time_range(httpx_mock, capsys):
    """No --timelimit → SearXNG URL has no time_range param."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&language=all",
        json={"query": "test", "number_of_results": 0, "results": []},
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
    ])

    assert exit_code == 0


def test_language_passthrough(httpx_mock, capsys):
    """--language 'de' → SearXNG language=de."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&language=de",
        json={"query": "test", "number_of_results": 0, "results": []},
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
        "--language", "de",
    ])

    assert exit_code == 0


# ---------------------------------------------------------------------------
# Additional edge-case coverage (post-review)
# ---------------------------------------------------------------------------


def test_results_null_handled_as_empty(httpx_mock, capsys):
    """SearXNG returns 'results': null → treated as empty list."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&language=all",
        json={"query": "test", "number_of_results": 0, "results": None},
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
    ])

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    assert exit_code == 0
    assert output["results"] == []


def test_max_results_upper_bound_clamped(httpx_mock, capsys):
    """--max-results 100 → clamped to 20 in Python."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&language=all",
        json={
            "query": "test",
            "number_of_results": 25,
            "results": [
                {"title": f"R{i}", "url": f"https://{i}.com", "content": f"S{i}"}
                for i in range(25)
            ],
        },
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
        "--max-results", "100",
    ])

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    assert exit_code == 0
    assert len(output["results"]) == 20


def test_negative_max_results_with_many_results(httpx_mock, capsys):
    """Negative --max-results with 5 results definitively proves forward slicing."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&language=all",
        json={
            "query": "test",
            "number_of_results": 5,
            "results": [
                {"title": f"R{i}", "url": f"https://{i}.com", "content": f"S{i}"}
                for i in range(5)
            ],
        },
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
        "--max-results", "-1",
    ])

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    assert exit_code == 0
    # Clamped to 1: forward slicing gives [R0], negative slicing would give [R4].
    assert len(output["results"]) == 1
    assert output["results"][0]["title"] == "R0"


def test_timeout_produces_clear_error(httpx_mock, capsys):
    """httpx.TimeoutException → JSON error, exit code 1."""
    httpx_mock.add_exception(
        httpx.TimeoutException("Request timed out"),
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&language=all",
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
    ])

    captured = capsys.readouterr()
    output = json.loads(captured.out)

    assert exit_code == 1
    assert "error" in output
    assert "SearXNG request failed" in output["error"]


def test_timelimit_m_maps_to_month(httpx_mock, capsys):
    """timelimit 'm' → SearXNG time_range=month."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&time_range=month&language=all",
        json={"query": "test", "number_of_results": 0, "results": []},
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
        "--timelimit", "m",
    ])

    assert exit_code == 0


def test_timelimit_y_maps_to_year(httpx_mock, capsys):
    """timelimit 'y' → SearXNG time_range=year."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&time_range=year&language=all",
        json={"query": "test", "number_of_results": 0, "results": []},
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
        "--timelimit", "y",
    ])

    assert exit_code == 0


def test_safesearch_moderate_maps_to_1(httpx_mock, capsys):
    """safesearch 'moderate' (explicit) → SearXNG safesearch=1."""
    httpx_mock.add_response(
        url="http://127.0.0.1:5340/search?format=json&q=test&safesearch=1&language=all",
        json={"query": "test", "number_of_results": 0, "results": []},
    )

    exit_code = main([
        "--searxng-url", "http://127.0.0.1:5340",
        "--query", "test",
        "--safesearch", "moderate",
    ])

    assert exit_code == 0
