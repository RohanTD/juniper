"""CORS for the app-level store routes.

The family app is a **web** dashboard. Its calls to this service are therefore
cross-origin — Expo web on :8081 talking to :8000 — and a browser drops them
before they ever arrive unless the response carries the right headers. The
failure mode is nasty precisely because it is invisible from the server side:
the service is healthy, the logs are empty, and the user sees "call settings
won't load" forever.
"""

from __future__ import annotations

import dataclasses

import pytest
from fastapi.testclient import TestClient

from juniper_voice.app import create_app
from juniper_voice.config import Settings, _origins

DEV_ORIGIN = "http://localhost:8081"
TOKEN = "test-token"


@pytest.fixture
def app_factory(tmp_path, provider):
    def make(**overrides):
        settings = Settings(
            api_token=TOKEN,
            preferences_path=str(tmp_path / "prefs.json"),
            context_brain_path=str(tmp_path / "brain.json"),
            alert_acknowledgements_path=str(tmp_path / "acks.json"),
        )
        settings = dataclasses.replace(settings, **overrides)
        return create_app(settings=settings, provider=provider, medplum=None)

    return make


def test_a_preflight_from_the_family_app_is_allowed(app_factory):
    client = TestClient(app_factory())
    response = client.options(
        "/patients/pat-1/preferences",
        headers={
            "Origin": DEV_ORIGIN,
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == DEV_ORIGIN
    assert "PUT" in response.headers["access-control-allow-methods"]
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


def test_a_real_request_carries_the_origin_header_back(app_factory):
    client = TestClient(app_factory())
    response = client.get(
        "/patients/pat-1/preferences",
        headers={"Origin": DEV_ORIGIN, "Authorization": "Bearer test-token"},
    )
    assert response.headers.get("access-control-allow-origin") == DEV_ORIGIN


def test_an_unlisted_origin_gets_nothing(app_factory):
    """The allow-list is the point. A wildcard would let any page a caregiver
    happens to visit drive this API with a token it managed to obtain."""
    client = TestClient(app_factory())
    response = client.options(
        "/patients/pat-1/preferences",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "PUT",
        },
    )
    assert "access-control-allow-origin" not in response.headers


def test_credentials_are_not_allowed(app_factory):
    """Entitlement rides on a bearer token, not a cookie, so credentialed
    cross-origin requests are neither needed nor permitted."""
    client = TestClient(app_factory())
    response = client.options(
        "/patients/pat-1/preferences",
        headers={"Origin": DEV_ORIGIN, "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-credentials" not in response.headers


# ---------------------------------------------------------------------------
# Origin parsing
# ---------------------------------------------------------------------------


def test_unset_keeps_the_dev_defaults():
    default = Settings().cors_origins
    assert _origins(None, default) == default
    assert DEV_ORIGIN in default


def test_a_comma_separated_list_is_split_and_trimmed():
    assert _origins("https://a.example, https://b.example ", ()) == (
        "https://a.example",
        "https://b.example",
    )


def test_an_explicitly_empty_value_disables_cors_rather_than_falling_back():
    """A deployment that means "no browsers at all" must be able to say so;
    silently restoring localhost defaults would be the opposite of the intent.
    """
    assert _origins("", ("http://localhost:8081",)) == ()


def test_no_cors_middleware_when_the_list_is_empty(app_factory):
    client = TestClient(app_factory(cors_origins=()))
    response = client.get(
        "/patients/pat-1/preferences",
        headers={"Origin": DEV_ORIGIN, "Authorization": "Bearer test-token"},
    )
    assert "access-control-allow-origin" not in response.headers
