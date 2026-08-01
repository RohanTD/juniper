"""Preference round-trip: app -> store -> voice -> store -> app.

The onboarding app is meant to be opened exactly once.  That premise is only
true if every preference it captures can also be changed by voice — "call me in
the mornings instead" has to work.  This test drives the whole loop: the API
the app writes through, the Companion tool that updates the same store, and the
API read that the app would perform afterwards.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from juniper_voice.agents.companion import Companion
from juniper_voice.app import create_app
from juniper_voice.config import Settings
from juniper_voice.llm.provider import FakeProvider, LLMResponse, ModelRoster, ToolCall
from juniper_voice.preferences import PreferencesStore

TOKEN = "test-token"
MORNING = {
    "days": ["mon", "tue", "wed", "thu", "fri"],
    "start": "09:00",
    "end": "11:00",
    "timezone": "America/New_York",
}
AFTERNOON = {
    "days": ["mon", "wed", "fri"],
    "start": "14:00",
    "end": "16:00",
    "timezone": "America/New_York",
}


@pytest.fixture
def client(tmp_path, provider):
    settings = Settings(
        api_token=TOKEN,
        preferences_path=str(tmp_path / "prefs.json"),
        context_brain_path=str(tmp_path / "brain.json"),
    )
    store = PreferencesStore(tmp_path / "prefs.json")
    app = create_app(settings=settings, provider=provider, medplum=None, preferences=store)
    with TestClient(app) as test_client:
        test_client.headers["Authorization"] = f"Bearer {TOKEN}"
        yield test_client, store


def test_preferences_api_requires_auth(client):
    test_client, _ = client
    response = test_client.get("/patients/pat-1/preferences", headers={"Authorization": ""})
    assert response.status_code == 401


def test_app_writes_then_reads_its_own_preferences(client):
    test_client, _ = client
    payload = {
        "callWindows": [MORNING],
        "topicsToAvoid": ["her late husband Robert"],
        "completedBy": {"role": "proxy", "name": "Carmen Reyes", "relationship": "daughter"},
    }
    put = test_client.put("/patients/pat-1/preferences", json=payload)
    assert put.status_code == 200

    got = test_client.get("/patients/pat-1/preferences").json()
    assert got["callWindows"] == [MORNING]
    assert got["topicsToAvoid"] == ["her late husband Robert"]
    # Proxy provenance survives — a consent captured by proxy is a materially
    # different claim from one captured first-party.
    assert got["completedBy"]["role"] == "proxy"
    assert got["completedBy"]["name"] == "Carmen Reyes"


async def test_voice_changes_a_call_window_and_the_app_sees_it(client):
    """The round trip that makes the app genuinely one-time."""
    test_client, store = client
    test_client.put("/patients/pat-1/preferences", json={"callWindows": [MORNING]})

    # The patient says "call me in the afternoons instead"; the Companion calls
    # its preference tool, which writes the same store the app reads.
    provider = FakeProvider()
    provider.script(
        "companion",
        [
            LLMResponse(
                text="",
                tool_calls=(
                    ToolCall(
                        name="update_call_windows",
                        input={"callWindows": [AFTERNOON]},
                        id="toolu_1",
                    ),
                ),
            ),
            "Of course — I'll ring you in the afternoons from now on.",
        ],
    )
    companion = Companion(
        provider, ModelRoster().companion, preferences=store, patient_id="pat-1"
    )
    reply = await companion.compose(
        transcript_window_text="patient: Could you call me in the afternoons instead?",
        digest="",
        brief_text="",
        advisory=None,
    )

    assert "afternoon" in reply.lower()

    # The store changed...
    assert [w.model_dump() for w in store.get("pat-1").callWindows] == [AFTERNOON]
    # ...and the app's next read reflects it.
    got = test_client.get("/patients/pat-1/preferences").json()
    assert got["callWindows"] == [AFTERNOON]


async def test_voice_can_add_a_topic_to_avoid(client):
    test_client, store = client
    provider = FakeProvider()
    provider.script(
        "companion",
        [
            LLMResponse(
                text="",
                tool_calls=(
                    ToolCall(
                        name="add_topic_to_avoid",
                        input={"topic": "her late husband Robert"},
                        id="toolu_1",
                    ),
                ),
            ),
            "I understand — I won't bring that up again.",
        ],
    )
    companion = Companion(
        provider, ModelRoster().companion, preferences=store, patient_id="pat-1"
    )
    await companion.compose(
        transcript_window_text="patient: Please don't ask me about Robert.",
        digest="",
        brief_text="",
        advisory=None,
    )

    assert "her late husband Robert" in store.get("pat-1").topicsToAvoid
    got = test_client.get("/patients/pat-1/preferences").json()
    assert "her late husband Robert" in got["topicsToAvoid"]


def test_preference_tools_are_offered_to_the_companion(tmp_path, provider):
    """If the tools are not in the request, the premise fails silently."""
    store = PreferencesStore(tmp_path / "prefs.json")
    provider.script("companion", "Lovely to hear from you.")
    companion = Companion(provider, ModelRoster().companion, preferences=store, patient_id="p")

    import asyncio

    asyncio.run(
        companion.compose(
            transcript_window_text="patient: hello", digest="", brief_text="", advisory=None
        )
    )
    tool_names = {tool["name"] for tool in provider.requests_for("companion")[0].tools}
    assert {"update_call_windows", "add_topic_to_avoid"} <= tool_names


# ---------------------------------------------------------------------------
# Per-patient authorization (the family app calls this with a caregiver token)
# ---------------------------------------------------------------------------

async def test_caregiver_token_is_scoped_to_their_patient(tmp_path, provider, monkeypatch):
    """The route is keyed only on a path parameter, so without per-patient
    authorization the shared service token would be a master key the moment a
    caregiver-facing app holds it. A Medplum user token must therefore be
    scoped by asking Medplum whether that user can read THIS patient."""
    import httpx as _httpx

    from juniper_voice.app import create_app
    from juniper_voice.config import Settings

    ALLOWED, DENIED = "pat-allowed", "pat-denied"

    class _FakeResponse:
        def __init__(self, status_code: int):
            self.status_code = status_code

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, headers=None):
            # Medplum answers the entitlement question: the caregiver policy
            # scopes them to exactly their bound patient.
            return _FakeResponse(200 if url.endswith(ALLOWED) else 403)

    monkeypatch.setattr(_httpx, "AsyncClient", _FakeClient)

    settings = Settings(
        api_token="service-token",
        medplum_base_url="https://medplum.example",
        preferences_path=str(tmp_path / "p.json"),
        context_brain_path=str(tmp_path / "b.json"),
    )
    app = create_app(settings=settings, provider=provider, medplum=None)
    with TestClient(app) as client:
        caregiver = {"Authorization": "Bearer caregiver-medplum-token"}
        assert client.get(f"/patients/{ALLOWED}/preferences", headers=caregiver).status_code == 200
        # ...and cannot reach another patient by editing the URL.
        assert client.get(f"/patients/{DENIED}/preferences", headers=caregiver).status_code == 403
        assert (
            client.put(
                f"/patients/{DENIED}/preferences", json={"callWindows": []}, headers=caregiver
            ).status_code
            == 403
        )
        # The service token stays trusted for any patient (onboarding path).
        svc = {"Authorization": "Bearer service-token"}
        assert client.get(f"/patients/{DENIED}/preferences", headers=svc).status_code == 200
        # No token at all is rejected outright.
        assert client.get(f"/patients/{ALLOWED}/preferences").status_code == 401
