# RFC 0004: HTTP API

| Field | Value |
|---|---|
| Status | Draft |
| Spec version | 0.1.0 |
| Date | 2026-11-21 |
| Depends on | [RFC 0001](https://ogrl.adversity.dev/rfcs/0001-object-model/) 0.2.0, [RFC 0002](https://ogrl.adversity.dev/rfcs/0002-tooling/), [RFC 0003](0003-application.md) |
| AI assistance | Drafted and edited with AI tools; human review in progress (see [README](https://github.com/adversitydotdev/ogrl-tooling#ai-assistance)) |

## Changelog

### 0.1.0 (2026-11-21)

- Published on tools.adversity.dev (moved from `adversitydotdev/ogrl`).
- Pointed HTTP API integration and connection workflows at RFC 0005.
- Renamed OpenGRC to OGRL (terminology and cross-links).
- Initial public draft of HTTP API design rationale, resource conventions, and operational workflows.

This RFC documents the design rationale, resource conventions, and operational workflows of the HTTP API served by `fathom`. The formal route and schema contract lives in [api/openapi.yaml](https://github.com/adversitydotdev/fathom/blob/main/api/openapi.yaml). Open design questions are collected in [Section 7](#7-open-questions).

## 1. Summary

The HTTP API speaks the exact object model defined in RFC 0001 (spec version 0.2.0): every endpoint accepts and returns RFC 0001 objects, paginated lists of them, or computed views produced directly by the kernel. Commercial GRC platforms—Vanta, Drata, Secureframe, and Paramify—all manage the same core operational concepts under proprietary names. [Section 2](#2-how-existing-grc-apis-map-to-ogrl) maps those APIs onto OGRL resources, and [Section 5](#5-workflows-intentionally-left-out-of-the-api) explains why workflows outside the RFC 0001 language do not get ad-hoc routes.

As established in [RFC 0003](0003-application.md), this API is the sole writer to an organization's database. Library-building CLI commands operate locally without it, future organization CLI commands call it, and the Next.js frontend renders its responses without recomputing status.

## 2. How existing GRC APIs map to OGRL

A survey of public commercial GRC APIs (as of November 2026) shows strong structural convergence across the same underlying operational work:

| Operational concept | Vanta | Drata | Secureframe | Paramify | OGRL resource(s) |
|---|---|---|---|---|---|
| Practice the org runs | Control (with owner & notes) | Control (with owners, reqs, tests, evidence) | Control (read-only) | Requirement on an element | `control` + `implementation` |
| Standard judged against | Framework & controls | Requirements & reports | Framework | Target framework on project | `framework`, `requirement`, `baseline`, `program` |
| Crosswalk | Control-to-document / test links | Control linked to requirement IDs | Implicit | Control mappings on an issue | `mapping`, `mapping_review` |
| Recurring check | Test (status, owner, failing items) | Monitor & test | Test (create & update) | Validator (pass / fail / partial) | `test`, `result` |
| Audit proof | Document upload + submit | Evidence library on control/person | Evidence on a test | Evidence set + artifact upload | `evidence` + content route |
| Written mandate | Policy document | Policy linked to control | Knowledge base (separate) | Generated policy deliverable | `policy`, `procedure` |
| Risk tracking | Risk scenario & controls | Risk | Vendor risk (separate from issues) | Issue with risk & milestones | `risk` |
| Formal waiver | Deactivated test | Archived/disabled control | Archived vendor/connection | Deviation | `exception`, or `revoked` |
| Assessor judgment | Not exposed publicly | Not exposed publicly | Not exposed publicly | Assessment & cycle | `finding` + point-in-time status |
| Inherited service | Vendor & documents | Vendor, review, sub-processor | Vendor & integration | Element | `party`, `component`, provider bundle |
| Owner / actor | User | Personnel & user | User | Person on an issue | `party` |
| Export package | Not in public control API | Report | Test export | `GET /issues/oscal`, SSP, POA&M | Render job |

On the federal side, Paramify aligns closely: its *issues* map to risks/POA&M lines, *deviations* to exceptions, *elements* to components, and *evidence sets* to evidence records. On the commercial side, Vanta and Drata bundle what OGRL deliberately separates into a reusable `control` and a system-specific `implementation`, keeping shared practices cleanly decoupled from per-system narratives.

## 3. API rules

**Request and response bodies are native OGRL objects.** Field names match RFC 0001 verbatim—the API never renames `control_ref` to `controlId`. Callers that want pre-joined dashboards use dedicated computed-view endpoints rather than mutated object schemas.

**Cursor pagination.** List endpoints accept `limit` (default `50`, maximum `200`) and `cursor`, returning `{ "data": [...], "page": { "next_cursor": "..." } }` with `next_cursor` omitted on the final page. Query filters mirror real operational slices: by system, control, framework, status, owner, and date.

**Optimistic concurrency with exact `If-Match`.** Every update requires an `If-Match` header matching the object's current `modified` timestamp; stale writes fail with `412 Precondition Failed`. `modified` advances strictly on every write with fractional-second precision so even back-to-back writes within the same second produce distinct values. Creates omit `If-Match`: the server sets `created`, `modified`, and `spec_version`, accepts a client-supplied UUID or domain-prefixed slug for `id` (minting a UUID if omitted), and rejects any `id` in the reserved standard-library namespace.

**Full-envelope writes with round-trip preservation.** Every create and update accepts the common envelope fields (`tags`, `external_references`, `extensions`, `lang`) alongside type-specific fields. Unrecognized fields are persisted and returned verbatim in accordance with RFC 0001's round-trip guarantee.

**Immutability of results and complete evidence.** `result` objects have no `PATCH` route. On `evidence`, `PATCH` may always update `name` and `tags`, and may update remaining fields only before content bytes are uploaded; once complete, attempting to mutate fields frozen by RFC 0001 returns `409 Conflict`. Corrections require revoking the record and creating a new one.

**True point-in-time evaluation.** Passing `at` in the past evaluates status against the historical object revisions and pins that were in force at `at` (RFC 0002 section 4), never against today's edited objects.

**Revoke instead of delete.** Because RFC 0001 forbids reusing IDs, there are no `DELETE` endpoints on graph objects. `POST /{collection}/{id}/revoke` marks `revoked: true` and returns the updated object (fulfilling what Drata calls archiving and Vanta calls deactivating). List queries hide revoked items by default unless `revoked=true` is passed.

**Read-only projections.** Library rows and imported provider rows cannot be mutated (`PATCH` returns `409 Conflict`). Organizations accept or reject library mappings via `mapping_review` and supply their half of shared controls by creating an organization `implementation` with `system_ref`.

**Asynchronous jobs for long-running work.** Library pulls, provider imports, test runs, renders, Git exports, restores, integration installs, and collections return `202 Accepted` with a `job` resource that callers poll via `GET /jobs/{id}`. Completed jobs point to the resulting object ID or rendered artifact.

**Nested lists stay on their parent.** Milestones live on `risk`, parameters on `control`, and parts/objectives on `requirement`—callers patch the parent object rather than hitting sub-routes for individual list items. Entities with independent identities and lifecycles (`exception`, `finding`, `result`, `evidence`) are top-level collections.

**Computed status is a view.** `GET /programs/{id}/status` executes the kernel's RFC 0001 section 8 evaluation at `at` and returns both control statuses (`met`, `gap`, `waived`, `out_of_scope`) and requirement coverage. Clients render this payload directly and never reimplement status logic.

**Binary content uses dedicated side routes.** `POST /evidence/{id}/content` (and the equivalent routes for `policy` and `procedure`) uploads artifact bytes to object storage, populates `resource.uri` and `resource.digest`, and returns the updated object; `GET .../content` streams the bytes back. OGRL objects never inline binary payloads. Recurring collection schedules live on tests, policies, and procedures rather than on a separate "evidence set" type, and `GET /evidence?implementation_id=...` provides the full artifact history.

## 4. Operating a program through the API

A complete end-to-end compliance workflow maps cleanly onto these endpoints (`PUT` is not used):

1. **Pull the library:** `POST /library/pull` loads a pinned revision of the OGRL standard library.
2. **Import providers:** `POST /providers` ingests a vendor's provider bundle or OSCAL component definition; `PATCH /systems/{id}` attaches the component via `component_refs`.
3. **Bind a program:** `POST /programs` pairs a `system` with a library baseline or a custom baseline created via `POST /baselines` (`GET /baselines/{id}/effective` returns the resolved baseline after `extends_ref`).
4. **Document implementations:** `POST /implementations` records how a system carries out a control; `PATCH` updates narratives, statuses, and parameter values.
5. **Author and run tests:** `POST /tests` registers an executable check methodology; `POST /tests/{id}/runs` schedules execution on the harness.
6. **Attach evidence:** Automated test runs emit evidence automatically; manual uploads use `POST /evidence` followed by `POST /evidence/{id}/content`.
7. **Record exceptions and findings:** `POST /exceptions` waives an implementation; `POST /findings` records an assessor's objective determination.
8. **Track remediation:** `PATCH /risks/{id}` updates risk treatment and remediation milestones.
9. **Monitor readiness:** `GET /programs/{id}/summary` and `GET /programs/{id}/status` power dashboards and readiness checks.
10. **Export packages:** `POST /programs/{id}/renders` with `view: oscal` generates the RFC 0002 OSCAL package (profile, SSP, mapping collection, component definition, assessment results, and POA&M), and `POST /exports/git` triggers a Git snapshot.

Two specialized workflows round out the surface:

- **One-time restore:** `POST /restore` bootstraps an empty organization database from a snapshot (RFC 0002 section 8.1) and returns `409 Conflict` if any organization objects already exist.
- **Custom crosswalks and reviews:** `POST /mappings` creates an organization-authored crosswalk (superseding any library mapping for the same pair during status evaluation without mutating the library), while `POST /mapping-reviews` accepts or rejects library mappings.

## 5. Workflows intentionally left out of the API

Commercial GRC suites expose several adjacent domains that RFC 0001 deliberately excludes. Adding API endpoints without backing language objects would fork the data model, so these remain out of scope:

| Commercial feature | Why Fathom omits it |
|---|---|
| HRIS sync, employee rosters, background checks, per-person training | A `party` represents ownership, and training completion is simply `evidence` on the relevant control; a full HR compliance directory is a separate product. |
| Device, cloud resource, and repository asset inventories | Asset inventory belongs in a CMDB. Results may cite inline `subjects` without promoting them to managed asset records. |
| Vendor questionnaires, renewal calendars, sub-processor portals | Inherited controls are modeled via `subservice` parties, `component`s, and provider bundles; full TPRM is an explicit non-goal of RFC 0001. |
| Public trust centers and security questionnaires | External marketing/sales workflows; any live program metrics they need already come from `GET /programs/{id}/status`. |
| Jira / ServiceNow ticketing | Future connectors may read tickets or attach evidence from them, but tickets are not OGRL objects. |
| Vendor-specific integration routes (`/integrations/aws`) | Every integration is reached through the generic `/integrations`, `/connections`, and `/snapshots` resources in [RFC 0005](0005-integrations.md#11-changes-to-rfc-0003-and-rfc-0004). |

## 6. Errors

All error responses use RFC 9457 Problem Details (`application/problem+json`) with a URN `type`:

| HTTP status | Meaning |
|---|---|
| `400 Bad Request` | Request body or query parameter fails schema validation or violates an RFC 0001 graph constraint. |
| `401 Unauthorized` | Missing or invalid bearer token. |
| `403 Forbidden` | Authenticated token lacks permission for this action (role model deferred; see [Section 7](#7-open-questions)). |
| `404 Not Found` | Referenced object ID does not exist. |
| `409 Conflict` | Attempted write against a read-only library/provider row, frozen evidence field, duplicate ID, or non-empty database during restore. |
| `412 Precondition Failed` | `If-Match` does not match the object's current `modified` timestamp. |
| `415 Unsupported Media Type` | Uploaded content uses a media type the endpoint does not accept. |

## 7. Open questions

1. **Authentication:** The API requires a bearer token without yet specifying token issuance or multi-tenant organization selection (deferred with user accounts in RFC 0001 and slated for the next API revision).
2. **Authorization:** Commercial APIs scope tokens to fine-grained capabilities (such as read-only control listing). Until Fathom defines formal roles—including the dedicated permission for writing executable `test.run` blocks ([RFC 0003 section 5](0003-application.md#5-ports))—a valid token can invoke any route on a single-organization server.
3. **Webhooks:** Event notifications (such as alerting Slack or opening a ticket on test failure) are straightforward to model as subscriptions but non-trivial to deliver reliably; they wait until concrete callers need them.
4. **Partial update semantics:** `PATCH` currently defaults to JSON Merge Patch (RFC 7386), where sent fields merge and arrays replace wholesale (sending `milestones` replaces the entire list). JSON Patch (RFC 6902) offers finer-grained array edits at the cost of a much noisier authoring experience.
