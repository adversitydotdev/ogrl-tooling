# First-party integrations

| Field | Value |
|---|---|
| Repositories | [ogrl-okta](https://github.com/adversitydotdev/ogrl-okta), [ogrl-github](https://github.com/adversitydotdev/ogrl-github), [ogrl-aws](https://github.com/adversitydotdev/ogrl-aws) |
| Built with | [Integration SDK](/docs/integration-sdk/) |

adversity.dev publishes three integrations for Fathom: Okta (`dev.adversity.okta`), GitHub (`dev.adversity.github`), and AWS (`dev.adversity.aws`). Each is a Python package built on the Integration SDK that connects read-only to one vendor account, collects resources into evidence snapshots, and ships test templates that score those snapshots against OGRL controls. Okta and AWS also support query sources, so an organization can collect further vendor data without code. This page lists what each package connects to, the vendor-side setup its credentials need, the resources and templates it provides, and its current version.

## How integrations plug in

For how connections, query sources, and tests fit together, with diagrams and worked examples, see [Live evidence](/docs/live-evidence/).

Integrations follow [RFC 0005](/rfcs/0005-integrations/). A package is a gzipped tar archive holding `manifest.yaml`, one JSON Schema per resource, and the code ([section 3](/rfcs/0005-integrations/#3-integration-packages)). The application runs each operation (`connection.validate`, `collect`, `check`) in a separate process and talks to it over JSON-RPC on stdin and stdout.

| Integration | ID | Version | Auth kinds | Resources | Query sources |
|---|---|---|---|---|---|
| Okta | `dev.adversity.okta` | 0.1.4 | `fields`, `oauth2` | `users`, `groups` | OpenAPI ([RFC 0006](/rfcs/0006-query-sources/)) |
| GitHub | `dev.adversity.github` | 0.1.2 | `fields`, `oauth2` | `repositories`, `branch-rules`, `secret-scanning-alerts` | None |
| AWS | `dev.adversity.aws` | 0.3.0 | `aws_role` | `iam-users`, `trails` | Smithy ([RFC 0007](/rfcs/0007-smithy-query-sources/)) |

### Install

Each tagged release on GitHub carries the archive and its SHA-256 (`SHA256SUMS`). Install it through the API with the archive URL and digest; the install runs as a job ([section 4](/rfcs/0005-integrations/#4-installing-and-trust)).

```bash
curl -X POST "$FATHOM_API/v1/integrations" \
  -H "Authorization: Bearer $FATHOM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com/adversitydotdev/ogrl-okta/releases/download/v0.1.4/dev.adversity.okta-0.1.4.tar.gz",
    "digest": "d6d6a16eed701c58d2dc6bcabeb51c81ca1220515a7afbe295c79424802e8a95",
    "enable": true
  }'
```

Releases are unsigned until Sigstore verification ships with the registry, so every archive installs in the `local` trust tier and the server must run with `FATHOM_ALLOW_LOCAL_INTEGRATIONS=true`.

- **Compose stack.** `compose.yaml` in the Fathom repository sets `FATHOM_ALLOW_LOCAL_INTEGRATIONS=true`, and its seeder installs and enables the Okta 0.1.4, AWS 0.3.0, and GitHub 0.1.2 releases, pinned to their published digests. Set `FATHOM_SEED_INTEGRATIONS=false` on the seeder to skip this.
- **Directory packages.** `FATHOM_INTEGRATIONS_DIR` points at a directory of unpacked packages, such as a checkout of one of these repositories. These are also local-tier packages and load only with `FATHOM_ALLOW_LOCAL_INTEGRATIONS=true`; otherwise the server logs a warning and ignores the directory.

Only one version of an integration is enabled at a time. See [Self-hosting](/docs/self-hosting/) for the rest of the server configuration.

### Connect

A connection links an installed integration to one vendor account ([section 5](/rfcs/0005-integrations/#5-connections)). It holds non-secret `config` values matching the manifest's `config` entries, the `auth_kind` in use, and `bindings` to the components or systems that the account serves.

1. `POST /v1/connections` with `integration_id`, `name`, `config`, `auth_kind`, and `bindings`.
2. Provide credentials:
   - `fields`: `PUT /v1/connections/{id}/secrets/{NAME}` with `{"value": "..."}` for each field. The endpoint is write-only, and values are never returned.
   - `oauth2`: register your own OAuth application with the vendor, using the callback `${FATHOM_PUBLIC_URL}/v1/oauth/callback`. Store its credentials as the secrets `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET`, then `POST /v1/connections/{id}/oauth/start`. OAuth requires `FATHOM_PUBLIC_URL`.
   - `aws_role`: set `config.aws_role_arn`. The connection returns an `external_id` that the role's trust policy must require.
3. `POST /v1/connections/{id}/validate` makes the cheapest authenticated call and records the vendor identity, such as `acme.okta.com as svc-fathom`.

### Collect snapshots

The scheduler collects each resource that an enabled test reads, for every bound connection, whenever the newest snapshot is older than `FATHOM_SNAPSHOT_REUSE` (default 3600 seconds). `POST /v1/connections/{id}/collections` starts a collection by hand. The harness validates every item against the resource's JSON Schema, drops undeclared properties, and stores the result as an RFC 0001 snapshot ([section 6](/rfcs/0005-integrations/#6-collection)). A collection that stops early, for example on a rate limit partway through, is stored with `complete: false`, and no test evaluates it.

### Checks and templates

A template is a ready-made OGRL `test`. Enabling one copies it into the organization as an ordinary test ([section 8](/rfcs/0005-integrations/#8-checks-and-templates)). Templates use one of two runners:

- `runner: rule`: a CEL `select`/`assert` (or `aggregate`) evaluated in process over a resource snapshot. Failing items become subjects through their `id` and `name`.
- `runner: integration`: calls a check written in the package's code through the `check` operation. Checks receive snapshots and arguments but no credentials.

Sources are referenced as `<integration id>/<resource>@<major>`, for example `dev.adversity.okta/users@1` ([RFC 0001](https://ogrl.adversity.dev/rfcs/0001-object-model/)).

### Query sources

An integration whose manifest declares an `openapi` block ([RFC 0006](/rfcs/0006-query-sources/#4-integration-support)) or a `smithy` block ([RFC 0007](/rfcs/0007-smithy-query-sources/#2-integration-support)) also accepts query sources. A query source is an organization-defined resource that names one read operation from the bundled API description, its parameters, and the fields to keep. Only read operations can be queried ([RFC 0006 section 5](/rfcs/0006-query-sources/#5-read-only-enforcement), [RFC 0007 section 3](/rfcs/0007-smithy-query-sources/#3-what-is-a-read)).

## Okta

Collects workforce users, with their MFA factors and admin roles, and groups with their members, from one Okta org through the Okta management API.

| Field | Value |
|---|---|
| ID | `dev.adversity.okta` |
| Version | 0.1.4 (SDK `ogrl-integration` v0.1.0a12) |
| Runtime | `python`, entry point `okta_integration:app.run` |
| Egress | `*.okta.com`, `*.oktapreview.com`, `*.okta-emea.com` |
| Config | `domain`: the Okta domain, matching `^[a-z0-9-]+\.(okta\|oktapreview\|okta-emea)\.com$` (for example `acme.okta.com`) |

### Connection and vendor setup

The connection supports two auth kinds.

**`fields`: API token.** One secret, `OKTA_API_TOKEN`, described in the manifest as an "API token of a read-only admin". It is sent as `Authorization: SSWS <token>`. When both auth kinds are configured, the token takes precedence.

**`oauth2`: OAuth for Okta (API Services or Web app).** Register an app in your Okta org with redirect URI `${FATHOM_PUBLIC_URL}/v1/oauth/callback`, and grant it these scopes:

```text
okta.users.read
okta.groups.read
okta.factors.read
okta.roles.read
offline_access
```

The flow uses the org authorization server (`https://{domain}/oauth2/v1/authorize` and `/oauth2/v1/token`) with PKCE. The integration receives the refreshed access token and sends it as `Authorization: Bearer <token>`.

Validation calls `GET /api/v1/users/me` and reports the identity as `<domain> as <login>`. When Okta returns HTTP 429, the SDK backs off and honors `Retry-After`. A rate limit that hits partway through a collection keeps the items already read and marks the snapshot incomplete.

### Resources

| Resource | Description |
|---|---|
| `users@1` | One item per user from `/api/v1/users`, with its active factors from `/api/v1/users/{id}/factors`. Fields: `id`, `name` (login), `email`, `status`, `user_type`, `created`, `last_login`, `password_changed`, `admin`, `mfa_factors`, `mfa_enrolled`, `strong_mfa`, `phishing_resistant`. |
| `groups@1` | One item per group from `/api/v1/groups`. Fields: `id`, `name`, `description`, `group_type`, `members` (user IDs from `/api/v1/groups/{id}/users`). |

The derived fields on `users` mean:

- `admin`: the user appears in `/api/v1/iam/assignees/users`, so holds at least one admin role.
- `mfa_enrolled`: the user has any active factor other than `email` or `question`.
- `strong_mfa`: TOTP (`token:software:totp`), hardware or HOTP tokens (`token:hardware`, `token:hotp`, `token`), or any phishing-resistant factor.
- `phishing_resistant`: an active `webauthn`, `u2f`, or `signed_nonce` (Okta FastPass) factor.

### Checks and templates

| Name | Kind | Runner | Interval | What it tests |
|---|---|---|---|---|
| `admin-mfa-phishing-resistant@1` | Check | n/a | n/a | Every admin with status `ACTIVE`, `PASSWORD_EXPIRED`, `LOCKED_OUT`, or `RECOVERY` has `phishing_resistant`. Reads `users`. |
| `mfa-enforcement` | Template | `rule` | daily | Users with those same statuses must have `strong_mfa`. SMS, voice, email, and security questions do not count. |
| `admin-phishing-resistant` | Template | `integration` | daily | Runs `dev.adversity.okta/admin-mfa-phishing-resistant@1` over `users@1`. |

### Query sources

Supports OpenAPI query sources ([RFC 0006](/rfcs/0006-query-sources/)) over the bundled Okta Admin Management API description, release 2026.44.0 (`openapi/okta-management-2026.44.0.yaml`, Apache-2.0, from `okta/okta-management-openapi-spec`).

```yaml
openapi:
  description: openapi/okta-management-2026.44.0.yaml
  base_url: "https://{domain}"
  pagination: link
  read_operations: []
  authorization: "SSWS {OKTA_API_TOKEN} | Bearer {OGRL_ACCESS_TOKEN}"
```

`read_operations` is empty, so only `GET` operations can be queried. The package tests validate queries over `listApplications`, `listPolicies` (`type` `PASSWORD` and `OKTA_SIGN_ON`), `listGroups`, and `listGroupUsers` with `for_each` over `listGroups`. They also confirm that `deactivateUser` is refused. A sample definition:

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

The manifest's OAuth scopes cover only the built-in resources. A query over another API, such as applications or policies, needs a credential that can read that API.

## GitHub

Collects repositories, the effective rules on each default branch (classic branch protection and rulesets merged), and open secret scanning alerts from one GitHub organization through the REST API (`X-GitHub-Api-Version: 2022-11-28`).

| Field | Value |
|---|---|
| ID | `dev.adversity.github` |
| Version | 0.1.2 (SDK `ogrl-integration` v0.1.0a8) |
| Runtime | `python`, entry point `github_integration:app.run` |
| Egress | `api.github.com` |
| Config | `organization`: the organization login. `api_url` (optional, must start with `https://`): the API base for GitHub Enterprise Server. The default is `https://api.github.com`. |

`egress` lists only `api.github.com`. RFC 0005 records egress now and enforces it later.

### Connection and vendor setup

**`fields`: fine-grained personal access token.** One secret, `GITHUB_TOKEN`. Create the token with the organization as resource owner and these read-only permissions:

| Permission | Access | Used for |
|---|---|---|
| Metadata | Read | Listing repositories |
| Administration | Read | `/repos/{repo}/branches/{branch}/protection` (classic protection) |
| Secret scanning alerts | Read | `/orgs/{org}/secret-scanning/alerts` |

If Administration is missing, collection fails with `permission_denied` naming `administration:read`.

**`oauth2`: GitHub App (user-to-server, expiring tokens).** Create a GitHub App owned by the organization, set its callback URL to `${FATHOM_PUBLIC_URL}/v1/oauth/callback`, and give it the same three read permissions. The manifest requests no OAuth scopes (`scopes: []`), because GitHub App access comes from the app's permissions. Authorization uses `https://github.com/login/oauth/authorize` and `/login/oauth/access_token` with PKCE.

Validation calls `GET /user` and `GET /orgs/{organization}`, and reports `<organization> as <login>`. When the token's `X-OAuth-Scopes` include `repo`, `admin:org`, or `write:org`, validation warns that the token has write scopes and Fathom needs only read access.

### Resources

| Resource | Description |
|---|---|
| `repositories@1` | Every repository in the organization (`/orgs/{org}/repos?type=all`). Fields: `id`, `name` (`owner/repo`), `private`, `visibility`, `archived`, `fork`, `default_branch`, `pushed_at`, `topics`. |
| `branch-rules@1` | One item per non-archived repository's default branch. Merges classic protection with every ruleset that applies (`/rules/branches/{branch}`). Fields: `id` (repository ID), `name` (`owner/repo:branch`), `repository`, `branch`, `protected`, `required_approvals`, `dismiss_stale_reviews`, `code_owner_review`, `status_checks`, `strict_status_checks`, `force_push_blocked`, `deletion_blocked`, `enforce_admins` (classic only, otherwise null), `sources` (`classic` or `ruleset:<id>`). |
| `secret-scanning-alerts@1` | Open alerts from `/orgs/{org}/secret-scanning/alerts?state=open`. Fields: `id` (`owner/repo#number`), `name`, `state`, `secret_type`, `repository`, `created`, `validity`, `url`. A 404 fails the collection: secret scanning is not enabled, or the token cannot read alerts. |

When classic protection and rulesets overlap, the stricter setting wins. Required approvals take the maximum, the boolean settings are OR-ed, and the status check sets are combined.

### Checks and templates

| Name | Kind | Runner | Interval | What it tests |
|---|---|---|---|---|
| `branch-protection@1` | Check | n/a | n/a | For each repository that is not archived, not a fork, and has a default branch: at least `min_approvals` approvals (default `1`), required status checks when `require_status_checks` is `true` (the default), and force pushes blocked. Reads `repositories` and `branch-rules`. |
| `change-control` | Template | `integration` | daily | Runs `branch-protection@1` with `min_approvals: "1"` and `require_status_checks: "true"`. |
| `secret-leaks` | Template | `rule` | weekly | Fails on every open secret scanning alert (`select: item.state == "open"`, `assert: "false"`, `allow_empty: true`). |

### Query sources

Not supported. The manifest declares no `openapi` block.

## AWS

Collects IAM users and their credentials from the IAM credential report, and CloudTrail trails with their logging status, through a read-only role that the application assumes. Requests are SigV4-signed by the SDK.

| Field | Value |
|---|---|
| ID | `dev.adversity.aws` |
| Version | 0.3.0 (SDK `ogrl-integration` v0.1.0a11) |
| Runtime | `python`, entry point `aws_integration:app.run` |
| Egress | `iam.amazonaws.com` and `sts`, `cloudtrail`, `ec2`, `rds`, `kms`, `guardduty`, `s3` at `<service>.*.amazonaws.com` |
| Config | `region`: the region for CloudTrail and STS (required). `regions` (optional): a comma-separated list of the regions that query sources with `regions: "*"` read. It defaults to `region`. The connection also carries `aws_role_arn`. |

### Connection and vendor setup

**`aws_role`: read-only IAM role (SecurityAudit, plus `iam:GenerateCredentialReport`).** The application calls `sts:AssumeRole` on `aws_role_arn` before each operation. It uses the connection's `external_id`, a one-hour session, and a session name of the form `fathom-<connection>`. The integration receives only the resulting short-lived keys.

In the target account, create a role that:

1. Trusts the identity Fathom runs as and requires the connection's external ID. In the CloudFormation deployment, that identity is the task role. In the compose stack, it is whatever identity the `AWS_*` variables held when compose started.
2. Has the AWS-managed `SecurityAudit` policy and permission for `iam:GenerateCredentialReport`.
3. Is tagged `ogrl-integration=true`. The CloudFormation task role may assume only roles with this tag.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"AWS": "arn:aws:iam::<fathom-account-id>:role/<fathom-task-role>"},
    "Action": "sts:AssumeRole",
    "Condition": {"StringEquals": {"sts:ExternalId": "<connection external_id>"}}
  }]
}
```

```bash
aws iam create-role --role-name ogrl-readonly \
  --assume-role-policy-document file://trust.json \
  --tags Key=ogrl-integration,Value=true
aws iam attach-role-policy --role-name ogrl-readonly \
  --policy-arn arn:aws:iam::aws:policy/SecurityAudit
aws iam put-role-policy --role-name ogrl-readonly --policy-name ogrl-credential-report \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"iam:GenerateCredentialReport","Resource":"*"}]}'
```

Validation calls STS `GetCallerIdentity` in `region` and reports `<account> as <assumed-role ARN>`.

### Resources

| Resource | Description |
|---|---|
| `iam-users@1` | One item per row of the IAM credential report, including the root user (`<root_account>`). Fields: `id` (ARN), `name`, `root`, `created`, `console_access`, `password_last_used`, `mfa_active`, `active_access_keys`, `oldest_active_key_rotated`, `access_key_last_used`. |
| `trails@1` | Trails from `DescribeTrails` (including shadow trails) in `region`, each with `GetTrailStatus` from its home region. Fields: `id` (ARN), `name`, `home_region`, `multi_region`, `organization_trail`, `global_service_events`, `logging`, `log_file_validation`, `s3_bucket`, `kms_encrypted`, `latest_delivery`, `latest_delivery_error`. |

The integration polls `GenerateCredentialReport` up to 15 times, 2 seconds apart. If the report is still not complete, the collection ends as incomplete. For root, `console_access` is true when the report shows `password_enabled` as `not_supported` or `true`. It is false when Organizations' centralized root access has removed root's credentials.

### Checks and templates

The package has no code checks (`checks: []`). Every template uses the `rule` runner.

| Template | Interval | What it tests |
|---|---|---|
| `console-mfa` | daily | Every user with `console_access`, root included, has `mfa_active`. |
| `access-key-age` | weekly | No active access key is older than the control parameter `rotation_period`, which is 90 days in the standard library. |
| `root-access-keys` | daily | The root user has `active_access_keys == 0`. |
| `audit-logging` | daily | At least one trail is `logging`, `multi_region`, and has `log_file_validation` (an `aggregate` rule). Bucket retention is not checked. |

### Query sources

Supports Smithy query sources ([RFC 0007](/rfcs/0007-smithy-query-sources/)) over the unmodified models from `aws/api-models-aws` (Apache-2.0), bundled in `models/`. `ogrl-integration pack` trims them to their queryable operations when it builds the release.

| Service | Model | Endpoint |
|---|---|---|
| `iam` | `iam-2010-05-08` | `https://iam.amazonaws.com` (global, signs for `us-east-1`) |
| `ec2` | `ec2-2016-11-15` | `https://ec2.{region}.amazonaws.com` |
| `rds` | `rds-2014-10-31` | `https://rds.{region}.amazonaws.com` |
| `kms` | `kms-2014-11-01` | `https://kms.{region}.amazonaws.com` |
| `cloudtrail` | `cloudtrail-2013-11-01` | `https://cloudtrail.{region}.amazonaws.com` |
| `guardduty` | `guardduty-2017-11-28` | `https://guardduty.{region}.amazonaws.com` |
| `s3` | `s3-2006-03-01` | `https://s3.{region}.amazonaws.com` (path-style; list buckets per region with `BucketRegion: $region`) |

`deny_operations` blocks reads that return content or secrets rather than configuration:

- EC2: `GetPasswordData`, console output and screenshots, UEFI data, and launch template, instance attribute, and Spot request reads that include user data.
- KMS: `GetParametersForImport`.
- CloudTrail: `GetQueryResults`.
- S3: object content, attributes, and annotations, plus object, version, multipart upload, and part listings.

The package tests validate queries for open security groups, EBS encryption by default, EBS volumes, RDS instances, KMS keys, GuardDuty detectors, CloudTrail trails, S3 buckets, IAM roles, and the IAM password policy. They also validate per-bucket S3 encryption and public access block, both using `for_each` over `s3.ListBuckets`. A sample definition:

```yaml
integration: dev.adversity.aws
name: rds-instances
version: 1
operation: rds.DescribeDBInstances
regions: "*"
fields:
  id: DbiResourceId
  name: DBInstanceIdentifier
  encrypted: StorageEncrypted
  public: PubliclyAccessible
  backup_days: BackupRetentionPeriod
```
