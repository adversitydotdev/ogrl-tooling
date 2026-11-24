# Integration SDK

| Field | Value |
|---|---|
| Repository | [adversitydotdev/ogrl-integration-sdk](https://github.com/adversitydotdev/ogrl-integration-sdk) |
| Version | 0.1.0a12 |
| Language | Python |

`ogrl-integration` is the Python SDK for writing OGRL integrations as defined in [RFC 0005](/rfcs/0005-integrations/). It implements the JSON-RPC protocol loop, a standard-library HTTP client with retries and error mapping, query-source executors over OpenAPI and AWS Smithy descriptions, an offline test kit with cassettes, and the `ogrl-integration` CLI that scaffolds, runs, conformance-tests, and packs an integration package. The runtime has no dependencies, so a packed integration runs from memory on a read-only filesystem.

## Concepts

An **integration** is a process the Fathom host starts once per operation. The host talks to it over stdin and stdout with JSON-RPC 2.0, one message per line ([RFC 0005 section 7](/rfcs/0005-integrations/#7-protocol)). Stdout carries protocol messages only; logs and tracebacks go to stderr.

An integration provides three kinds of operation:

| Operation | SDK hook | Sees credentials | Returns |
|---|---|---|---|
| `connection.validate` | `@app.validate` | Yes | Vendor identity, granted scopes, warnings |
| `collect` | `@app.resource(name, version)` | Yes | Items, streamed to the host; the host builds the snapshot |
| `check` | `@app.check(name, version)` | No | `pass`, `fail`, or `error` with a summary and subjects |

A **resource** is a named, major-versioned stream of vendor records, described by a JSON Schema in the package. The host validates each item against that schema, strips undeclared properties, and stores the result as an RFC 0001 snapshot (section 7.6 of the [object model](https://ogrl.adversity.dev/rfcs/0001-object-model/)). A resource is addressed as a source: `<integration id>/<name>@<major>`, such as `dev.adversity.github/repositories@1`. Tests read snapshots either with the `rule` runner (an expression over items, no integration code) or with the `integration` runner, which calls one of the integration's checks.

A **connection** is an operator's configured account at the vendor: non-secret `config` values plus credentials for one of the manifest's `auth` kinds ([RFC 0005 section 5](/rfcs/0005-integrations/#5-connections)):

| Auth kind | What the process receives | SDK accessor |
|---|---|---|
| `fields` | Each declared field as an environment variable | `ctx.secret("NAME")` |
| `oauth2` | A fresh access token in `OGRL_ACCESS_TOKEN` (bring-your-own OAuth app) | `ctx.access_token` |
| `aws_role` | Short-lived `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | `ctx.aws_credentials` |

## Install

The runtime needs Python 3.12 or later. The CLI's `run`, `test`, and `pack` commands read YAML and JSON Schema, so they need the `cli` extra (`pyyaml`, `jsonschema`):

```bash
pip install 'ogrl-integration[cli] @ git+https://github.com/adversitydotdev/ogrl-integration-sdk@v0.1.0a12'
```

## Project layout

`ogrl-integration new` produces this layout; first-party integrations such as `adversitydotdev/ogrl-github` follow it:

```text
acme-directory/
  manifest.yaml                    # id, version, runtime, config, auth, resources, checks, templates
  directory_integration.py         # the Integration and its operations
  schemas/items.json               # one JSON Schema per resource
  tests/cassettes/items.json       # recorded vendor HTTP
  tests/test_directory_integration.py
```

Package code must not read files next to its modules; put data in code. `pack` excludes `tests/`, `dist/`, `.venv/`, and `__pycache__/`.

## Manifest

The manifest format is defined in [RFC 0005 section 3](/rfcs/0005-integrations/#3-integration-packages). The fields the SDK and its conformance suite rely on:

| Field | Notes |
|---|---|
| `id` | Reverse domain name (`dev.acme.directory`). Must equal `Integration(id, ...)`. |
| `version` | Semver. Must equal `Integration(..., version)`. |
| `protocol` | `1`. |
| `runtime` | `kind: python`, `entrypoint: <module>:<app>.run`. |
| `egress` | Hosts the integration calls. Recorded, not yet enforced. |
| `config` | Non-secret connection settings: `name`, `label`, optional `pattern` and `required`. Read with `ctx.config`. |
| `auth` | At least one entry. `fields` entries list `fields` (`name`, `label`); their names are the environment variables `ctx.secret()` reads. |
| `resources` | `name`, `version` (major), `schema`. Schemas must be object schemas declaring `id` and `name`. |
| `checks` | `name`, `version`, `sources` (resource names), optional `args`. |
| `templates` | Tests an organization can enable. A template may only read this integration's sources. |
| `openapi`, `smithy` | Optional; enable query sources ([below](#query-sources)). |

## The app API

```python
from ogrl_integration import Integration

app = Integration("dev.acme.directory", "0.1.0")

if __name__ == "__main__":
    app.run()
```

`app.run()` serves requests until stdin closes. It answers `initialize` with `{"protocol": 1, "id": ..., "version": ...}` and any unknown method with an `invalid_config` error.

### Decorators

- `@app.validate`: `fn(ctx) -> Identity`. Make the cheapest authenticated call that proves the credential works and return `ctx.identity(identity, scopes=[...], warnings=[...])`.
- `@app.resource(name, version=1)`: `fn(ctx)` yields one mapping per item. Generators are the norm; items stream to the host as `items` notifications in batches of at most 500 items or 512 KB, and are JSON-encoded with `default=str`. A single item over about 1 MB fails the collection.
- `@app.check(name, version=1)`: `fn(ctx, **snapshots) -> Outcome`. Each source the host sends becomes one keyword argument holding that snapshot's item list; the name is the resource name with `-` replaced by `_` (`branch-rules` becomes `branch_rules`).

### Context

| Member | Meaning |
|---|---|
| `ctx.config` | The connection's config values. |
| `ctx.env` | The process environment for `validate` and `collect`; empty for `check`. |
| `ctx.secret(name)` | A credential from the environment; raises `InvalidConfig` when unset or empty. |
| `ctx.access_token` | `ctx.secret("OGRL_ACCESS_TOKEN")`. |
| `ctx.aws_credentials` | Dict of the three `AWS_*` variables. |
| `ctx.http` | An `Http` client. Raises `RuntimeError` inside a check: checks evaluate snapshots and cannot call the vendor. |
| `ctx.args`, `ctx.params` | The `args` and `params` sent with `check`, as strings. |
| `ctx.log(message)` | Sends a `log` notification. |
| `ctx.progress(done, total=None)` | Sends a `progress` notification. |
| `ctx.identity(...)` | Builds the `Identity` that `validate` returns. |

## HTTP client

`Http(transport=None, *, retries=3, timeout=30.0, sleep=time.sleep, headers=None)` wraps `urllib`. Operations get one as `ctx.http`.

- `request(method, url, *, params=None, headers=None, json_body=None, data=None, content=None, throttled=None, error_detail=None)`, plus `get(url, **kw)` and `post(url, **kw)`. `params` entries set to `None` are dropped; `json_body` and `data` set `Content-Type`; `content` sends raw bytes (for signed bodies). `Accept: application/json` and a `User-Agent` are sent by default.
- **Retries.** 429, 500, 502, 503, 504, a 403 with `X-RateLimit-Remaining: 0` (GitHub), and any response your `throttled(response)` callback marks are retried up to `retries` times. The wait is `Retry-After`, else the reset time in `X-Rate-Limit-Reset` or `X-RateLimit-Reset`, else exponential backoff from 1 s, capped at 60 s.
- **Error mapping.** After retries, 401 raises `AuthFailed`, a rate limit raises `RateLimited` with `retry_after`, 403 raises `PermissionDenied`, and any other status of 400 or above raises `VendorError`. The exception's `status` holds the HTTP status; the message redacts the query string. `error_detail(response)` can append the vendor's error code and message. Network failures raise `VendorError`.
- `Response` has `status`, `headers`, `body`, `url`, `header(name)` (case-insensitive), `json()`, `text`, and `links` (the RFC 8288 `Link` header as `{rel: url}`).

`paginate(url, *, params=None, headers=None, items=lambda r: r.json(), next_url=None, cursor=None, cursor_param="cursor", max_pages=10_000, error_detail=None)` yields every item across pages. By default it follows `Link: rel="next"`. Pass `next_url` to read the next URL from the body, or `cursor` to read a token that is sent back as `cursor_param`. `items` extracts the list from each page.

```python
for user in ctx.http.paginate(
    f"{base}/users",
    headers={"Authorization": f"Bearer {ctx.secret('ACME_TOKEN')}"},
    items=lambda r: r.json()["users"],
    cursor=lambda r: r.json().get("next_cursor"),
    cursor_param="after",
):
    yield {"id": user["id"], "name": user["email"], "mfa": user["mfa_enabled"]}
```

For hand-written AWS calls, `ogrl_integration.sigv4.sign(method, url, headers, body, *, access_key, secret_key, session_token, region, service)` returns the headers with SigV4 `Authorization`, `X-Amz-Date`, and the session token added; send them with `ctx.http.request(..., headers=signed, content=body)`.

## Outcomes and errors

Checks return one of:

```python
from ogrl_integration import Subject, error, fail, pass_

pass_("42 admins use phishing-resistant MFA")
fail("2 admins lack MFA", [Subject.account("ana@acme.example", "00u1"), ...])
error("the users snapshot is empty")
```

`Subject(kind, name, external_id=None)` names a failing account or resource; `Subject.account(...)` and `Subject.resource(...)` set `kind`. Summaries are truncated to 2,048 characters. Returning anything other than an `Outcome` is an error.

Operations raise typed errors, which `run()` turns into JSON-RPC errors with the RFC 0005 `data.kind`:

| Exception | `data` |
|---|---|
| `AuthFailed(message)` | `{"kind": "auth_failed"}` |
| `PermissionDenied(message, permission=None)` | `{"kind": "permission_denied", "permission": ...}` |
| `RateLimited(message, retry_after=None)` | `{"kind": "rate_limited", "retry_after": ...}` |
| `VendorError(message)` | `{"kind": "vendor_error"}` |
| `InvalidConfig(message)` | `{"kind": "invalid_config"}` |
| Any other exception | `{"kind": "vendor_error"}`, message `Type: text`, traceback on stderr |

All five derive from `IntegrationError`. Two cases end a collection early but keep what was yielded, returning `complete: false` with a `reason`: raising `Incomplete(reason)` from a resource, and `RateLimited` after at least one item. A `RateLimited` before any item is returned as an error so the host retries the operation. Re-raise `PermissionDenied` with `permission=` to tell the operator what to grant, as `ogrl-github` does for branch protection (`administration:read`).

## Query sources

Query sources let an organization define new sources over a vendor API without integration code. The integration bundles an API description in its manifest; the SDK validates each query again in the integration process and executes it. `collect` carries the definition (`operation`, `params`, `items`, `fields`, and for Smithy `regions`, plus optional `for_each`) in a `query` parameter. An integration with neither block answers `invalid_config`. When both are present, the Smithy executor is used.

### OpenAPI

Declared as in [RFC 0006 section 4](/rfcs/0006-query-sources/#4-integration-support):

```yaml
openapi:
  description: openapi/acme.yaml          # OpenAPI 3.x, JSON or YAML; local $refs only
  base_url: "https://{domain}"            # {placeholders} filled from config, which must be host names
  pagination: link                        # link | next-url:<path> | cursor:<response path>:<param> | none
  read_operations: []                     # non-GET operations that only read
  authorization: "Bearer {ACME_TOKEN} | Bearer {OGRL_ACCESS_TOKEN}"
```

`authorization` uses the first `|` alternative whose variables are all set in the environment. The executor refuses non-https base URLs (except `localhost`), non-read operations, and unsafe path parameters ([RFC 0006 section 5](/rfcs/0006-query-sources/#5-read-only-enforcement)), projects `fields` from each item (`$parent.<path>` reads the listed item under `for_each`), and stringifies `id` and `name`.

### Smithy

Declared as in [RFC 0007 section 2](/rfcs/0007-smithy-query-sources/#2-integration-support): `smithy.services.<name>` with `model` (Smithy 2.0 JSON AST), `endpoint` (`{region}` makes it regional), optional `signing_region` and `target_prefix`, plus `read_operations` and `deny_operations`. Operations are named `<service>.<Operation>`. Supported protocols are `awsJson1_0`, `awsJson1_1`, `restJson1`, `awsQuery`, `ec2Query`, and `restXml`. Requests are signed with SigV4 from `ctx.aws_credentials`, so connections use `aws_role`. Pagination follows the model's `@paginated` trait. A query's `regions` is a list, a comma-separated string, or `"*"` for the connection's `regions` (or `region`) config; each item gains a `region` field, and `$region` can be projected. A failing region is skipped and marks the collection incomplete; if every region fails, the first error is raised. Which operations count as reads is defined in [RFC 0007 section 3](/rfcs/0007-smithy-query-sources/#3-what-is-a-read).

### Generated modules

The description cannot be read from disk at runtime, so the CLI compiles it into a Python module beside the entrypoint: `_ogrl_openapi.py` (settings and description, compressed) and `_ogrl_smithy.py` (models trimmed to queryable operations and the shapes they reach). `run`, `test`, and `pack` regenerate them; `openapi build` and `smithy build` do it explicitly. `pack` also ships the raw description and the trimmed models so the host can validate queries without importing package code.

## Testing

`ogrl_integration.testing` runs operations in process over the same JSON-RPC framing the host uses.

- `Harness(app).validate(config, secrets=None)` returns the `connection.validate` result.
- `Harness(app).collect(resource, version, config, secrets=None, query=None)` returns `Collected(items, complete, reason, logs)` and asserts that `count` equals the items streamed.
- `Harness(app).check(name, version, snapshots, args=None, params=None)` takes `{source: [items]}`, such as `{"dev.acme.directory/users@1": [...]}`, and returns the outcome dict.
- An error answer raises `HarnessError`, with `.kind` and the raw `.error`.

`secrets` replaces the whole environment for the call, so tests see exactly what the host would pass.

`Cassette(path, mode="replay", transport=None)` is an HTTP transport. Assign it to `app.transport`. In `record` mode it sends real requests and writes `{"interactions": [...]}` with `method`, `url`, `status`, `headers`, `body`, and `body_sha256` for requests with a body. Request headers are never stored; `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, and `Proxy-Authorization` response headers are dropped; and query values for `access_token`, `token`, `api_key`, `apikey`, `key`, `client_secret`, and `code` become `SCRUBBED`. In `replay` mode it matches method, scrubbed URL, and body hash in recorded order, and raises `CassetteMiss` when nothing matches. Hand-written entries may omit `body_sha256` to match any body; `ogrl-github`'s cassettes are written by hand from GitHub's documented response shapes.

## CLI

`ogrl-integration <command>`:

| Command | What it does |
|---|---|
| `new DIR --id ID --name NAME` | Scaffolds a package with one resource, one check, a cassette, and passing tests. |
| `run PKG validate` | Runs `connection.validate` in process. |
| `run PKG collect NAME@MAJOR [--out FILE] [--query FILE]` | Collects a resource, or a query source defined in a YAML file. Writes JSON Lines to `--out` or stdout and a count to stderr. |
| `run PKG check NAME@MAJOR --snapshot SOURCE=PATH [--arg K=V]` | Runs a check. Snapshot files may be a snapshot document, a JSON list, or JSON Lines. |
| `test PKG` | Runs the conformance suite and prints `PASS`/`FAIL` per finding. Exits 1 on any failure. |
| `pack PKG [--out dist] [--force]` | Runs conformance, then writes `<id>-<version>.tar.gz` and prints its SHA-256. `--force` packs despite failures. |
| `openapi build PKG` / `openapi search PKG TEXT` | Writes `_ogrl_openapi.py`; searches read operations by id, path, or summary. |
| `smithy build PKG` / `smithy search PKG TEXT [--limit N]` | Writes `_ogrl_smithy.py`; searches queryable operations. |
| `smithy describe PKG SERVICE.Operation` | Prints parameters, item fields, pagination, and why an operation is not queryable. |
| `smithy validate PKG QUERY.yaml` | Validates a query definition and prints the derived item schema. |

`run` accepts `--config KEY=VALUE` (repeatable) and `--record CASSETTE` or `--replay CASSETTE`. Credentials come from the environment, limited to the manifest's `fields` names, `OGRL_ACCESS_TOKEN`, and the `AWS_*` variables.

**Conformance** checks that the manifest loads; `id`, `version`, `protocol`, and `runtime.kind` are valid; there is at least one auth kind; every resource schema is a valid object schema declaring `id` and `name`; checks read only declared resources and templates only this integration; the entrypoint imports and `Integration(id, version)` matches the manifest; the implemented resources and checks equal the manifest's; and every check survives empty snapshots. It then starts the entrypoint as the host would (working directory `/`, no `HOME`, `PYTHONDONTWRITEBYTECODE=1`) and verifies that stdout carries only JSON lines, `initialize` answers the manifest's id and version, unknown methods answer an error with a `kind`, and the process exits within 10 s of stdin closing.

**Pack** output is deterministic: entries are sorted with zeroed timestamps and owners, and the archive contains `manifest.yaml`, `schemas/`, every `.py` file, the OpenAPI description or trimmed Smithy models, any `wheels/*.whl`, and a pure-Python wheel of the SDK itself. Signing is not implemented. To install the archive, see [Integrations](/docs/integrations/).

## End-to-end example

`manifest.yaml`:

```yaml
id: dev.acme.directory
name: Acme Directory
version: 0.1.0
protocol: 1
publisher: acme
description: Users from Acme Directory.
runtime:
  kind: python
  entrypoint: directory_integration:app.run
egress: [api.acme.example]
config:
  - name: base_url
    label: API base URL
    pattern: "^https://"
auth:
  - kind: fields
    label: API token
    fields:
      - name: ACME_TOKEN
        label: Read-only API token
resources:
  - name: users
    version: 1
    schema: schemas/users.json
checks:
  - name: all-mfa
    version: 1
    sources: [users]
templates: []
```

`schemas/users.json`:

```json
{
  "type": "object",
  "required": ["id", "name"],
  "properties": {
    "id": {"type": "string"},
    "name": {"type": "string"},
    "mfa": {"type": "boolean"}
  }
}
```

`directory_integration.py`:

```python
from ogrl_integration import Integration, Subject, fail, pass_

app = Integration("dev.acme.directory", "0.1.0")


def _auth(ctx):
    return {"Authorization": f"Bearer {ctx.secret('ACME_TOKEN')}"}


@app.validate
def validate(ctx):
    me = ctx.http.get(f"{ctx.config['base_url']}/me", headers=_auth(ctx)).json()
    return ctx.identity(f"{ctx.config['base_url']} as {me['name']}", scopes=me.get("scopes", []))


@app.resource("users", version=1)
def users(ctx):
    for user in ctx.http.paginate(
        f"{ctx.config['base_url']}/users",
        headers=_auth(ctx),
        items=lambda r: r.json()["users"],
        next_url=lambda r: r.json().get("next"),
    ):
        yield {"id": user["id"], "name": user["email"], "mfa": user.get("mfa", False)}


@app.check("all-mfa", version=1)
def all_mfa(ctx, users):
    missing = [u for u in users if not u.get("mfa")]
    if missing:
        return fail(
            f"{len(missing)} of {len(users)} users lack MFA",
            [Subject.account(u["name"], u["id"]) for u in missing],
        )
    return pass_(f"{len(users)} users have MFA")
```

`tests/test_directory_integration.py`:

```python
from pathlib import Path

from ogrl_integration.testing import Cassette, Harness
from directory_integration import app

CASSETTES = Path(__file__).parent / "cassettes"


def test_collects_users():
    app.transport = Cassette(CASSETTES / "users.json")
    result = Harness(app).collect("users", 1, {"base_url": "https://api.acme.example"}, {"ACME_TOKEN": "t"})
    assert result.complete and result.items[0]["id"] == "u1"


def test_check_names_users_without_mfa():
    bob = {"id": "u2", "name": "bob@acme.example", "mfa": False}
    out = Harness(app).check("all-mfa", 1, {"dev.acme.directory/users@1": [bob]})
    assert out["outcome"] == "fail"
    assert out["subjects"] == [{"kind": "account", "name": "bob@acme.example", "external_id": "u2"}]
```

Record a cassette once against the real API, then work offline:

```bash
export ACME_TOKEN=...
ogrl-integration run . collect users@1 --config base_url=https://api.acme.example \
  --record tests/cassettes/users.json --out users.jsonl
ogrl-integration run . check all-mfa@1 --snapshot dev.acme.directory/users@1=users.jsonl
PYTHONPATH=. pytest
ogrl-integration test .
ogrl-integration pack . --out dist/
```
