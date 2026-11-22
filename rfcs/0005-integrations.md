# RFC 0005: Integrations

| Field | Value |
|---|---|
| Status | Draft |
| Spec version | 0.1.0 |
| Date | 2026-11-21 |
| Depends on | [RFC 0001](https://ogrl.adversity.dev/rfcs/0001-object-model/), [RFC 0002](https://ogrl.adversity.dev/rfcs/0002-tooling/), [RFC 0003](0003-application.md), [RFC 0004](0004-http-api.md) |
| AI assistance | Drafted and edited with AI tools; human review in progress (see [README](https://github.com/adversitydotdev/ogrl-tooling#ai-assistance)) |

This RFC specifies how the OGRL application collects live evidence from vendor systems such as identity providers, cloud accounts, and source hosts. It covers integration packages, installing them, connecting them to vendor accounts, collecting snapshots, the protocol between the application and an integration process, and the SDK for writing integrations. RFC 0001 section 7.6 defines the language side: the source grammar, the snapshot document, and the `rule` and `integration` runners. Open questions are collected in [Section 13](#13-open-questions).

## 1. Summary

An **integration** is a package that knows how to read one vendor. An organization installs it, then creates a **connection**: an integration plus the credentials for one vendor account, bound to the `component` or `system` that account serves. On a schedule, the application asks the integration to **collect** the resources that enabled tests read, and stores each result as a **snapshot**. Tests then evaluate snapshots, either with a CEL rule the organization can write without code (`runner: rule`) or with a check shipped inside the integration (`runner: integration`). Each run records an ordinary RFC 0001 `result`, and the snapshots it read become its `evidence`.

Three properties drive the design:

- **Credentials never leave the deployment.** OGRL is self-hosted by one organization ([RFC 0003](0003-application.md)). Integrations run inside that deployment, and each organization registers its own OAuth applications. No adversity.dev service handles tokens.
- **Collect once, evaluate many times.** Only collection talks to the vendor and only collection holds credentials. Checks see snapshots and nothing else, so ten tests about Okta users make one set of Okta API calls, and the auditor can open the exact data each result was computed from.
- **Integrations cannot change status.** They produce snapshots and check outcomes. Status computation stays in the kernel ([RFC 0003 section 5](0003-application.md#5-ports)).

Organizations extend the system at four levels, from cheapest to most involved: write a rule test against a source an installed integration already collects; enable a test template an integration ships; define a query source over the vendor's OpenAPI description ([RFC 0006](0006-query-sources.md)); or build an integration with the SDK.

## 2. Terms

| Term | Meaning |
|---|---|
| Integration | A versioned package, identified by a reverse domain name (`dev.adversity.okta`), that collects resources from one vendor and may ship checks and test templates. |
| Resource | A kind of vendor record an integration collects (`users`), with a JSON Schema for its items and a major version. A resource plus its integration is a source (`dev.adversity.okta/users@1`). |
| Connection | An organization's configured link from an installed integration to one vendor account: configuration, credentials, and bindings. Connections are deployment configuration, not OGRL objects. |
| Binding | A connection's attachment to a `component` or `system`, telling the harness whose implementations the vendor account describes. |
| Collection | A job that asks the integration process for one resource from one connection and stores the result as a snapshot. |
| Snapshot | The RFC 0001 snapshot document for one collection: source, `collected`, `complete`, and items. |
| Check | Code inside an integration that evaluates one or more snapshots, invoked by `runner: integration`. |
| Template | A test, minus its envelope, that an integration ships so an organization can enable it with one action. |

## 3. Integration packages

A package is a gzipped tar archive containing a manifest, a JSON Schema per resource, and the code for one runtime:

```text
manifest.yaml
schemas/users.json
schemas/groups.json
wheels/*.whl                  # runtime: python
bin/linux-arm64/okta          # runtime: binary (one per platform)
bin/linux-amd64/okta
```

**Runtimes.** `python` packages carry pure-Python wheels (`py3-none-any`) under `wheels/` and an entry point (`module:callable`, such as `okta_integration:app.run`). The host runs the entry point with the interpreter already in the OGRL image (`python -I`). An installed package runs **from memory**: the host writes the package's `.py` files and wheels as the first line on the process's stdin, and a small bootstrap serves them to `import`, including modules inside the wheels. A directory package imports from its directory, which may be a read-only mount. Either way nothing is unpacked or installed, and nothing is written to disk, so OGRL runs integrations on a read-only root filesystem. The SDK has no dependencies for this reason, and package code must not read files beside its modules: data belongs in code. Packages that need compiled dependencies use the `binary` runtime, which runs only from a directory package because an executable must exist as a file. `binary` packages carry one static executable per platform; the production image is `linux/arm64` ([RFC 0003 section 9](0003-application.md#9-production-topology)) and local development commonly needs `darwin/arm64`. Any language that can emit a static binary can target `binary`, which is how the TypeScript SDK ([Section 10](#10-sdk-and-tooling)) ships.

**Manifest.**

```yaml
id: dev.adversity.okta
name: Okta
version: 1.4.0                   # semver
protocol: 1
publisher: adversity.dev
description: Workforce users, groups, and MFA factors from Okta.
runtime:
  kind: python
  entrypoint: okta_integration:app.run
egress:                          # recorded now, enforced later (Section 9)
  - "*.okta.com"
config:
  - name: domain
    label: Okta domain
    pattern: "^[a-z0-9-]+\\.(okta|oktapreview)\\.com$"
auth:
  - kind: fields
    label: API token
    fields:
      - name: OKTA_API_TOKEN
        label: Read-only API token
        secret: true
  - kind: oauth2
    label: OAuth application
    authorize_url: "https://{domain}/oauth2/v1/authorize"
    token_url: "https://{domain}/oauth2/v1/token"
    scopes: [okta.users.read, okta.groups.read, okta.factors.read]
    pkce: true
resources:
  - name: users
    version: 1
    schema: schemas/users.json
  - name: groups
    version: 1
    schema: schemas/groups.json
checks:
  - name: admin-mfa-phishing-resistant
    version: 1
    sources: [users, groups]
    args: {}
templates:
  - name: mfa-enforcement
    fulfills_ref: test--ogrl-ac-05-mfa-enforcement
    test:
      name: Every active Okta user is enrolled in MFA
      control_ref: control--ogrl-ac-05
      method: automated
      interval: daily
      run:
        runner: rule
        source: dev.adversity.okta/users@1
        select: item.status == "ACTIVE" && item.type == "human"
        assert: item.mfa_enrolled
```

A manifest declares only read access. The protocol has no operation that changes vendor state ([Section 7](#7-protocol)), and the scopes or permissions an `auth` entry lists are shown to the person creating the connection before any credential is entered.

Resource items should carry `id` and `name`, because the `rule` runner derives a failing item's `subjects` entry from them (RFC 0001 section 7.6).

An integration may emit more than one major version of a resource during a transition (`users` at `1` and `2`). The harness collects each major that an enabled test reads.

## 4. Installing and trust

**Where packages live.** Fargate tasks have no persistent disk, so installing cannot mean unpacking into the container. An install records a row (`integration id`, `version`, archive digest, trust tier, installer, time, source, enabled) in `integration_installs` and copies the archive into the deployment's object storage under `integrations/<id>/<version>/<digest>.tar.gz`. Each process fetches an archive the first time it needs it, verifies the digest, and holds its files in memory; nothing is unpacked to disk. A replaced task re-fetches on demand, and every process reads which version is enabled from the database before it uses a package, so the API and the job service agree. Installs run as jobs (`integration_install`). A version is immutable: installing the same version with different bytes is refused. Reading an archive refuses absolute paths, `..`, links, and devices, and caps entries and size. Fetches go through the object-storage port, so a deployment that wants a shared cache in front of S3 (Redis, for example) can wrap that port; none is needed by default. Packages loaded from `OGRL_INTEGRATIONS_DIR` keep working beside installed ones; an archive cannot take over the id of a directory package.

**One enabled version.** At most one version of an integration is enabled at a time. Every connection and check uses it. An upgrade that removes a resource major or a check major that an enabled test reads is refused until the tests are migrated ([Section 8](#8-checks-and-templates)).

**Trust tiers.**

| Tier | Requirement | Install |
|---|---|---|
| First-party | Sigstore signature from the `adversitydotdev` release workflow identity. | Any operator allowed to manage integrations. |
| Verified | Sigstore signature from a publisher identity listed in the registry. | Same. |
| Local | Unsigned, or signed by an identity the registry does not list. | Only when `OGRL_ALLOW_LOCAL_INTEGRATIONS=true`; the UI marks every integration in this tier. |

Until Sigstore verification ships with the registry (P2), every archive installs as `local`, so archive installs need `OGRL_ALLOW_LOCAL_INTEGRATIONS=true`. A `digest` on the install request pins the exact bytes.

**Registry.** `adversitydotdev/ogrl-integrations` is a Git repository of index files, one per integration, listing the publisher's signing identity and each version's archive URL and digest. The application reads a pinned revision of the index the same way it pins the library (RFC 0002 section 5). Operators can also install from an archive URL or upload; the tier rules still apply.

## 5. Connections

A connection holds:

| Field | Meaning |
|---|---|
| `id` | UUID. Also the binding identifier RFC 0001 uses to order concatenated items. |
| `integration_id` | The installed integration. |
| `name` | Operator label, such as "Okta production". |
| `config` | Values for the manifest's `config` entries. Never secret. |
| `auth_kind` | Which manifest `auth` entry is in use. |
| `bindings` | Component and system IDs this vendor account serves. |
| `state` | `pending` (credentials not validated), `active`, `failing` (last validation or collection failed), or `disabled`. |
| `last_validated`, `identity` | When validation last succeeded, and the vendor identity it reported (such as `acme.okta.com as svc-ogrl`). |

Connections are stored in their own table with every change recorded in the revision log beside the actor. They are not RFC 0001 objects and are not part of Git export; an organization restoring from a snapshot re-creates connections and re-enters credentials.

**Binding resolution.** RFC 0001 section 7.6 leaves "bound to the implementation's scope" to the application. For a test run against an implementation, the harness uses connections for the source's integration that are not `disabled` and are bound to:

- the implementation's `component_ref`, when it sets one (including system-specific override rows that set both `system_ref` and `component_ref`); or
- the implementation's `system_ref`, or any component in that system's `component_refs`, when the implementation sets no `component_ref`.

Binding the "Corporate IdP" component to an Okta connection therefore covers every system that includes that component, which matches how implementations inherit in RFC 0001 section 8.

**Secrets.** Secret values are written once through a write-only route and stored as SSM SecureString parameters under `harness/integrations/<connection id>/<NAME>`, extending the `harness/` prefix in [RFC 0003 section 2](0003-application.md#2-processes). The task role needs `ssm:PutParameter` and `ssm:DeleteParameter` on that prefix only; the CloudFormation template adds both. Local development uses the existing file-backed secrets adapter. Secrets never appear in the database, in API responses, or in logs.

**Auth kinds.**

| Kind | Flow |
|---|---|
| `fields` | The operator enters each declared field. Covers API tokens, service-account keys, and GitHub App IDs with private keys (the integration mints installation tokens itself). |
| `oauth2` | Bring-your-own OAuth application, below. |
| `aws_role` | The connection's config carries `aws_role_arn`. The operator creates a read-only IAM role in the target account, tagged `ogrl-integration=true`, trusting the OGRL task role and requiring the external ID the application generates per connection (returned as `external_id`). The harness calls `sts:AssumeRole` before each operation and passes short-lived credentials to the integration. The task role has `sts:AssumeRole` only on roles with that tag. |

**Bring-your-own OAuth.** Each organization registers its own OAuth application with the vendor. The connection form shows the vendor's setup steps from the integration's documentation and the deployment's single callback URL, `${OGRL_PUBLIC_URL}/v1/oauth/callback`. The operator enters the client ID and secret as the secrets `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET`, then starts the flow:

1. `POST /v1/connections/{id}/oauth/start` returns the authorize URL with the manifest's scopes, a PKCE challenge when `pkce: true`, and a random `state`. The server keeps only a hash of `state`, bound to the connection and the person who started the flow; it is single-use and expires after ten minutes. (The web UI calls the API with a bearer token from the server, so the state is not tied to a browser cookie.)
2. The vendor redirects to `/v1/oauth/callback`. The application verifies `state`, exchanges the code, and stores the refresh token as a secret.
3. Before each operation the harness refreshes the access token and passes it to the integration as `OGRL_ACCESS_TOKEN`. Integrations never see the client secret or refresh token.

OAuth requires a stable origin. The default topology has no load balancer and a task's public address changes when it is replaced, so the application refuses to start an OAuth flow unless `OGRL_PUBLIC_URL` is set (the `PublicUrl` template parameter). Operators set it after configuring a domain or enabling `EnableLoadBalancer`. Integrations should offer a non-OAuth `auth` entry where the vendor supports one, since those work on the default topology.

## 6. Collection

**Scheduling.** The scheduler process ([RFC 0003 section 2](0003-application.md#2-processes)) evaluates every non-revoked test whose runner is `rule` or `integration`. When a test is due (its current result is older than its freshness window, or every hour for `continuous`), the scheduler makes sure each source it reads has a snapshot younger than `OGRL_SNAPSHOT_REUSE` (default one hour) for every bound connection. It enqueues collection jobs for any that are missing, then enqueues the test run once they finish. Collection jobs are deduplicated on `(connection, source)` while one is queued or running, and each connection runs one collection at a time so the integration can respect vendor rate limits. Operators can also trigger a collection or a test run by hand.

**Building the snapshot.** The integration streams items to the host as `items` notifications ([Section 7](#7-protocol)). The harness then:

1. Validates each item against the resource's JSON Schema and removes properties the schema does not declare, recording a warning. Integrations cannot widen what is stored by adding fields at runtime, which keeps tokens and unneeded personal data out of evidence.
2. Writes the RFC 0001 snapshot document in canonical JSON, with `source`, `collected` set to the time the integration returned, `complete` as the integration reported it, and the items.
3. Stores the bytes in object storage under `snapshots/<connection id>/<source>/<collected>.json`, and a row recording connection, source, `collected`, `complete`, item count, size, URI, SHA-256 digest, and the job.

A collection that fails records no snapshot, marks the connection `failing`, and sends an operational alert ([RFC 0003 section 9](0003-application.md#9-production-topology)). A collection that the integration ends early stores a snapshot with `complete: false` so operators can see what was retrieved, but no test evaluates it. Snapshots larger than `OGRL_SNAPSHOT_MAX_BYTES` (default 100 MB) fail the collection.

**Retention.** A snapshot referenced by any `evidence` object is kept as long as that evidence. Unreferenced snapshots are deleted after `OGRL_SNAPSHOT_RETENTION_DAYS` (default 30). Resource schemas should declare only the fields checks need, since everything declared is retained as evidence.

## 7. Protocol

The application runs an integration process for each operation and talks to it with [JSON-RPC 2.0](https://www.jsonrpc.org/specification) over stdin and stdout, one JSON message per line. This replaces the RFC 0001-objects-on-stdout sketch in [RFC 0003 section 6](0003-application.md#6-subprocess-plugins) for integrations: integrations return data and outcomes, and the harness builds every OGRL object itself. Stdout carries only protocol messages. Stderr is captured into the job log, truncated to 64 KB.

**Lifecycle.** The harness sends `initialize`; the process replies with its protocol version, integration ID, and version, which must match the installed manifest. The harness sends exactly one operation, reads `log` and `progress` notifications until the operation's response arrives, then closes stdin. The process must exit within ten seconds of stdin closing.

**Operations.**

| Method | Params | Result | Credentials |
|---|---|---|---|
| `connection.validate` | `config` | `identity`, `granted_scopes`, `warnings` | Yes |
| `collect` | `resource`, `version`, `config` | `count`, `complete`, `reason` when incomplete; the items themselves arrive first as `items` notifications | Yes |
| `check` | `check`, `version`, `args`, `params`, `snapshots` (source → snapshot document, inline) | `outcome` (`pass`, `fail`, `error`), `summary`, `subjects` | No |

During `collect` the process sends `{"method": "items", "params": {"items": [...]}}` notifications in batches, each line under 1 MB; `count` in the response must equal the items sent. An item larger than 1 MB is an error. No operation uses the filesystem.

`connection.validate` should make the cheapest authenticated call that proves the credential works and report which scopes or permissions were actually granted, so the UI can warn about missing ones before the first collection.

**Errors.** Failures are JSON-RPC errors with these `data.kind` values, which the UI shows to operators: `auth_failed`, `permission_denied` (with the missing permission when known), `rate_limited` (with `retry_after` seconds; the harness retries the collection up to three times), `vendor_error`, and `invalid_config`. A crash, a timeout, malformed output, or a version mismatch fails the operation. For `check`, every failure becomes `outcome: error` as RFC 0001 requires.

**Environment.** Each process gets no writable directory: its working directory is the package directory (or `/` for a package in memory), there is no `HOME`, and `PYTHONDONTWRITEBYTECODE` is set. It gets a fixed `PATH`, `OGRL_CONNECTION_ID`, and, for `connection.validate` and `collect` only, the connection's secrets under their manifest names (or `OGRL_ACCESS_TOKEN`, or `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN`). Timeouts default to 15 minutes for `collect` and 30 seconds for `connection.validate`; `check` uses the test's `run.timeout`.

## 8. Checks and templates

**Rules** are evaluated in process by the `rule` runner (`ogrl/kernel/rules.py`). The first release uses [`common-expression-language`](https://pypi.org/project/common-expression-language/), Python bindings over the Rust `cel` crate. Evaluation moves into [`ogrl-rs`](https://github.com/adversitydotdev/ogrl-rs) on the same crate once the CLI gains `ogrl rule eval test.yaml --snapshot users.json`, so authors can test a rule against a saved snapshot without a server and the CLI and server agree.

**Preview.** `POST /rules/preview` evaluates a rule exactly as the runner would, over the latest complete snapshot from each connection (or those bound to an implementation), without collecting, without a freshness window, and without recording anything. It returns compile errors by field, warnings for `item.<field>` names the resource schema lacks, the failing subjects, and the snapshots and parameters it used, so an author sees what a rule would flag before saving it. `GET /integrations` lists each resource's fields from its schema for the same reason.

**Integration checks** run through the `check` operation. The harness resolves `run.check` to the enabled integration version and errors if that version does not provide the check at the requested major.

**Templates.** Enabling a template creates an ordinary organization `test`: the application copies the template's `test`, sets `fulfills_ref`, mints the ID and envelope, sets `created_by_ref` to the enabling person, and records the origin under `extensions`:

```yaml
extensions:
  dev.ogrl.integration:
    integration: dev.adversity.okta
    version: 1.4.0
    template: mfa-enforcement
```

The test is then owned by the organization and can be edited like any other. When an upgrade changes a template, the application compares it against each test created from it and shows the difference; a person accepts or skips each update. Because enabling a template writes a `run` block, agents cannot do it ([RFC 0003 section 4](0003-application.md#4-agents)), and it requires the same permission as authoring a `run` block ([RFC 0004 section 7](0004-http-api.md#7-open-questions)).

## 9. Isolation and security

- **Process separation.** Integration processes run under the dedicated runner OS user with the scrubbed environment from [RFC 0003 section 5](0003-application.md#5-ports), plus only the current connection's credentials. They never inherit the database credential, the task's AWS credentials, or another connection's secrets.
- **Checks hold no credentials.** A malicious or buggy check can misreport an outcome but cannot reach the vendor through OGRL's credentials.
- **Read-only by construction.** No protocol operation writes to a vendor, and manifests list the read scopes they request. First-party and verified review rejects integrations that request write scopes.
- **Bounded output.** The harness enforces timeouts, the snapshot size cap, schema validation with field stripping, and the stderr cap.
- **Not a sandbox.** As with `shell`, the integration process shares the task's network and kernel. It can reach any host and read any file its OS user can. Trust tiers decide what may be installed; operators running verified or local integrations alongside sensitive workloads should enable `EnableJobService` so collection runs outside the API task. Manifests already declare `egress` so enforcement can arrive without a manifest change ([Section 13](#13-open-questions)).
- **Audit trail.** Installs, upgrades, connection changes, secret writes (names only), validations, and collections are recorded with the actor and time.

## 10. SDK and tooling

The protocol is the contract; the SDK is how most integrations get written. First-party integrations are built on it.

**Python SDK (`ogrl-integration`, repository `adversitydotdev/ogrl-integration-sdk`).** Standard library only (see [Section 3](#3-integration-packages)). `Integration(id, version)` must equal the manifest; the conformance suite checks it.

```python
from ogrl_integration import Integration, Subject, fail, pass_

app = Integration("dev.adversity.okta", "1.4.0")


@app.validate
def validate(ctx):
    auth = {"Authorization": f"SSWS {ctx.secret('OKTA_API_TOKEN')}"}
    me = ctx.http.get(f"https://{ctx.config['domain']}/api/v1/users/me", headers=auth).json()
    return ctx.identity(f"{ctx.config['domain']} as {me['profile']['login']}")


@app.resource("users", version=1)
def users(ctx):
    auth = {"Authorization": f"SSWS {ctx.secret('OKTA_API_TOKEN')}"}
    for user in ctx.http.paginate(f"https://{ctx.config['domain']}/api/v1/users", headers=auth):
        yield {"id": user["id"], "name": user["profile"]["login"], "status": user["status"]}


@app.check("admin-mfa-phishing-resistant", version=1)
def admin_mfa(ctx, users, groups):
    admins = {m for g in groups if g["admin"] for m in g["members"]}
    weak = [u for u in users if u["id"] in admins and not u["phishing_resistant"]]
    if weak:
        return fail(
            f"{len(weak)} admins lack phishing-resistant MFA",
            subjects=[Subject.account(u["name"], u["id"]) for u in weak],
        )
    return pass_(f"{len(admins)} admins use phishing-resistant MFA")
```

It provides the stdio framing and lifecycle, an HTTP client on `urllib` that retries with backoff and honors `Retry-After` and maps 401, 403, and 429 to the protocol's error kinds, pagination by `Link` header, body URL, or cursor, batched `items` streaming for `collect` (with `Incomplete`, or a rate limit after some items, marking the snapshot incomplete), and typed errors for the rest. Checks receive one keyword argument per resource they read, and no credentials or HTTP client.

**Testing.** Repository rules forbid tests that call real vendors. The SDK test kit records vendor HTTP traffic once into scrubbed cassettes and replays them, and runs any operation through an in-memory harness, so an integration's tests run offline. A language-agnostic **conformance suite** drives any package through the protocol and checks lifecycle, error mapping, schema adherence, and the no-credentials-in-`check` rule; registry listing requires passing it.

**CLI.** `ogrl-integration new` scaffolds a package with a replayable cassette and passing tests, `run` executes one operation from the developer's machine (optionally recording or replaying a cassette), `test` runs the conformance suite, and `pack` builds a deterministic archive that bundles the SDK wheel. Signing arrives with the registry.

**TypeScript SDK.** The same surface, compiled to a `binary` runtime package. It follows the Python SDK once the protocol has shipped with real integrations.

## 11. Changes to RFC 0003 and RFC 0004

**RFC 0003.** The Runner port gains the `rule` runner (in process) and the `integration` runner (through the protocol). The Connector port becomes the integration host: given a connection and a source, it returns a snapshot. Section 6's generic subprocess sketch remains for organization runners; integrations use [Section 7](#7-protocol).

**RFC 0004.** `GET /connectors` and `POST /connectors/{id}/jobs` are replaced by:

| Route | Purpose |
|---|---|
| `GET /integrations`, `GET /integrations/{id}` | Installed integrations, enabled version, tier, resources, checks, templates. |
| `POST /integrations`, `POST /integrations/archives` | Install from a URL or an upload (job); enables it unless `enable: false`. |
| `GET /integrations/{id}/versions`, `POST /integrations/{id}/versions/{version}/enable` | Installed versions; enable one to upgrade or roll back. Refuses a version that drops a source or check major an enabled test reads. |
| `GET /integrations/{id}/template-updates`, `POST /integrations/{id}/template-updates/{test_id}/apply` | Tests whose template changed in the enabled version, and accepting one (`If-Match`). |
| `POST /integrations/{id}/templates/{name}/enable` | Create a test from a template. |
| `GET /connections`, `POST /connections`, `GET /connections/{id}`, `PATCH /connections/{id}` | Connection CRUD (`If-Match` as elsewhere). |
| `PUT /connections/{id}/secrets/{name}` | Write-only secret value. |
| `POST /connections/{id}/validate` | Run `connection.validate` (job). |
| `POST /connections/{id}/oauth/start`, `GET /oauth/callback` | Bring-your-own OAuth. |
| `POST /connections/{id}/collections` | Collect one or more sources now (job). |
| `GET /snapshots`, `GET /snapshots/{id}`, `GET /snapshots/{id}/content` | Snapshot metadata and bytes, filterable by connection and source. |
| `POST /rules/preview` | Try a rule over the latest snapshots without saving or recording ([Section 8](#8-checks-and-templates)). |

Disabling a connection is `PATCH` with `state: disabled`. `DELETE /connections/{id}` removes a connection and its secrets; the no-delete rule in RFC 0004 section 3 applies to graph objects, and results and evidence produced through the connection are untouched. `JobType` gains `integration_install` and `collection` and drops `connector`.

The Section 5 row on vendor-specific routes still holds: there are no `/integrations/aws` routes, and every integration is reached through the same generic resources.

## 12. Delivery phases

| Phase | Scope |
|---|---|
| P0 | RFC 0001 `rule` and `integration` runners; CEL (through `common-expression-language` until `ogrl-rs` carries it); protocol version 1; archive installs (local tier and digest pinning), upgrades, rollbacks, and template updates; connections with `fields`, `oauth2`, and `aws_role`; collection and snapshots; templates; the API above; Integrations and Connections views; an SDK alpha and a fake integration with a local vendor emulator for the e2e suite. |
| P1 | Python SDK and test kit release; conformance suite; first-party GitHub, AWS, and Okta integrations whose templates fulfill the library's automated tests. |
| P2 | Registry, Sigstore verification, and first-party and verified tiers; install and upgrade UI with template diffs; Google Workspace and Entra ID; TypeScript SDK. |
| P3 | Egress enforcement, event-driven collection, normalized sources. |

## 13. Open questions

1. **Egress enforcement.** Fargate offers no per-process network policy inside a task. Options are a filtering forward proxy in the task that integration processes must use (with `egress` as its allowlist), or one task per collection with its own security group. Both cost money or complexity the idle bill does not have room for by default.
2. **Event-driven collection.** Vendor webhooks would let `continuous` tests react in minutes, but they need a stable public endpoint and per-vendor signature verification. They wait for `OGRL_PUBLIC_URL` to be common and for a vendor that offers useful events.
3. **Normalized sources.** RFC 0001 open question 9. If OGRL defines shared item shapes such as `dev.ogrl.identity/users@1`, the standard library could ship executable rules and an organization could switch identity providers without rewriting tests.
4. **Personal data in snapshots.** Snapshots of users are personal data kept as evidence. Field stripping limits what is stored, but organizations may need a shorter retention for snapshots than for other evidence, which interacts with RFC 0001 evidence immutability.
5. **Authorization.** Installing integrations, writing secrets, and enabling templates should be separate permissions once roles exist ([RFC 0004 section 7](0004-http-api.md#7-open-questions)). Until then any valid token can do all three.
