"""Family-side alert acknowledgements: the store, the routes, and the boundary
that makes them necessary.

The whole point of this endpoint is what it does NOT do. A caregiver reading
"urgent" at 11pm needs to be able to say "seen, I'm not going to be ambushed by
this again" — but the escalation Task is addressed to the CARE TEAM, and
writing ``Task.status = completed`` from the family app would tell every later
reader that a clinician acted. So the acknowledgement is family-side state in
the app-level store, sharing the preferences API's per-patient authorization.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from juniper_voice.acknowledgements import AlertAcknowledgements, AlertAcknowledgementStore
from juniper_voice.app import create_app
from juniper_voice.config import Settings

TOKEN = "test-token"
ACK = {
    "taskId": "task-1",
    "acknowledgedAt": "2026-08-01T23:10:00+00:00",
    "acknowledgedBy": "RelatedPerson/carmen",
}


@pytest.fixture
def client(tmp_path, provider):
    settings = Settings(
        api_token=TOKEN,
        preferences_path=str(tmp_path / "prefs.json"),
        context_brain_path=str(tmp_path / "brain.json"),
        alert_acknowledgements_path=str(tmp_path / "acks.json"),
    )
    store = AlertAcknowledgementStore(tmp_path / "acks.json")
    app = create_app(
        settings=settings, provider=provider, medplum=None, acknowledgements=store
    )
    with TestClient(app) as test_client:
        test_client.headers["Authorization"] = f"Bearer {TOKEN}"
        yield test_client, store


def test_requires_a_bearer_token(client):
    test_client, _ = client
    response = test_client.get(
        "/patients/pat-1/alert-acknowledgements", headers={"Authorization": ""}
    )
    assert response.status_code == 401


def test_unacknowledged_patient_reads_as_an_empty_set_not_a_404(client):
    """A caregiver who has never acknowledged anything is the normal case; it
    must not surface as an error the app has to special-case."""
    test_client, _ = client
    response = test_client.get("/patients/pat-1/alert-acknowledgements")
    assert response.status_code == 200
    assert response.json() == {"acknowledgements": []}


def test_round_trip(client):
    test_client, store = client
    put = test_client.put(
        "/patients/pat-1/alert-acknowledgements", json={"acknowledgements": [ACK]}
    )
    assert put.status_code == 200

    got = test_client.get("/patients/pat-1/alert-acknowledgements").json()
    assert got["acknowledgements"] == [ACK]
    # ...and it is durable in the store, not just in the response.
    assert store.get("pat-1").acknowledgements[0].taskId == "task-1"


def test_acknowledgements_are_scoped_per_patient(client):
    test_client, _ = client
    test_client.put(
        "/patients/pat-1/alert-acknowledgements", json={"acknowledgements": [ACK]}
    )
    other = test_client.get("/patients/pat-2/alert-acknowledgements").json()
    assert other == {"acknowledgements": []}


def test_put_replaces_so_a_misclick_can_be_undone(client):
    """Merge-only storage cannot express removal, and an 11pm misclick that
    permanently hides an urgent alert is exactly the failure this feature
    exists to prevent."""
    test_client, _ = client
    test_client.put(
        "/patients/pat-1/alert-acknowledgements", json={"acknowledgements": [ACK]}
    )
    test_client.put("/patients/pat-1/alert-acknowledgements", json={"acknowledgements": []})
    assert test_client.get("/patients/pat-1/alert-acknowledgements").json() == {
        "acknowledgements": []
    }


def test_duplicate_task_ids_collapse_last_write_winning(client):
    """Two tabs open on one alert is ordinary; storing it twice would make
    "is this acknowledged?" ambiguous for every later reader."""
    test_client, _ = client
    later = {**ACK, "acknowledgedAt": "2026-08-02T09:00:00+00:00"}
    response = test_client.put(
        "/patients/pat-1/alert-acknowledgements", json={"acknowledgements": [ACK, later]}
    )
    assert response.json()["acknowledgements"] == [later]


def test_an_empty_task_id_is_rejected(client):
    """taskId is the only join back to the alert; a blank one is an
    acknowledgement of nothing that would silently never match."""
    test_client, _ = client
    response = test_client.put(
        "/patients/pat-1/alert-acknowledgements",
        json={"acknowledgements": [{**ACK, "taskId": "  "}]},
    )
    assert response.status_code == 422


def test_acknowledging_never_touches_fhir(client):
    """The app is built with ``medplum=None`` and the route still succeeds —
    proof by construction that acknowledgement is app-level state and cannot be
    writing Task.status behind the caregiver's back."""
    test_client, _ = client
    assert (
        test_client.put(
            "/patients/pat-1/alert-acknowledgements", json={"acknowledgements": [ACK]}
        ).status_code
        == 200
    )


def test_store_survives_a_restart(tmp_path):
    """The file is the durable record; a second store over the same path must
    read what the first wrote."""
    path = tmp_path / "acks.json"
    AlertAcknowledgementStore(path).put(
        "pat-1", AlertAcknowledgements.model_validate({"acknowledgements": [ACK]})
    )
    assert AlertAcknowledgementStore(path).get("pat-1").acknowledgements[0].taskId == "task-1"
    assert json.loads(path.read_text())["pat-1"]["acknowledgements"][0]["taskId"] == "task-1"


async def test_a_caregiver_token_is_scoped_to_their_own_patient(tmp_path, provider, monkeypatch):
    """Same authorization as the preferences routes, by construction: the route
    is keyed only on a path parameter, so without a per-patient check any
    caregiver could acknowledge — or un-acknowledge — another family's alerts
    by editing the URL."""
    import httpx as _httpx

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
            return _FakeResponse(200 if url.endswith(ALLOWED) else 403)

    monkeypatch.setattr(_httpx, "AsyncClient", _FakeClient)

    settings = Settings(
        api_token="service-token",
        medplum_base_url="https://medplum.example",
        preferences_path=str(tmp_path / "p.json"),
        context_brain_path=str(tmp_path / "b.json"),
        alert_acknowledgements_path=str(tmp_path / "a.json"),
    )
    app = create_app(settings=settings, provider=provider, medplum=None)
    with TestClient(app) as test_client:
        caregiver = {"Authorization": "Bearer caregiver-medplum-token"}
        assert (
            test_client.get(
                f"/patients/{ALLOWED}/alert-acknowledgements", headers=caregiver
            ).status_code
            == 200
        )
        assert (
            test_client.get(
                f"/patients/{DENIED}/alert-acknowledgements", headers=caregiver
            ).status_code
            == 403
        )
        assert (
            test_client.put(
                f"/patients/{DENIED}/alert-acknowledgements",
                json={"acknowledgements": [ACK]},
                headers=caregiver,
            ).status_code
            == 403
        )
