"""Service settings from the environment (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Mapping

from dotenv import load_dotenv

from .llm.provider import ModelRoster


def _flag(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    # Auth for our own HTTP surface (Deepgram think endpoint + preferences API)
    api_token: str | None = None
    # Upstream credentials
    anthropic_api_key: str | None = None
    groq_api_key: str | None = None
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
    # Family-side alert acknowledgements. NOT the escalation Task's status —
    # that belongs to the care team; see acknowledgements.py.
    alert_acknowledgements_path: str = "data/alert_acknowledgements.json"
    # FHIR attribution. Medplum assigns its own UUID on create — these must be
    # the actual Device/Organization ids from the target project (printed by
    # medplum/scripts/apply.sh), never the identifier slug. An unset value
    # defaults to an obviously-fake placeholder rather than a plausible-looking
    # one, so a misconfigured deployment fails loudly instead of silently
    # writing DocumentReference.author/.custodian at a resource that doesn't
    # exist in this project.
    device_ref: str = "Device/UNSET-run-medplum-scripts-apply.sh"
    organization_ref: str | None = "Organization/UNSET-run-medplum-scripts-apply.sh"
    # Budgets
    ehr_brief_token_budget: int = 2500
    # Turn-loop composition. Defaults preserve docs/PLAN.md's contracted
    # three-call turn; setting either to false collapses toward a single LLM
    # call per turn. See ControllerSettings for the measured tradeoff.
    urgency_filter_enabled: bool = True
    compassion_filter_enabled: bool = True
    # Context mode (docs/MOSS_PLAN.md):
    #   "brief"  = compiled EHR brief + digest (the tested fallback, default)
    #   "shadow" = retrieval runs, is measured and logged, and reaches NO
    #              prompt; prompts stay byte-identical to brief mode. This is
    #              what Phase A ("logging only") requires.
    #   "moss"   = retrieval injected, pinned core header replaces the bulk brief.
    context_mode: str = "brief"
    moss_project_id: str | None = None
    moss_project_key: str | None = None
    moss_model: str = "moss-mediumlm"
    moss_index_prefix: str = "juniper"
    moss_query_timeout: float = 0.15
    moss_hydrate_timeout: float = 2.0
    moss_top_k_chart: int = 4
    moss_top_k_memories: int = 3
    moss_top_k_session: int = 3
    moss_alpha: float = 0.7
    moss_full_rebuild_every: int = 20
    retrieval_state_path: str = "data/retrieval_state.json"
    # Models
    roster: ModelRoster = field(default_factory=ModelRoster)
    # Deepgram voice/listen models
    deepgram_listen_model: str = "nova-3"
    deepgram_speak_model: str = "aura-2-asteria-en"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        if env is None:
            load_dotenv()
            env = os.environ
        default = cls()
        return cls(
            api_token=env.get("JUNIPER_API_TOKEN"),
            anthropic_api_key=env.get("ANTHROPIC_API_KEY"),
            groq_api_key=env.get("GROQ_API_KEY"),
            deepgram_api_key=env.get("DEEPGRAM_API_KEY"),
            twilio_auth_token=env.get("TWILIO_AUTH_TOKEN"),
            public_host=env.get("JUNIPER_PUBLIC_HOST", default.public_host),
            medplum_base_url=env.get("MEDPLUM_BASE_URL"),
            medplum_client_id=env.get("MEDPLUM_CLIENT_ID"),
            medplum_client_secret=env.get("MEDPLUM_CLIENT_SECRET"),
            preferences_path=env.get("JUNIPER_PREFERENCES_PATH", default.preferences_path),
            context_brain_path=env.get("JUNIPER_CONTEXT_BRAIN_PATH", default.context_brain_path),
            alert_acknowledgements_path=env.get(
                "JUNIPER_ALERT_ACKNOWLEDGEMENTS_PATH", default.alert_acknowledgements_path
            ),
            device_ref=env.get("JUNIPER_DEVICE_REFERENCE", default.device_ref),
            organization_ref=env.get("JUNIPER_ORGANIZATION_REFERENCE", default.organization_ref),
            ehr_brief_token_budget=int(
                env.get("JUNIPER_EHR_BRIEF_TOKEN_BUDGET", default.ehr_brief_token_budget)
            ),
            urgency_filter_enabled=_flag(
                env, "JUNIPER_URGENCY_FILTER", default.urgency_filter_enabled
            ),
            compassion_filter_enabled=_flag(
                env, "JUNIPER_COMPASSION_FILTER", default.compassion_filter_enabled
            ),
            context_mode=env.get("JUNIPER_CONTEXT_MODE", default.context_mode),
            moss_project_id=env.get("MOSS_PROJECT_ID"),
            moss_project_key=env.get("MOSS_PROJECT_KEY"),
            moss_model=env.get("JUNIPER_MOSS_MODEL", default.moss_model),
            moss_index_prefix=env.get("JUNIPER_MOSS_INDEX_PREFIX", default.moss_index_prefix),
            moss_query_timeout=float(
                env.get("JUNIPER_MOSS_QUERY_TIMEOUT", default.moss_query_timeout)
            ),
            moss_hydrate_timeout=float(
                env.get("JUNIPER_MOSS_HYDRATE_TIMEOUT", default.moss_hydrate_timeout)
            ),
            moss_full_rebuild_every=int(
                env.get("JUNIPER_MOSS_FULL_REBUILD_EVERY", default.moss_full_rebuild_every)
            ),
            # Phase A gates are literally "alpha tuning" and "top_k" — they
            # must be runnable without a code edit and redeploy.
            moss_alpha=float(env.get("JUNIPER_MOSS_ALPHA", default.moss_alpha)),
            moss_top_k_chart=int(env.get("JUNIPER_MOSS_TOP_K_CHART", default.moss_top_k_chart)),
            moss_top_k_memories=int(
                env.get("JUNIPER_MOSS_TOP_K_MEMORIES", default.moss_top_k_memories)
            ),
            moss_top_k_session=int(
                env.get("JUNIPER_MOSS_TOP_K_SESSION", default.moss_top_k_session)
            ),
            retrieval_state_path=env.get(
                "JUNIPER_RETRIEVAL_STATE_PATH", default.retrieval_state_path
            ),
            roster=ModelRoster.from_env(env),
            deepgram_listen_model=env.get(
                "JUNIPER_DEEPGRAM_LISTEN_MODEL", default.deepgram_listen_model
            ),
            deepgram_speak_model=env.get(
                "JUNIPER_DEEPGRAM_SPEAK_MODEL", default.deepgram_speak_model
            ),
        )
