#!/usr/bin/env bash
#
# Applies the Juniper Medplum project configuration to a live Medplum project
# via the plain FHIR REST API. IDEMPOTENT: every write is either a conditional
# update (PUT Type?search — updates the match or creates on no match) or a
# conditional create (If-None-Exist / Bundle.entry.request.ifNoneExist), so
# re-running never duplicates anything.
#
# Required env:
#   MEDPLUM_BASE_URL       e.g. https://api.medplum.com
#   MEDPLUM_CLIENT_ID      a PROJECT-ADMIN client (not the voice client)
#   MEDPLUM_CLIENT_SECRET  its secret
#
# Order: CodeSystems -> Device -> Organization -> AccessPolicies ->
#        ClientApplication (create-only) -> seed bundles.
#
# What this script deliberately does NOT do (see medplum/README.md):
#   - It never overwrites an existing ClientApplication (would clobber the
#     live secret). Creating/rotating the secret is a manual step.
#   - It cannot link the voice ClientApplication's ProjectMembership to its
#     AccessPolicy, nor invite the caregiver user — both are admin operations
#     documented as manual steps in the README.
set -euo pipefail

: "${MEDPLUM_BASE_URL:?MEDPLUM_BASE_URL is required (e.g. https://api.medplum.com)}"
: "${MEDPLUM_CLIENT_ID:?MEDPLUM_CLIENT_ID is required (a project-admin client)}"
: "${MEDPLUM_CLIENT_SECRET:?MEDPLUM_CLIENT_SECRET is required}"

BASE="${MEDPLUM_BASE_URL%/}"
FHIR="$BASE/fhir/R4"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RES="$HERE/../resources"
SEED="$HERE/../seed"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v node >/dev/null 2>&1 || die "node is required"

urlenc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
# jget PATH  — reads JSON on stdin, prints the value at dot-path; exit 1 if absent
jget() {
  node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const value = process.argv[1].split(".").reduce((o, k) => (o == null ? o : o[k]), data);
    if (value === undefined || value === null) process.exit(1);
    process.stdout.write(String(value));
  ' "$1"
}

# ---------------------------------------------------------------- auth
say "Requesting access token (client_credentials) from $BASE/oauth2/token"
TOKEN_RESPONSE="$(curl -sS -X POST "$BASE/oauth2/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode "client_id=$MEDPLUM_CLIENT_ID" \
  --data-urlencode "client_secret=$MEDPLUM_CLIENT_SECRET")"
ACCESS_TOKEN="$(printf '%s' "$TOKEN_RESPONSE" | jget access_token)" \
  || die "no access_token in token response: $TOKEN_RESPONSE"
echo "    token acquired"

# api METHOD URL [FILE] — prints response body; dies loudly on non-2xx
api() {
  local method="$1" url="$2" file="${3:-}" extra_header="${4:-}"
  local body_file status
  body_file="$(mktemp)"
  local args=(-sS -o "$body_file" -w '%{http_code}' -X "$method" "$url"
    -H "Authorization: Bearer $ACCESS_TOKEN")
  if [ -n "$file" ]; then
    args+=(-H 'Content-Type: application/fhir+json' --data-binary "@$file")
  fi
  if [ -n "$extra_header" ]; then
    args+=(-H "$extra_header")
  fi
  status="$(curl "${args[@]}")" || { cat "$body_file" >&2; rm -f "$body_file"; die "curl failed: $method $url"; }
  case "$status" in
    2*) ;;
    *)
      printf -- '---- response body (%s) ----\n' "$status" >&2
      cat "$body_file" >&2
      printf '\n' >&2
      rm -f "$body_file"
      die "HTTP $status from $method $url"
      ;;
  esac
  cat "$body_file"
  rm -f "$body_file"
}

# upsert TYPE QUERY FILE LABEL — conditional update (idempotent).
# Sets LAST_UPSERT_ID as a side channel for callers that need the assigned id
# (Device/Organization ids are project-specific and MUST flow into env config
# — see the reference-id reminder below).
upsert() {
  local type="$1" query="$2" file="$3" label="$4"
  say "Upsert $label   (PUT $type?$query)"
  local resp
  resp="$(api PUT "$FHIR/$type?$query" "$file")"
  LAST_UPSERT_ID="$(printf '%s' "$resp" | jget id)" || die "no id in response for $label"
  echo "    -> $type/$LAST_UPSERT_ID"
}

# ------------------------------------------------------------ CodeSystems
for f in "$RES"/codesystem-*.json; do
  url="$(jget url < "$f")" || die "no url in $f"
  upsert CodeSystem "url=$(urlenc "$url")" "$f" "$(basename "$f")"
done

# ---------------------------------------------------- Device / Organization
#
# Medplum assigns its own UUID on create — it does NOT use the identifier
# slug ("juniper-voice-agent") as the resource id. The service's
# JUNIPER_DEVICE_REFERENCE / JUNIPER_ORGANIZATION_REFERENCE env vars must be
# the real Device/<uuid> and Organization/<uuid> from THIS project, captured
# below and printed again at the end — every fresh project gets different
# ids, so a stale or default value silently breaks every DocumentReference
# write (author/custodian would point at a resource that doesn't exist here).
for pair in "Device:device-voice-agent.json" "Organization:organization-clinic.json"; do
  type="${pair%%:*}"
  f="$RES/${pair#*:}"
  sys="$(jget identifier.0.system < "$f")" || die "no identifier.system in $f"
  val="$(jget identifier.0.value < "$f")" || die "no identifier.value in $f"
  upsert "$type" "identifier=$(urlenc "$sys|$val")" "$f" "$(basename "$f")"
  if [ "$type" = "Device" ]; then DEVICE_ID="$LAST_UPSERT_ID"; else ORGANIZATION_ID="$LAST_UPSERT_ID"; fi
done

# ------------------------------------------------------------ AccessPolicies
for f in "$RES"/access-policy-*.json; do
  name="$(jget name < "$f")" || die "no name in $f"
  upsert AccessPolicy "name=$(urlenc "$name")" "$f" "$(basename "$f")"
done

# ------------------------------------------- ClientApplication (create-only)
CLIENT_FILE="$RES/client-application-voice.json"
CLIENT_NAME="$(jget name < "$CLIENT_FILE")" || die "no name in $CLIENT_FILE"
say "ClientApplication '$CLIENT_NAME' (create-only; an existing one is never overwritten, preserving its secret)"
existing_id="$(api GET "$FHIR/ClientApplication?name=$(urlenc "$CLIENT_NAME")&_count=1" | jget entry.0.resource.id || true)"
if [ -n "$existing_id" ]; then
  VOICE_CLIENT_ID="$existing_id"
  echo "    already exists -> ClientApplication/$VOICE_CLIENT_ID (skipped)"
else
  resp="$(api POST "$FHIR/ClientApplication" "$CLIENT_FILE" "If-None-Exist: name=$(urlenc "$CLIENT_NAME")")"
  VOICE_CLIENT_ID="$(printf '%s' "$resp" | jget id)" || die "no id creating ClientApplication"
  echo "    created -> ClientApplication/$VOICE_CLIENT_ID"
fi
echo "    MANUAL: retrieve/rotate its secret and attach the 'Juniper Voice Service Policy'"
echo "    to its ProjectMembership in the Medplum app — see medplum/README.md."

# ---------------------------------------------------------------- Seed data
for f in "$SEED"/seed-bundle*.json; do
  say "Applying seed bundle $(basename "$f") (transaction, conditional creates)"
  api POST "$FHIR" "$f" | node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const counts = {};
    for (const e of data.entry ?? []) {
      const s = (e.response && e.response.status || "?").split(" ")[0];
      counts[s] = (counts[s] || 0) + 1;
    }
    const summary = Object.entries(counts).map(([k, v]) => v + "x HTTP " + k).join(", ");
    console.log("    -> " + (summary || "empty response"));
    console.log("       (201 = created, 200 = already existed and was matched by ifNoneExist)");
  '
done

say "Done. Set these in services/voice/.env — they are specific to THIS project:"
cat <<EOF
    MEDPLUM_BASE_URL=$BASE
    JUNIPER_DEVICE_REFERENCE=Device/$DEVICE_ID
    JUNIPER_ORGANIZATION_REFERENCE=Organization/$ORGANIZATION_ID
EOF

say "Remaining MANUAL steps (see medplum/README.md):"
cat <<EOF
    1. Voice service: in the Medplum app, open Project -> Clients ->
       "Juniper Voice Service" (ClientApplication/$VOICE_CLIENT_ID), note/rotate
       the client secret (-> MEDPLUM_CLIENT_ID/MEDPLUM_CLIENT_SECRET), and set
       the access policy on its ProjectMembership to "Juniper Voice Service
       Policy". Until this is done it has the same broad access as the
       bootstrap client used to run this script.
    2. Caregiver: invite the caregiver user (admin invite endpoint) with
       membership.access binding "Juniper Caregiver Policy" and the
       parameter name "patient" pointing at the seeded Patient, then point the
       membership profile at the seeded RelatedPerson.
    3. Never hand a caregiver an access binding by hand in production —
       derive it from CareTeam membership (see README, "How caregiver access
       is derived from CareTeam").
    4. Apps (apps/onboarding, apps/family): create a separate PUBLIC/PKCE
       ClientApplication (redirectUri set, no client secret used by the app)
       for EXPO_PUBLIC_MEDPLUM_CLIENT_ID -- this script does not create one,
       since it is a browser/native-flow client, not a server credential.
EOF
