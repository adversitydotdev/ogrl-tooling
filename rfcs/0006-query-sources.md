# RFC 0006: Query Sources

| Field | Value |
|---|---|
| Status | Draft |
| Spec version | 0.1.0 |
| Date | 2026-11-21 |
| Depends on | [RFC 0001](https://ogrl.adversity.dev/rfcs/0001-object-model/), [RFC 0003](0003-application.md), [RFC 0004](0004-http-api.md), [RFC 0005](0005-integrations.md) |
| AI assistance | Drafted and edited with AI tools; human review in progress (see [README](https://github.com/adversitydotdev/ogrl-tooling#ai-assistance)) |

RFC 0005 integrations collect a fixed set of resources, each written in code. This RFC lets an organization define more resources without code: a **query source** names one read operation from the vendor's OpenAPI description, its parameters, and the fields to keep. The integration still owns authentication, rate limits, retries, and pagination; the organization decides what to fetch. Tests read a query source exactly as they read a built-in resource, so rules, the runner, the scheduler, evidence, and the rule preview work unchanged. Open questions are in [Section 12](#12-open-questions).

## 1. Summary

Built-in resources stay. They are tested code, and some need more than one API call, such as Okta users with their factors or GitHub branch protection merged with rulesets. Query sources cover the long tail: any list endpoint the vendor documents, defined by the organization in a few lines, validated against the vendor's own API description before it ever runs.

```yaml
integration: dev.adversity.okta
name: active-apps
version: 1
description: Active applications and how users sign in to them.
operation: listApplications          # an operationId in the integration's bundled OpenAPI description
params:
  filter: 'status eq "ACTIVE"'
  limit: "200"
items: ""                            # where the list is in the response body; "" means the body is the list
fields:                              # output field: path in each response item
  id: id
  name: label
  sign_on_mode: signOnMode
  status: status
```

A rule test then reads `dev.adversity.okta/active-apps@1`:

```yaml
run:
  runner: rule
  source: dev.adversity.okta/active-apps@1
  assert: item.sign_on_mode in ["SAML_2_0", "OPENID_CONNECT"]
```

The design keeps three properties from RFC 0005:

- **Tests hold no credentials and make no vendor calls.** A query is collected into a snapshot like any resource; rules evaluate the snapshot.
- **Read-only by construction.** Only operations the description marks as reads can be queried, only against the integration's own host. The connection's read-only credential remains the backstop.
- **The snapshot is the evidence.** It records the definition it was collected with, so an auditor sees both what was asked and what came back.

## 2. Terms

| Term | Meaning |
|---|---|
| Query source | An organization-defined resource: one integration, a name, a version, an operation, parameters, an item path, and a field projection. |
| Description | The vendor's OpenAPI 3.x document, bundled in the integration package and pinned to the package version. |
| Operation | One `operationId` in the description. |
| Projection | The `fields` map: each output field and the dotted path it reads in a response item. |

## 3. The definition

| Field | Required | Meaning |
|---|---|---|
| `integration` | Yes | An installed integration whose manifest declares `openapi` ([Section 4](#4-integration-support)). |
| `name` | Yes | `[a-z0-9-]+`. Unique within the integration across query sources and the built-in resources of every installed version. |
| `version` | Yes | A positive integer. The source is `<integration>/<name>@<version>`, the RFC 0001 source grammar unchanged. |
| `description` | No | For people. |
| `operation` | Yes | An `operationId` in the description that is a read ([Section 5](#5-read-only-enforcement)) and returns a list. |
| `params` | No | Query and path parameters, as strings. Every required path parameter must be present. Headers and bodies cannot be set. |
| `items` | No | Dotted path to the list in the response body. Empty (the default) means the body is the list. |
| `for_each` | No | Per-item calls: `operation`, `params`, `items`, `bind`, `limit` (below). |
| `fields` | Yes | Output field name (`[a-z][a-z0-9_]*`) to a dotted path in each item, such as `profile.login`. Must include `id` and `name`, which the rule runner uses to name failing items (RFC 0001 section 7.6). |

**Item schema.** Fathom derives each query source's item schema from the description: the type at each projected path in the operation's response schema, nullable unless every schema level on the path marks it required. That schema validates collected items exactly as a built-in resource's schema does (RFC 0005 section 6), and lists the fields the rule editor shows.

**Versions are immutable.** Saving a definition with an existing `(integration, name, version)` and different content is refused. Changing a filter changes what the data means, so every edit is a new version. Older versions stay usable while tests read them, and a version cannot be removed while a non-revoked test reads it.

**Per-item calls.** Some settings are read one resource at a time, such as the members of each group. `for_each` runs a list operation first and calls `operation` once per item it returns:

```yaml
integration: dev.adversity.okta
name: admin-group-members
version: 1
operation: listGroupUsers
for_each:
  operation: listGroups               # a read operation that returns a list
  params: {search: 'profile.name sw "Admin"'}
  bind: {groupId: id}                 # operation parameter: path in each listed item
  limit: 1000                         # at most this many listed items (default 1000, at most 5000)
fields:
  id: id
  name: profile.login
  group: $parent.profile.name
```

- `for_each.operation` follows Section 5, and its `items` names its list as `items` does. `bind` names parameters of `operation`, which `params` may not also set; a bound path parameter whose value contains `/` or is `.` or `..` is refused for that item.
- Fields may read the listed item through `$parent.<path>`.
- A call that fails with a client error other than authentication, permission, or rate limiting yields one item with every field empty and `error` holding the vendor's error code (or `HTTP <status>`). Items of a `for_each` query always carry `error`, null on success. Any other failure fails the collection.
- More listed items than `limit` makes the collection incomplete.

There are no joins beyond this: a query source reads one operation, or one per listed item. Anything else stays a built-in resource.

## 4. Integration support

An integration opts in by declaring its description in the manifest:

```yaml
openapi:
  description: openapi/okta-management.yaml    # bundled in the package
  base_url: "https://{domain}"                 # config placeholders, as for OAuth URLs
  pagination: link                             # link | next-url:<path> | cursor:<response path>:<param> | none
  read_operations: []                          # non-GET operations that only read (such as POST searches)
  authorization: "SSWS {OKTA_API_TOKEN} | Bearer {OGRL_ACCESS_TOKEN}"
```

`authorization` names the header value per auth kind, with secrets and the OAuth token substituted from the operation's environment; the first alternative whose variables are all set is used. Integrations that need custom signing (AWS SigV4) do not support query sources in this revision.

The SDK provides the executor: given a validated query, it resolves the operation's method and path from the description, fills parameters, sends the request through the same HTTP client as built-in resources (retries, rate-limit resets, error mapping), follows the declared pagination, extracts `items`, projects `fields`, and streams the items. Integration authors write no code for it.

**Protocol.** `collect` (RFC 0005 section 7) gains an optional `query` parameter holding the definition's `operation`, `params`, `items`, and `fields`. When `query` is present, `resource` names the query source and `version` its version. An integration that does not declare `openapi` answers `invalid_config`.

## 5. Read-only enforcement

A query runs only if all of these hold. Fathom checks them when a definition is saved and before every collection; the SDK checks them again in the integration process, so a modified host cannot widen them.

1. The operation exists in the bundled description.
2. Its method is `GET`, or it is listed in `read_operations`.
3. The request goes to `base_url`'s scheme and host. Parameters fill the path template and query string only; they cannot change the host, add headers, or send a body.
4. Every required path parameter is set, path parameter values contain no `/`, and no parameter value exceeds 2 KB.

The connection's credential should itself be read-only; RFC 0005 section 9 still applies.

## 6. Validation feedback

Authors (people and agents, [Section 9](#9-drafting-with-an-assistant)) get errors at the exact field, in three steps that run in order and stop at the first failing one.

| Step | Route | Needs the vendor | Checks |
|---|---|---|---|
| Static | `POST /queries/validate` | No | Section 5 rules; operation returns a list at `items`; parameter names and types against the description; every `fields` path exists in the item schema; `id` and `name` present; name and version free. Returns the derived item schema. |
| Dry run | `POST /queries/dry-run` | Yes, a sample | Collects up to `max_items` (default 50) through a named connection, fetching pages lazily, without storing a snapshot; returns the projected items and warnings: a field empty in every item, items that do not match the derived schema. |
| Rule preview | `POST /rules/preview` | No | The existing preview, given the dry run's items inline instead of a stored snapshot. |

Every problem is `{pointer, detail}` with pointers into the definition (`/operation`, `/params/filter`, `/fields/name`) or the rule (`/run/assert`), the shape the rule preview already uses.

## 7. Collection, evidence, and status

A query source is collected, scheduled, bound, and selected exactly as a built-in resource (RFC 0005 sections 5 and 6, RFC 0001 section 7.6). The snapshot document carries one more member, `query`, holding the definition it was collected with; RFC 0001 permits members beyond its minimum. Status is unaffected: it reads results, and results do not know whether their source was built in or defined.

## 8. Storage, export, and portability

Query definitions are application records (like connections), not RFC 0001 objects, so the language and other OGRL tools are untouched. They are stored with their creator and time, listed through the API, and written by the Git export to `fathom-app/queries/<integration>/<name>@<version>.yaml` beside the organization's objects; restore reads them back before objects, so restored rule tests find their sources. A rule test that reads a query source is portable to another OGRL deployment that has the same integration and the exported definition.

## 9. Drafting with an assistant

The Fathom assistant ([RFC 0003 section 4](0003-application.md#4-agents)) gets tools over the same surface:

| Tool | Does |
|---|---|
| `search_operations(integration, text)` | Ranked read operations from the description: id, summary, path, parameters. |
| `describe_operation(integration, operation)` | Parameters and the item schema of the response, as flat dotted paths with types. |
| `validate_query(definition)` | Section 6 static step. |
| `dry_run_query(definition, connection)` | Section 6 dry run. |
| `preview_rule(run, items)` | The rule preview over dry-run items. |

Given a description of the test the person needs, the assistant searches, drafts a definition and a rule, and iterates on the feedback until both validate and the preview runs. It returns a **draft** into the editor. The RFC 0003 gates extend to query sources: an agent can call every tool above but cannot save a query definition or a test with a `run` block. A person reviews the draft, its dry-run items, and its preview, and saves it.

## 10. API

| Route | Purpose |
|---|---|
| `GET /integrations/{id}/operations?q=` | Search the integration's read operations. |
| `GET /integrations/{id}/operations/{operation}` | Parameters and the flattened item schema. |
| `POST /queries/validate` | Static validation. |
| `POST /queries/dry-run` | One page through a connection; no snapshot is stored. |
| `GET /queries`, `POST /queries`, `GET /queries/{id}` | Query definitions. Creating validates statically and refuses a taken `(integration, name, version)`. |
| `DELETE /queries/{id}` | Refused while a non-revoked test reads the source. |
| `POST /rules/preview` | Gains `items` (inline) as an alternative to stored snapshots. |

Permissions: reading needs `programs:read`; validating, dry runs, and previews need `tests:write`; saving and deleting need `tests:define-run`, because a saved query is executable on a schedule.

## 11. Delivery

| Step | Scope |
|---|---|
| 1 | SDK: `openapi` manifest block, description loading, the generic executor with Section 5 checks, protocol `query`. Okta bundles its management API description. |
| 2 | Fathom: query definitions, derived item schemas, static validation, dry run, collection through `query`, snapshot `query` member, export and restore. |
| 3 | Web: a query editor (operation search, parameters, field picker from the item schema, dry run) that feeds the rule editor. |
| 4 | The assistant's tools and drafting flow. |

## 12. Open questions

1. **Non-OpenAPI vendors.** AWS publishes Smithy models, not OpenAPI. [RFC 0007](0007-smithy-query-sources.md) specifies Smithy-backed query sources.
2. **GraphQL.** GitHub's GraphQL API reaches data its REST API does not. A GraphQL query source would replace `operation` with a query document validated against the schema; reads are enforced by refusing mutations.
3. **Description drift.** A new integration version may bundle a description in which an operation or field disappeared. The upgrade check (RFC 0005 section 4) should re-run static validation for every query source in use and refuse the upgrade, as it does for removed resources.
4. **Description size.** Vendor descriptions run to several megabytes (GitHub's is about 10 MB). They load from memory like the rest of the package, which stays well inside the archive cap, but the host may want to index operations once per package version rather than per request.
