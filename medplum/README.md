# medplum/ — Juniper project configuration

Everything Medplum-side that the voice service and the two apps assume exists:
CodeSystems, the voice-agent Device, the pilot-clinic Organization, the two
AccessPolicies, the voice ClientApplication template, and two seed patients.
All of it is plain FHIR R4 JSON applied over the REST API — no live network
calls happen in this directory except through `scripts/apply.sh` and the
optional `scripts/validate.mjs`.

`packages/terminology/terminology.json` is the single source of truth for
every Juniper code. The CodeSystems are **generated** from it
(`scripts/generate-codesystems.mjs`), and `scripts/check.mjs` fails if any
committed artifact drifts from it — including the code strings embedded in the
caregiver policy's criteria.

## Layout

| Path | What it is |
|---|---|
| `resources/codesystem-*.json` | One CodeSystem per terminology entry (note-category, fourm-domain, task-category, consent-provision, encounter-reason). Generated — do not edit by hand. |
| `resources/device-voice-agent.json` | The Device that authors every AI-generated document (`DocumentReference.author`). Never a Practitioner. |
| `resources/organization-clinic.json` | The pilot clinic (`DocumentReference.custodian`). |
| `resources/access-policy-voice-service.json` | Voice service policy: broad read, writes only Encounter / Binary / DocumentReference / Task. |
| `resources/access-policy-caregiver.json` | Parameterized read-only caregiver policy, bound per-patient at membership time. |
| `resources/client-application-voice.json` | ClientApplication template for the voice service. No secret committed. |
| `seed/seed-bundle.json` | Margaret "Peggy" Alvarez — fully populated test patient (30-entry transaction). |
| `seed/seed-bundle-second-patient.json` | Harold "Hal" Nakamura — thin second patient whose Consent withholds family-sharing. Exists to prove caregiver isolation and consent gating. |
| `scripts/generate-codesystems.mjs` | terminology.json → codesystem files. Deterministic, idempotent. |
| `scripts/apply.sh` | Applies everything to a live project. Idempotent (conditional updates/creates). |
| `scripts/check.mjs` | Static integrity checks, no network. Run in CI. |
| `scripts/validate.mjs` | Optional: POSTs each resource to Medplum `$validate` (networked, manual). |

```sh
node medplum/scripts/generate-codesystems.mjs   # regenerate after terminology changes
node medplum/scripts/check.mjs                  # verify everything (CI-safe, offline)
bash medplum/scripts/apply.sh                   # apply to a live project (env below)
node medplum/scripts/validate.mjs               # optional live $validate pass
```

## The access model

Two non-human principals touch Medplum, and neither gets its access by
convention — both are constrained by AccessPolicy, so the Verification items
"write-scope test" and "caregiver access-scope test" in `docs/PLAN.md` are
provable against the server, not against our own code's good behavior.

### Voice service — broad read, narrow write

`access-policy-voice-service.json` implements PLAN.md's read/write contract
directly in Medplum's model:

- **Reads** — every resource type in the PLAN.md read table (`Patient`,
  `Consent`, `CareTeam`, `Condition`, `MedicationRequest`,
  `MedicationStatement`, `AllergyIntolerance`, `Observation`, `Appointment`,
  `CarePlan`, `Goal`) is listed with `"readonly": true`, plus
  `RelatedPerson`, `Practitioner`, `Device` and `Organization`, which the
  service needs to resolve CareTeam participants, escalation targets, and its
  own author/custodian references.
- **Writes** — exactly `Encounter`, `Binary`, `DocumentReference`, `Task`
  appear without `readonly`, which in Medplum grants full read/write.
- **Everything else** — Medplum policies are default-deny: any resource type
  not listed is invisible and unwritable.

The asymmetry is therefore enforced by the policy itself: a
`MedicationStatement` write with the voice credentials fails with 403 because
its entry is `readonly: true`, even though the same type is readable for the
EHR brief. That is the write-scope test.

The policy is deliberately **not** parameterized: the voice service is a
backend that calls every enrolled patient, so it reads project-wide within the
allowed types.

### Caregiver — parameterized, CareTeam-derived, read-only

`access-policy-caregiver.json` uses Medplum's **parameterized AccessPolicy**
mechanism (their documented "Caregiver Access" pattern):

- Criteria reference the variable `%patient` (and `%profile`, the built-in
  reference to the logged-in user's profile resource).
- The variable is **bound at ProjectMembership time**, not in the policy:
  the caregiver's `ProjectMembership` (whose `profile` is their
  `RelatedPerson`) carries an `access` array in which each element names the
  policy and supplies the parameter:

  ```json
  {
    "resourceType": "ProjectMembership",
    "profile": { "reference": "RelatedPerson/<carmen>" },
    "access": [
      {
        "policy": { "reference": "AccessPolicy/<juniper-caregiver-policy>" },
        "parameter": [
          { "name": "patient", "valueReference": { "reference": "Patient/<peggy>" } }
        ]
      }
    ]
  }
  ```

  A caregiver with two patients gets two `access` elements, same policy,
  different `patient` parameter. With **no** `access` binding the policy's
  criteria have no `%patient` to substitute and the caregiver can read
  nothing — the policy grants nothing on its own.

What the bound policy admits, all `readonly: true`:

| Entry | Criteria | Why |
|---|---|---|
| `Patient` | `Patient?_id=%patient.id` | Demographics of the linked patient only. |
| `RelatedPerson` | `RelatedPerson?_id=%profile.id` | The caregiver's own profile resource, nothing else. |
| `Encounter` | `Encounter?subject=%patient&reason-code=<encounter-reason CS>\|juniper-4m-checkin` | Check-in timeline only. The seeded hospitalization Encounter has a SNOMED reason and is **not** visible. |
| `Task` | `Task?patient=%patient&code=<task-category CS>\|juniper-escalation` | Escalation alerts. |
| `DocumentReference` | `DocumentReference?subject=%patient&category=<note-category CS>\|juniper-family-summary` | Family summaries only. |

Medplum enforces criteria on **every interaction** — direct read by ID,
search, history — not just search, and rewrites caregiver searches to include
the criteria. So `juniper-note` and `juniper-transcript` documents are
**structurally unreadable**: the only `DocumentReference` entry in the policy
carries a category criterion that those categories can never match, and there
is no other entry to fall through to. This is an allow-list over a
default-deny model, not a hidden-by-the-app convention. `check.mjs` asserts
the two forbidden category codes appear nowhere in the policy and that every
criteria string carries the exact terminology-derived `system|code` token.

Token criteria use the full `system|code` form so a same-named code from
another system can never satisfy them.

#### How caregiver access is derived from CareTeam

Medplum criteria cannot chain through another resource ("Patients whose
CareTeam lists me" is a chained search, which AccessPolicy criteria do not
support). The CareTeam derivation therefore lives at the **binding**, and this
is the one rule that must never be violated:

> The only process that ever creates or keeps a caregiver's
> `ProjectMembership.access` binding is one that reads
> `CareTeam.participant`. Removing the caregiver from the CareTeam removes
> the binding; removing the binding revokes all access instantly, because the
> policy is inert without its `patient` parameter.

For the pilot this is an admin procedure (below). For production, implement it
as a Medplum Bot subscribed to `CareTeam` that reconciles every
RelatedPerson-membership's `access` array against current CareTeam
participants — one writer, no second place to remember to revoke. Until that
bot exists, the CareTeam→binding sync is procedural rather than mechanical;
that is a residual gap listed below.

#### Binary content — why the caregiver policy grants no Binary at all

Medplum treats `Binary` specially: it has no search parameters and cannot be
compartment- or criteria-scoped. Access to a Binary is governed by its
`securityContext` — the reader must have access to the resource that
`securityContext` references. Two consequences:

1. **The caregiver policy must not list `Binary`.** Family-summary content
   still flows: when the caregiver reads the family-summary
   `DocumentReference`, Medplum rewrites `content.attachment.url` into a
   short-lived presigned URL, so the app fetches the text without any Binary
   permission. A direct `GET /Binary/<id>` is additionally allowed only when
   the securityContext resource is readable.
2. **Write contract for the voice service (normative):** every `Binary` it
   creates MUST set `securityContext` to its owning `DocumentReference` —
   *not* to the Patient. If a transcript Binary's securityContext pointed at
   the Patient, any principal who can read the Patient (every caregiver)
   could read the raw transcript by guessing a Binary ID. Pointing it at the
   DocumentReference makes Binary access follow document access exactly:
   family-summary Binary readable, note/transcript Binaries not. Write
   `Encounter` + `Binary` + `DocumentReference` in a single transaction with
   `urn:uuid` references so the circular Binary→DocumentReference link is
   created atomically.

## Applying to a live project

Prerequisites: a Medplum project, plus **project-admin** client credentials
for `apply.sh` (create a throwaway admin client in the Medplum app; do not use
the voice client — it does not exist yet and must never be an admin).

```sh
export MEDPLUM_BASE_URL=https://api.medplum.com     # or your self-hosted URL
export MEDPLUM_CLIENT_ID=<project-admin client id>
export MEDPLUM_CLIENT_SECRET=<its secret>
bash medplum/scripts/apply.sh
```

The script is idempotent:

- CodeSystems: `PUT CodeSystem?url=<canonical url>` (conditional update).
- Device / Organization: `PUT <Type>?identifier=<system>|<value>` using the
  terminology identifiers.
- AccessPolicies: `PUT AccessPolicy?name=<name>`.
- ClientApplication: **create-only** (`If-None-Exist: name=...`); an existing
  client is never overwritten, because a conditional PUT would clobber the
  live secret. (`ClientApplication` has no `identifier` search parameter in
  Medplum, hence `name`.)
- Seed bundles: FHIR transactions in which every entry is a conditional
  create (`ifNoneExist` on `identifier`), Patients keyed by Juniper MRN
  (`https://juniper.health/fhir/identifier/mrn|JUN-0001` / `JUN-0002`), all
  other entries by a dedicated seed identifier system
  (`https://juniper.health/fhir/identifier/seed`). Re-running returns
  `200` per entry instead of `201` and duplicates nothing.

### Manual step 1 — voice service credentials

1. In the Medplum app: **Project → Clients → Juniper Voice Service** (created
   by `apply.sh`). Copy the generated client secret into the voice service's
   environment; rotate it here as needed. The secret never enters this repo.
2. Open the client's **ProjectMembership** and set its access policy to
   **Juniper Voice Service Policy** (either the `accessPolicy` field or an
   `access` entry referencing it — this policy takes no parameters).
3. Verify the asymmetry from the service's credentials:
   `POST /fhir/R4/MedicationStatement` must return 403;
   `POST /fhir/R4/Encounter` must succeed.

### Manual step 2 — invite the caregiver and bind the policy

The seeded caregiver for Peggy is Carmen Reyes (`RelatedPerson`,
`carmen.reyes@example.com`); for Hal it is Kenji Nakamura. To give Carmen real
login access (admin invite endpoint, `POST /admin/projects/<projectId>/invite`):

```json
{
  "resourceType": "RelatedPerson",
  "firstName": "Carmen",
  "lastName": "Reyes",
  "email": "carmen.reyes@example.com",
  "sendEmail": true,
  "membership": {
    "access": [
      {
        "policy": { "reference": "AccessPolicy/<id of Juniper Caregiver Policy>" },
        "parameter": [
          { "name": "patient", "valueReference": { "reference": "Patient/<id of JUN-0001>" } }
        ]
      }
    ]
  }
}
```

The invite creates a `User`, a `RelatedPerson` profile, and the
`ProjectMembership` with that binding. Then reconcile profiles — the invite
created a *new* RelatedPerson, and the CareTeam references the *seeded* one.
Either:

- update the new `ProjectMembership.profile` to reference the seeded
  RelatedPerson (and delete the invite-created one), **or**
- replace the seeded CareTeam participant `member` reference with the
  invite-created RelatedPerson.

Either way, finish by confirming the invariant: the membership's `access`
binding exists **because** that RelatedPerson is on the patient's CareTeam.
To revoke: remove them from the CareTeam **and** remove the `access` entry
(or delete the membership) — the bot described above is what collapses those
two steps into one in production.

Repeat for Kenji with `Patient/<id of JUN-0002>` to run the isolation tests:
logged in as Kenji, Peggy's records must all 403/404; logged in as Carmen,
Hal's must.

## Seed data

**All clinical content is synthetic.** The LOINC / RxNorm / SNOMED codes are
real codes chosen for plausibility (they are the reference codes commonly used
in FHIR examples and synthetic datasets), but no real person, chart, or
clinical judgment is represented. Names, phone numbers (555 ranges), and
addresses are fictional.

`seed/seed-bundle.json` — **Margaret "Peggy" Alvarez** (MRN `JUN-0001`,
b. 1946, widowed, Silver Spring MD; nickname in `Patient.name` with
`use: nickname`; home phone in `telecom`; `communication` en-US):

- **Carmen Reyes** — daughter (`RelatedPerson`, v3-RoleCode `DAUC`), on the
  CareTeam as Caregiver (SNOMED 133932002) alongside PCP **Dr. Priya Chen**
  (SNOMED 446050000).
- **Consent** granting all three Juniper provisions (`ai-calling`,
  `call-recording`, `family-sharing`), `performer` = the patient
  (first-party consent), policy URI from terminology.
- **Six Conditions**: hypertension, type 2 diabetes, osteoarthritis,
  hyperlipidemia, atrial fibrillation, osteoporosis (SNOMED, active,
  confirmed, problem-list items).
- **Six active MedicationRequests** (RxNorm): lisinopril 10 mg 314076,
  metformin ER 500 mg 860975, atorvastatin 20 mg 617312, amlodipine 5 mg
  197361, warfarin 5 mg 855332, furosemide 20 mg 310429 — plus a
  patient-reported **MedicationStatement** for OTC aspirin 81 mg 243670,
  deliberately noted as un-reconciled against the warfarin (a finding the 4M
  medication conversation should surface).
- **Two AllergyIntolerances**: penicillin (SNOMED 91936005, urticaria) and
  cashew (227493005, anaphylaxis).
- **Observation history**: two BPs trending 142/84 → 136/78 (LOINC 85354-9
  with 8480-6/8462-4 components), a three-point weight decline
  64.4 → 63.5 → 62.8 kg (29463-7), and a PHQ-2 score of 1 (55758-7).
- **Hospitalization Encounter**: inpatient, finished, 2026-07-08 → 07-12
  (~3 weeks before today's seed date), reason = fall (SNOMED 1912002),
  discharged home. Its reason is *not* `juniper-4m-checkin`, which is exactly
  why the caregiver policy cannot see it.
- **Upcoming Appointment**: booked post-discharge follow-up with Dr. Chen,
  2026-08-07.
- **Goal + CarePlan**: "walk to the mailbox without the walker" (expressed by
  the patient — What Matters material), inside a fall-prevention CarePlan
  referencing the CareTeam, conditions, and goal.

`seed/seed-bundle-second-patient.json` — **Harold "Hal" Nakamura** (MRN
`JUN-0002`, b. 1943, Baltimore MD): his own caregiver (son **Kenji**), his own
CareTeam and PCP (**Dr. Marcus Webb**), COPD + hypertension, amlodipine, one
weight. His **Consent permits only `ai-calling` and `call-recording`** — the
`family-sharing` provision is absent, so the post-call pass must not generate
a family summary for him at all (consent-gating test), and Kenji must see
Hal's timeline but never Peggy's anything (isolation test). The pre-call gate
still dials him: calling and recording are granted.

Both bundles are self-contained: every reference is a `urn:uuid` resolved
within the bundle (verified by `check.mjs`), so they never depend on apply
order or on resources outside themselves.

## Residual gaps (Medplum-model limitations, stated honestly)

1. **CareTeam-derived access is a binding discipline, not a criteria
   expression.** AccessPolicy criteria cannot chain ("patient whose CareTeam
   contains %profile"), so removal from a CareTeam does not *by itself*
   revoke access — removing the membership `access` binding does. The
   documented invariant plus a reconciling Bot closes the gap; until the bot
   ships it is procedural. The caregiver access-scope test ("removing them
   from the CareTeam immediately revokes access") passes only once that
   automation exists.
2. **Binary scoping rests on the securityContext write contract.** The policy
   layer cannot itself constrain Binary; it can only refuse to grant it
   (done). Safety of note/transcript binaries therefore depends on the voice
   service always setting `Binary.securityContext` to the owning
   DocumentReference. This is a normative MUST for `services/voice/medplum.py`
   and belongs in its write-path tests.
3. **ClientApplication idempotency is by `name`.** Medplum's
   ClientApplication has no `identifier` search parameter, so `apply.sh` keys
   on the (unique-in-project) name and is create-only to preserve the secret.
4. **Caregiver policy cannot show Practitioner names via reads.** The family
   app renders PCP/owner names from `Reference.display` (which the voice
   service must populate on `Task.owner` etc.) rather than reading
   Practitioner — an intentional trade to keep the caregiver surface minimal,
   consistent with CONTRACTS.md §2, which requires the app to function on
   Encounters, family summaries, and Tasks alone.
5. **`%patient` substitution is Medplum-specific behavior** (their
   parameterized-policy feature). If self-hosting, keep the server new enough
   to support `ProjectMembership.access[].parameter`; the legacy single
   `accessPolicy` field cannot express per-patient scoping.
