# Live evidence: integrations, query sources, and tests

| Field | Value |
|---|---|
| Repository | [adversitydotdev/fathom](https://github.com/adversitydotdev/fathom) |
| Specified by | [RFC 0005](/rfcs/0005-integrations/), [RFC 0006](/rfcs/0006-query-sources/), [RFC 0007](/rfcs/0007-smithy-query-sources/), [RFC 0001 §7.6](https://ogrl.adversity.dev/rfcs/0001-object-model/) |
| Audience | People who connect vendors, write tests, and read results |

An OGRL control is met when its tests pass. With integrations, a test can read the vendor's real configuration: who has MFA in Okta, which S3 buckets are encrypted, which security groups are open to the internet. This guide explains how the pieces connect, what happens when a test runs, how to collect data no integration collects yet with query sources, and how to write the rules that score it. [First-party integrations](/docs/integrations/) covers installing and setting up each vendor, and the [Integration SDK](/docs/integration-sdk/) covers building your own.

## The big picture

<!-- figure: evidence-pipeline -->

Nine things take part. Only the first two come from the vendor side; everything a test reads arrives as a snapshot.

| Piece | What it is | Example |
|---|---|---|
| Integration | An installed package: what it can collect, its test templates, and for query sources the vendor's API model. | `dev.adversity.aws` 0.3.0 |
| Connection | One vendor account: non-secret config, write-only secrets, and its bindings. | "AWS production", role `arn:aws:iam::…:role/ogrl-readonly` |
| Binding | A connection's link to the components or systems that account serves. | "AWS production" → component "AWS prod" |
| Source | A name for a kind of data: `<integration>/<name>@<version>`. A built-in **resource** from the package, or a **query source** you define. | `dev.adversity.aws/iam-users@1`, `dev.adversity.aws/s3-encryption@1` |
| Snapshot | The items of one source from one connection at one moment, stored with its digest. It is the evidence. | 3 buckets, collected 06:01 UTC |
| Test | An OGRL `test` with a `run` block naming a source and a rule. Templates are ready-made tests. | "Every S3 bucket is encrypted" |
| Implementation | A control applied to a component or a system. Tests run against implementations. | CR-01 on system "Acme Platform" |
| Result | One run's outcome (`pass`, `fail`, or `error`), its failing items, and its evidence. | `fail`: "2 of 3 selected items pass" |
| Control status | Computed from results by the kernel ([RFC 0001 §8](https://ogrl.adversity.dev/rfcs/0001-object-model/)). | `gap` until the bucket is fixed |

The test never names a connection. It names a source, and the implementation it runs against decides whose data that source means. The same test can run against your production and staging accounts and give two results.

## Connections and bindings

A connection is bound to one or more components or systems. When a test runs against an implementation, Fathom reads the connections bound to the implementation's scope:

- An implementation on a **component** reads connections bound to that component.
- An implementation on a **system** reads connections bound to the system **and** to each of its components.
- Disabled connections are never read.
- Of those, only connections of the source's integration count. A test reading `dev.adversity.aws/…` ignores the Okta connection.

<!-- figure: bindings -->

When several connections match, the test reads all of them and their items are combined in binding order, so one rule covers both AWS accounts. When none match, the result is `error`: "no connection of dev.adversity.aws is bound to system--acme-platform".

Bind a connection when you create it (**Integrations → New connection → Bound to**), or with `bindings` on `POST /v1/connections`:

```json
{
  "integration_id": "dev.adversity.aws",
  "name": "AWS production",
  "config": {"region": "us-east-2", "regions": "us-east-1,us-east-2,eu-west-1",
             "aws_role_arn": "arn:aws:iam::123456789012:role/ogrl-readonly"},
  "auth_kind": "aws_role",
  "bindings": ["component--aws-prod"]
}
```

## What happens when a test runs

<!-- figure: test-run -->

1. **Find connections.** As above, per source the test reads.
2. **Pick a snapshot.** Fathom uses the connection's newest complete snapshot of the source if it is fresh: newer than the test interval's window (one day for `daily`, seven for `weekly`, and so on) and newer than `FATHOM_SNAPSHOT_REUSE` (one hour by default). Otherwise it collects one now. For a query source, collecting runs the saved definition.
3. **Check it.** An incomplete snapshot (a rate limit partway through, a region the account cannot read) or one whose stored bytes no longer match their digest makes the result `error`. A test never passes on partial data.
4. **Evaluate.** The rule's `select` chooses items, `assert` must hold for each selected item, and `aggregate` must hold across them ([Writing rules](#writing-rules)).
5. **Record.** The result gets the outcome, a summary, one subject per failing item, the time the oldest snapshot was observed, and every snapshot used as evidence.

**Run** on a test, or `POST /v1/tests/{id}/runs` with an `implementation_id`, runs it now. The scheduler does the same on its own ([Scheduling](#scheduling)).

```bash
curl -X POST "$FATHOM_API/v1/tests/test--s3-encrypted/runs" \
  -H "Authorization: Bearer $FATHOM_TOKEN" -H "Content-Type: application/json" \
  -d '{"implementation_id": "implementation--cr-01-acme-platform"}'
# 202 Accepted: a job with "result_id"; then GET /v1/results/{result_id}
```

```json
{
  "outcome": "fail",
  "summary": "2 of 3 selected items pass",
  "observed": "2026-11-22T06:01:12Z",
  "subjects": [{"kind": "s3-encryption", "name": "acme-logs", "external_id": "arn:aws:s3:::acme-logs"}],
  "evidence_refs": ["evidence--…"]
}
```

## Sources: resources and query sources

A **resource** is written in the integration's code and ships with it, such as Okta `users@1` with each user's MFA factors already worked out. A **query source** is defined by your organization over the vendor's own API description, without code: one read operation, its parameters, and the fields to keep. Okta query sources use Okta's OpenAPI description ([RFC 0006](/rfcs/0006-query-sources/)); AWS query sources use AWS's Smithy models ([RFC 0007](/rfcs/0007-smithy-query-sources/)).

To a test, the two are the same: both are sources, collected into snapshots, validated against an item schema, and read by rules. Use a resource when one exists. Use a query source for the long tail: password policies, application sign-on modes, security groups, bucket encryption, anything the API documents.

### Anatomy of a query source

<!-- figure: query-anatomy -->

| Field | Required | Meaning |
|---|---|---|
| `integration` | Yes | The installed integration whose API model the query uses. |
| `name`, `version` | Yes | Together the source name: `dev.adversity.aws/internet-open-groups@1`. |
| `operation` | Yes | An `operationId` (OpenAPI) or `<service>.<Operation>` (AWS). Only reads: `GET`, or for AWS a `List`, `Describe`, or `Get` operation the integration does not deny. |
| `params` | No | Request parameters as strings. AWS list and structure parameters take JSON text. |
| `items` | No | Where the list is in the response. Usually inferred; for AWS operations that return one result, leave it empty and the response is one item. |
| `fields` | Yes | Output field name to the dotted path it reads in each item. `id` and `name` are required; they name failing items. |
| `regions` | AWS | Region codes, or `"*"` for the connection's `regions` config. Each item gains `region`. Global services (IAM) take none. |
| `for_each` | No | One call per item another operation lists ([Per-item calls](#per-item-calls)). |

Paths reach into nested objects with dots (`settings.password.complexity.minLength`). Three paths are reserved:

| Path | Means | Use |
|---|---|---|
| `.` | The item itself | Lists of plain values, such as GuardDuty detector IDs. |
| `$region` | The region being collected (AWS) | Naming the one item of a per-region setting: `id: $region`. |
| `$parent.<path>` | The listed item, under `for_each` | The bucket name beside its encryption settings. |

### Examples

Okta password policies, over the Okta management API:

```yaml
integration: dev.adversity.okta
name: password-policies
version: 1
operation: listPolicies
params: {type: PASSWORD}
fields:
  id: id
  name: name
  status: status
  min_length: settings.password.complexity.minLength
  max_age_days: settings.password.age.maxAgeDays
```

AWS security groups open to the internet, in every connected region:

```yaml
integration: dev.adversity.aws
name: internet-open-groups
version: 1
operation: ec2.DescribeSecurityGroups
regions: "*"
params:
  Filters: '[{"Name": "ip-permission.cidr", "Values": ["0.0.0.0/0"]}]'
fields: {id: GroupId, name: GroupName, vpc: VpcId, rules: IpPermissions}
```

EBS encryption by default, which AWS reports as one setting per region:

```yaml
integration: dev.adversity.aws
name: ebs-default-encryption
version: 1
operation: ec2.GetEbsEncryptionByDefault
regions: "*"
fields: {id: $region, name: $region, enabled: EbsEncryptionByDefault}
```

### Per-item calls

Some settings are read one resource at a time: each bucket's encryption, each group's members. `for_each` runs a list operation first, then calls `operation` once per listed item.

<!-- figure: for-each -->

```yaml
integration: dev.adversity.aws
name: s3-encryption
version: 1
operation: s3.GetBucketEncryption
regions: "*"
for_each:
  operation: s3.ListBuckets
  params: {BucketRegion: $region}     # buckets homed in the region being collected
  bind: {Bucket: Name}                # GetBucketEncryption's Bucket ← each listed bucket's Name
fields:
  id: $parent.BucketArn
  name: $parent.Name
  rules: ServerSideEncryptionConfiguration.Rules
```

The same shape works for Okta:

```yaml
integration: dev.adversity.okta
name: group-members
version: 1
operation: listGroupUsers
for_each: {operation: listGroups, bind: {groupId: id}}
fields: {id: id, name: profile.login, status: status, group: $parent.profile.name}
```

How `for_each` behaves:

- **Errors.** Items of a `for_each` query always have an `error` field. It is null when the call worked and holds the vendor's error code when the call failed with a client error, such as `ServerSideEncryptionConfigurationNotFoundError` for a bucket with no encryption configuration or Okta's `E0000007` for a missing group. A missing configuration then fails your rule instead of failing the collection. Authentication, permission, and rate-limit errors still fail the collection.
- **Unsafe values.** A bound path parameter whose value contains `/` (or is `.` or `..`) is refused for that item with `InvalidParentValue`; it never reaches a URL.
- **Limit.** `limit` caps the listed items (default 1000, at most 5000). More makes the collection incomplete.

### Versions are fixed

A saved `(integration, name, version)` never changes, because changing a filter changes what earlier evidence meant. To change a query, save it as version 2 and point the test at `…@2`. Version 1 stays usable while tests read it, and cannot be deleted until no unrevoked test does. Every snapshot also records the definition it was collected with, so an auditor sees what was asked and what came back.

Query sources are exported with the organization's Git snapshot as `fathom-app/queries/<integration>/<name>@<version>.yaml` and restored before the objects that read them.

## Writing and checking a query source

<!-- figure: authoring-loop -->

Every step reports problems as `{pointer, detail}`, with a JSON pointer into the definition, so you fix the exact field and try again.

| Step | Route | Calls the vendor | What you learn |
|---|---|---|---|
| Search | `GET /v1/integrations/{id}/operations?q=security groups` | No | Read operations matching the words. |
| Describe | `GET /v1/integrations/{id}/operations/{operation}` | No | Parameters, where the list is, and every item field path with its type. For AWS, whether it is regional and why an operation cannot be queried. |
| Validate | `POST /v1/queries/validate` | No | Problems, and the derived item schema. |
| Dry run | `POST /v1/queries/dry-run` with a `connection_id` | Yes, a sample | Up to `max_items` (default 50) projected items, nothing stored. Warns about fields empty in every item, which usually means a wrong path. |
| Preview a rule | `POST /v1/rules/preview` with the dry run's `items` and the unsaved `query` | No | The outcome the rule would give. |
| Save | `POST /v1/queries` | No | The saved definition. Refused if the version exists. |

Typical feedback:

```json
[
  {"pointer": "/fields/id", "detail": "items have no 'GroupID'; did you mean 'GroupId' or 'GroupName'?"},
  {"pointer": "/params/Filters", "detail": "Filters[0] has no member 'Nam'; did you mean 'Name'?"},
  {"pointer": "/regions", "detail": "ec2 is regional: list regions, or \"*\""},
  {"pointer": "/operation", "detail": "iam.CreateRole is not a read: it lacks @readonly and does not start with List, Describe, or Get"},
  {"pointer": "/for_each/bind/Bucket", "detail": "items have no 'Nmae'; did you mean 'Name'?"}
]
```

### In the UI

On **Integrations**, every integration with an API model has **Query sources** and **Define a query**:

<!-- screenshot: query-source | Defining an AWS Smithy query source (ec2.DescribeSecurityGroups) with schema validation and a live dry-run sample table. -->

1. **Operation.** Search, then **Use** an operation. AWS operations show their protocol and whether they are regional.
2. **Name, version, parameters.** One input per parameter; AWS list and structure parameters take JSON. **Regions** appears for regional AWS operations, defaulting to `*`.
3. **For each listed item** (optional). Search the list operation, set its parameters and where its list is, and fill **Each listed item fills** with the parameter and the path it comes from.
4. **Fields to keep.** Click the operation's **Item fields** (or **Listed item fields** for `$parent.` paths) to fill the focused row or add one.
5. **Validate**, then **Run sample** through a connection. Problems appear under the field they belong to.
6. **Save query source.** It appears on the integration card, and as `<name>@<version> (query)` among the rule editor's sources.

### With the assistant

The assistant has the same steps as tools: `list_integrations`, `search_operations`, `describe_operation`, `validate_query`, `dry_run_query`, `preview_rule`, and `propose_query_source`. Ask it for a test ("check that no security group is open to the internet"); it searches, drafts, reads the validation feedback, fixes its paths, samples through a connection, and previews the rule. It cannot save: saving a query source or a test with a `run` block needs `tests:define-run`, which agents never hold. Its proposal opens **New query source** prefilled, with the suggested rule; you check it, sample it, and save it.

### Permissions

| Action | Permission |
|---|---|
| Search and describe operations, list query sources | `programs:read` |
| Validate, dry run, preview a rule | `tests:write` (agents included) |
| Save or delete a query source, save a test with a `run` block | `tests:define-run` (people only) |
| Collect a connection by hand | `collections:run` |

## Writing rules

A rule test's `run` block names one source and up to four CEL expressions ([RFC 0001 §7.6](https://ogrl.adversity.dev/rfcs/0001-object-model/)):

<!-- screenshot: rule-editor | Writing a CEL rule test with clickable schema fields and live preview against the latest Okta snapshot. -->

| Field | Evaluated | Must give |
|---|---|---|
| `select` | Once per item, as `item` | `true` to keep the item. Omit to keep all. |
| `assert` | Once per selected item | `true`. Each `false` is a failing item and becomes a subject. |
| `aggregate` | Once, over the selected items as `items` | `true`. For conditions across items, such as "at least one trail logs every region". |
| `subject` | Once per failing item | A custom subject object. By default the subject is the item's `id` and `name`. |
| `allow_empty` | | `true` makes "nothing selected" a pass. Otherwise it is an `error`, which catches a missing permission or an empty account. |

A rule needs `assert`, `aggregate`, or both. Expressions also see `params` (the control's parameters, such as `params.rotation_period`), `observed` (when the oldest snapshot was collected), and `snapshot`. OGRL adds `days("90 days")`, `distinct`, `duplicates`, and `lowerAscii` to standard CEL.

The outcome is `pass` when no selected item fails and the aggregate holds, `fail` otherwise, and `error` when the rule cannot be evaluated or the data cannot be trusted. The summary reads like "2 of 3 selected items pass".

Every bucket encrypted, over the `for_each` query above:

```yaml
run:
  runner: rule
  source: dev.adversity.aws/s3-encryption@1
  assert: item.error == null && item.rules != null && size(item.rules) > 0
```

Password policies meet the control's minimum length, using a parameter:

```yaml
run:
  runner: rule
  source: dev.adversity.okta/password-policies@1
  select: item.status == "ACTIVE"
  assert: item.min_length >= int(params.min_length)
```

No active access key older than the rotation period:

```yaml
run:
  runner: rule
  source: dev.adversity.aws/iam-users@1
  select: item.oldest_active_key_rotated != null
  assert: observed - timestamp(item.oldest_active_key_rotated) <= days(params.rotation_period)
  allow_empty: true
```

At least one multi-region trail is logging:

```yaml
run:
  runner: rule
  source: dev.adversity.aws/trails@1
  aggregate: items.exists(t, t.logging && t.multi_region && t.log_file_validation)
  allow_empty: true
```

In the UI, **New rule test** on **Tests**, or **Write a rule** on an integration card, opens the rule editor. Clicking a field inserts `item.<field>`, and **Preview** runs the rule over the latest snapshot without recording anything, with misspelt fields flagged under the expression. Templates are tests the integration ships; **Enable** copies one into your organization as an ordinary test you can then edit.

An `integration` runner exists too, for checks that need code, such as merging two resources. It calls a check written in the package and reads its sources the same way.

## Scheduling

With `FATHOM_RUN_SCHEDULER=true`, every `FATHOM_INTEGRATION_TICK` seconds (default 300) the scheduler starts a run for each pair of test and implementation that is due:

- the test has a `rule` or `integration` run block and an `interval`;
- the implementation is of the test's control, not revoked, not a provider's, and within the test's `system_refs` when it lists any;
- a connection of every integration the test reads is bound to the implementation's scope;
- its latest result is older than the interval (less a two-hour margin; `continuous` means hourly).

A pair with no bound connection is skipped rather than recording errors every tick. The snapshot reuse window means several tests reading the same source share one collection.

## Worked example: every S3 bucket is encrypted

1. **Install and connect.** AWS 0.3.0 is installed (the compose stack does this). Create a connection with your read-only role, `regions` set, bound to the component your encryption control is implemented on, and add its external ID to the role's trust policy.
2. **Define the query.** Use the `s3-encryption` definition from [Per-item calls](#per-item-calls): **Define a query** on AWS, or:

   ```bash
   curl -X POST "$FATHOM_API/v1/queries/dry-run" -H "Authorization: Bearer $FATHOM_TOKEN" \
     -H "Content-Type: application/json" -d @s3-encryption.json   # plus "connection_id"
   curl -X POST "$FATHOM_API/v1/queries" -H "Authorization: Bearer $FATHOM_TOKEN" \
     -H "Content-Type: application/json" -d @s3-encryption.json
   ```

3. **Write the test.**

   The control is Encryption in Transit and at Rest: `control--ogrl-cr-01` in standard library v0.3.0 and later, `control--ogrl-sc-01` in v0.2.0.

   ```json
   {
     "name": "Every S3 bucket has default encryption",
     "control_ref": "control--ogrl-cr-01",
     "method": "automated",
     "interval": "daily",
     "run": {
       "runner": "rule",
       "source": "dev.adversity.aws/s3-encryption@1",
       "assert": "item.error == null && item.rules != null && size(item.rules) > 0"
     }
   }
   ```

4. **Run it.** **Run** on the test, or wait for the scheduler. The result names each failing bucket, and its evidence is the snapshot, which records both the buckets and the query that found them.
5. **Change it.** To also require KMS keys, save `s3-encryption@2` with a field for the algorithm, and update the test's `source`. Results already recorded keep pointing at version 1's evidence.

## Troubleshooting

| Result or message | Cause | Fix |
|---|---|---|
| `no connection of <integration> is bound to <scope>` | No enabled connection of that integration is bound to the implementation's component or system. | Bind one, or run the test against the implementation that has one. |
| `<source> from <connection> is incomplete: …` | The collection stopped early: a rate limit, a region the account cannot read, or more items than a `for_each` limit. | Read the reason. For regions, narrow the connection's `regions`; for limits, raise `limit`. |
| `no items selected from <source>` | `select` matched nothing, or the account has none. | Check `select`, or set `allow_empty: true` when empty is fine. |
| `permission_denied: … AccessDenied…` | The credential cannot read that API. For AWS, the role's policy or an organization SCP. | Grant the read to the role, or query another region. |
| Dry run warns `<field> is empty in all N items` | The path does not exist in real responses. | Compare with **Describe** and the sample, and fix the path. |
| `<source> exists; versions are immutable` | That version is saved. | Save the change as the next version. |
| `… is read by test--…; revoke those tests first` | Deleting a query source a test still reads. | Revoke or repoint the tests first. |
