"""Service settings from the environment (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Mapping

from dotenv import load_dotenv

from .llm.provider import ModelRoster


@dataclass(frozen=True)
class Settings:
    # Auth for our own HTTP surface (Deepgram think endpoint + preferences API)
    api_token: str | None = None
    # Upstream credentials
    anthropic_api_key: str | None = None
    deepgram_api_key: str | None = None
    twilio_auth_token: str | None = None
    # Public host (scheme-less), used to build TwiML/Deepgram callback URLs
    public_host: str = "localhost:8000"
    # Medplum
    medplum_base_url: str | None = None
    medplum_client_id: str | None = None
    medplum_client_secret: str | None = None
    # Stores
    preferences_path: str = "data/preferences.json"
    context_brain_path: str = "data/context_brain.json"
    # FHIR attribution
    device_ref: str = "Device/juniper-voice-agent"
    organization_ref: str | None = "Organization/juniper-pilot-clinic"
    # Budgets
    ehr_brief_token_budget: int = 2500
    # Models
    roster: ModelRoster = field(default_factory=ModelRoster)
    # Deepgram voice/listen models
    deepgram_listen_model: str = "nova-3"
    deepgram_speak_model: str = "aura-2-thalia-en"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        if env is None:
            load_dotenv()
            env = os.environ
        default = cls()
        return cls(
            api_token=env.get("JUNIPER_API_TOKEN"),
            anthropic_api_key=env.get("ANTHROPIC_API_KEY"),
            deepgram_api_key=env.get("DEEPGRAM_API_KEY"),
            twilio_auth_token=env.get("TWILIO_AUTH_TOKEN"),
            public_host=env.get("JUNIPER_PUBLIC_HOST", default.public_host),
            medplum_base_url=env.get("MEDPLUM_BASE_URL"),
            medplum_client_id=env.get("MEDPLUM_CLIENT_ID"),
            medplum_client_secret=env.get("MEDPLUM_CLIENT_SECRET"),
            preferences_path=env.get("JUNIPER_PREFERENCES_PATH", default.preferences_path),
            context_brain_path=env.get("JUNIPER_CONTEXT_BRAIN_PATH", default.context_brain_path),
            device_ref=env.get("JUNIPER_DEVICE_REFERENCE", default.device_ref),
            organization_ref=env.get("JUNIPER_ORGANIZATION_REFERENCE", default.organization_ref),
            ehr_brief_token_budget=int(
                env.get("JUNIPER_EHR_BRIEF_TOKEN_BUDGET", default.ehr_brief_token_budget)
            ),
            roster=ModelRoster.from_env(env),
            deepgram_listen_model=env.get(
                "JUNIPER_DEEPGRAM_LISTEN_MODEL", default.deepgram_listen_model
            ),
            deepgram_speak_model=env.get(
                "JUNIPER_DEEPGRAM_SPEAK_MODEL", default.deepgram_speak_model
            ),
        )
