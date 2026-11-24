# Self-hosting Fathom

| Field | Value |
|---|---|
| Repository | [adversitydotdev/fathom](https://github.com/adversitydotdev/fathom) |
| Version | 0.1.0 |
| Stack | Python (FastAPI), PostgreSQL, Next.js |

Operator guide for the self-hosted Fathom application: one Python `fathom` server process (HTTP API, job worker, scheduler, agents) that is the sole writer to a PostgreSQL organization database, a Next.js web UI that talks to it only over HTTP, and S3-compatible object storage for evidence, document bodies, and rendered files. It covers the local Docker Compose stack, every environment variable the server reads, AI model settings, integrations, the library source, the AWS CloudFormation deployment with its cost figures, observability, and git snapshot export and restore.

<!-- screenshot: overview | Fathom program overview: control readiness, requirement coverage, open gaps, expiring evidence, and recent jobs. -->

## What runs

The application is specified in [RFC 0003](/rfcs/0003-application/). The HTTP contract is [RFC 0004](/rfcs/0004-http-api/).

| Component | Role |
|---|---|
| `fathom` server | FastAPI HTTP server, background job runner, scheduler, and agents. The only process that writes to Postgres. Console entry point `fathom` (`fathom.main:run`). |
| Web UI | Next.js. Reads and writes only through the HTTP API. Proxies `/v1` and `/health` to `FATHOM_API_ORIGIN` (default `http://127.0.0.1:8080`). |
| PostgreSQL | Organization database and auth tables. Schema changes ship as Alembic migrations; the server never migrates on startup. |
| Object storage | S3 on AWS, SeaweedFS S3 locally. Evidence blobs, policy and procedure bodies, rendered packages, and installed integration archives. Postgres stores only `resource.uri` and `resource.digest`. |

The image is built from the repository [Dockerfile](https://github.com/adversitydotdev/fathom/blob/main/Dockerfile): Python 3.13, the prebuilt `ogrl-rs` wheel (no Rust compiler needed), runs as user `fathom`, exposes `8080`, defaults `FATHOM_BIND=0.0.0.0:8080`, and health-checks `GET /health`. The web image builds from `web/Dockerfile`.

## Web UI tour

The web UI renders what the API returns and never computes control status on its own. Opening a control from the list displays its required tests, evidence freshness dates, and parameterized statement in a slide-over panel without leaving the table.

<!-- screenshot: controls-panel | Controls list with the slide-over detail panel showing required tests, evidence validity dates, and control parameters. -->

Framework requirements reflect the exact mapping rules from the library: partial mappings report `contribution` rather than claiming full coverage, and unmapped requirements stay visible.

<!-- screenshot: requirements | NIST SP 800-171 Revision 3 requirement coverage across covered, gap, contribution, and unmapped states. -->

Policies and procedures are authored in a rich-text editor backed by plain Markdown, storing the text and recording a SHA-256 digest on adoption.

<!-- screenshot: policy-editor | Rich-text policy editor backed by Markdown, linked controls, and SHA-256 adoption digests. -->

## Local quick start

The [compose.yaml](https://github.com/adversitydotdev/fathom/blob/main/compose.yaml) stack needs no AWS account.

```bash
docker compose up --build
open http://localhost:3000
```

Services, in start order:

| Service | What it does |
|---|---|
| `postgres` | Postgres 18, user/password/db `fathom`, port `5432`. |
| `s3` | SeaweedFS S3 on port `8333`, keys from [deploy/local/s3.json](https://github.com/adversitydotdev/fathom/blob/main/deploy/local/s3.json). |
| `s3-bucket` | Creates the private `fathom` bucket, as the CloudFormation stack does in production. |
| `migrate` | Runs `alembic upgrade head` against Postgres, then exits. |
| `api` | The `fathom` server on `http://localhost:8080`. Connection secrets persist in the `secrets` volume. |
| `seed` | [deploy/local/seed.py](https://github.com/adversitydotdev/fathom/blob/main/deploy/local/seed.py): pulls `ogrl-library` v0.2.0 and a starter organization, "Acme Platform", with NIST 800-171 r3 and SOC 2 programs. Installs the first-party Okta, AWS, and GitHub integration releases. Idempotent. |
| `web` | Next.js UI on `http://localhost:3000`. |

Boot an empty workspace instead of the seeded one:

```bash
FATHOM_SKIP_SEED=true docker compose up --build
```

The compose stack authenticates with a static administrator token, `fathom_pat_local_dev_admin` (actor `party--local-admin`), set through `FATHOM_API_TOKENS`. Do not reuse it outside local development.

AWS integration connections assume their read-only role with the `AWS_*` credentials present when compose starts. With an `aws login` session:

```bash
eval "$(aws configure export-credentials --format env)" && docker compose up -d api
```

To enable the AI assistant locally, export `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or the `FATHOM_AI_*` variables before `docker compose up`; compose passes them through to `api`.

### Running without containers

[RFC 0003 §9](/rfcs/0003-application/#9-production-topology) notes that local development needs no AWS: `fathom` runs as a single process against local Postgres. The package is managed with `uv`, and the commands match the ones compose runs:

```bash
uv sync
export FATHOM_DATABASE_URL=postgresql://fathom:fathom@localhost:5432/fathom
uv run alembic upgrade head
uv run fathom
```

With `FATHOM_DATABASE_URL` unset, the server logs a warning and keeps the organization database in memory. The web app runs from `web/` with `FATHOM_API_ORIGIN=http://127.0.0.1:8080 FATHOM_API_TOKEN=... pnpm dev`.

### mise tasks

[mise.toml](https://github.com/adversitydotdev/fathom/blob/main/mise.toml) defines verification tasks only, not run tasks. `mise run verify` is the repository's definition of done.

| Task | Runs |
|---|---|
| `verify:py` | `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest -q` |
| `verify:web` | In `web/`: `pnpm lint`, `pnpm typecheck`, `pnpm e2e` (Playwright against a mock-mode build) |
| `verify` | Both. Screenshots land in `web/e2e/.screenshots/`. |

```bash
mise run verify
```

## Configuration

The server reads its configuration from the environment. The module docstring of [fathom/main.py](https://github.com/adversitydotdev/fathom/blob/main/fathom/main.py) is the source of truth.

| Variable | Meaning |
|---|---|
| `FATHOM_PROCESS` | `api` (default) or `jobs`. See [Processes](#processes). |
| `FATHOM_BIND` | `host:port` to bind. Default `0.0.0.0:8080`; falls back to `PORT`. |
| `FATHOM_API_TOKENS` | JSON map of static tokens: `{"<token>": {"actor_id": "party--...", "roles": ["administrator"], "kind": "person"}}`. Tokens start with `fathom_pat_`. Only their SHA-256 is kept in memory. |
| `FATHOM_OIDC_PROVIDERS` | JSON map of OIDC providers: `{"okta": {"issuer": "...", "client_id": "...", "client_secret": "...", "redirect_uri": "..."}}`. |
| `FATHOM_BOOTSTRAP_ADMIN_EMAILS` | Comma-separated emails granted `administrator` on first OIDC login. |
| `FATHOM_ALLOWED_ORIGINS` | Comma-separated extra origins accepted by the cookie CSRF check. |
| `FATHOM_LIBRARY_REPO` | Git repository for the OGRL standard library. See [Library source](#library-source). |
| `FATHOM_DATABASE_URL` | Postgres URL (`postgresql://...`). If unset, assembled from `FATHOM_DATABASE_HOST`, `_PORT` (default `5432`), `_NAME` (default `fathom`), `_USER` (default `fathom`), `_PASSWORD`, `_SSLMODE`, which is how CloudFormation configures it. If neither is set, an ephemeral in-memory store is used. |
| `FATHOM_S3_BUCKET` | Bucket for evidence bytes, document bodies, and render files. |
| `FATHOM_S3_ENDPOINT` | Only for an S3-compatible server, such as the compose stack. |
| `FATHOM_S3_ACCESS_KEY_ID` / `FATHOM_S3_SECRET_ACCESS_KEY` | That server's keys. Separate from `AWS_*`, which stay free for the credentials that assume integration roles. |
| `FATHOM_S3_PREFIX` | Key prefix inside the bucket. Optional. |
| `FATHOM_BLOB_DIR` | A local directory instead of S3. With neither a bucket nor a directory, blobs are kept in memory. |
| `FATHOM_EXPORT_REMOTE` | Git remote for the snapshot. Unset: export is disabled. |
| `FATHOM_RUN_SCHEDULER` | `true` runs the export and integration schedules in this process. |
| `FATHOM_EXPORT_INTERVAL` | Seconds between scheduled exports. Default `86400`. |
| `FATHOM_INTEGRATION_TICK` | Seconds between scheduled integration test runs. Default `300`. Runs where `FATHOM_RUN_SCHEDULER=true`. |
| `FATHOM_PUBLIC_URL` | The deployment's stable origin, such as `https://grc.acme.com`. OAuth connections need it for `/v1/oauth/callback`. |
| `FATHOM_SNAPSHOT_REUSE` | Seconds a snapshot may be reused before a run collects again. Default `3600`. |
| `FATHOM_QUEUE_URL` | Optional SQS queue URL for job worker wakeups. |
| `FATHOM_SSM_PREFIX` | SSM Parameter Store prefix (for example `/fathom/fathom`) for secrets. |
| `FATHOM_HARNESS_USER` | Operating-system user the shell runner switches to. |
| `FATHOM_HARNESS_<NAME>` | The value of `run.env` name `<NAME>` for the harness. |
| `FATHOM_INTEGRATIONS_DIR` | Directory of unpacked integration packages. Loaded only with `FATHOM_ALLOW_LOCAL_INTEGRATIONS=true`. |
| `FATHOM_ALLOW_LOCAL_INTEGRATIONS` | `true` permits the local trust tier (directory packages and unsigned archives). Default `false`. |
| `FATHOM_SECRETS_FILE` | JSON file for connection secrets when `FATHOM_SSM_PREFIX` is unset. With neither, connection secrets are kept in memory. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `LOGFIRE_TOKEN` | Optional telemetry destinations. See [Observability](#observability). |

`AWS_REGION` or `AWS_DEFAULT_REGION` sets the region for S3, SQS, SSM, and STS clients.

The web container reads `FATHOM_API_ORIGIN` (default `http://127.0.0.1:8080`) and, locally, `FATHOM_API_TOKEN`.

## Processes

Detail: [RFC 0003 §2](/rfcs/0003-application/#2-processes).

- `FATHOM_PROCESS=api` serves HTTP. `FATHOM_PROCESS=jobs` additionally runs the job worker loop.
- Long-running operations (library pulls, provider imports, test runs, renders, git exports, restores, integration installs, collections) are stored as job rows and return `202 Accepted`. Workers atomically claim a row before running it, so concurrent processes never run a job twice.
- The scheduler runs in whichever process sets `FATHOM_RUN_SCHEDULER=true`: the API process in the default single-task deployment, or the job service when `EnableJobService` is on.
- With `FATHOM_QUEUE_URL` set, an API process that does not run the scheduler enqueues the job ID after writing the row. The message is a wake-up hint; the database claim stays authoritative, so redeliveries are no-ops. Unacknowledged messages reappear after two hours and move to the dead-letter queue after five deliveries.

## AI assistant

Agents are optional. With no model configured they are omitted and the rest of the application runs unchanged. Agents use the same write paths as people and are blocked in code from crossing human review gates; see [RFC 0003 §4](/rfcs/0003-application/#4-agents). Configuration lives in [fathom/agent/config.py](https://github.com/adversitydotdev/fathom/blob/main/fathom/agent/config.py):

| Variable | Meaning |
|---|---|
| `FATHOM_AI_MODEL` | Explicit model spec, such as `anthropic:claude-sonnet-4-5`, `openai:gpt-4o`, or `openai:llama3.2` with `FATHOM_AI_BASE_URL`. |
| `ANTHROPIC_API_KEY` | Enables Anthropic. Default model `anthropic:claude-sonnet-4-5`. |
| `OPENAI_API_KEY` | Enables OpenAI. Default model `openai:gpt-4o`. |
| `FATHOM_AI_BASE_URL` / `FATHOM_AI_API_KEY` | Custom OpenAI-compatible endpoint and key (OpenRouter, Ollama, LiteLLM, vLLM). A generic key starting `sk-ant-` selects Anthropic. |
| `FATHOM_AI_ACTOR_ID` | Party ID stamped onto agent drafts. Default `party--ogrl-agent`. |

On AWS, the stack's `ConfigurationPrefix` output names `model/api-key` under the SSM prefix as the place for a model key. The template's task definitions do not set any of the variables above.

<!-- screenshot: assistant | AI assistant drawer querying computed kernel status to summarize open control gaps behind human review gates. -->

## Integrations

Integrations are specified in [RFC 0005](/rfcs/0005-integrations/); see also [Integrations](/docs/integrations/) and the [Integration SDK](/docs/integration-sdk/).

- **Installed archives.** An install records a row and copies the archive into object storage under `integrations/<id>/<version>/<digest>.tar.gz`. Each process fetches and verifies it on first use and holds it in memory; nothing is unpacked to disk.
- **Directory packages.** `FATHOM_INTEGRATIONS_DIR` points at unpacked packages, loaded only when `FATHOM_ALLOW_LOCAL_INTEGRATIONS=true`. If the directory is set without that flag, the server logs a warning and ignores it.
- **Trust tier.** Until Sigstore verification ships with the registry, every archive installs as `local`, so archive installs also need `FATHOM_ALLOW_LOCAL_INTEGRATIONS=true`. Compose sets it; the CloudFormation template does not. See [RFC 0005 §4](/rfcs/0005-integrations/#4-installing-and-trust).
- **Connection secrets.** Stored in SSM under `FATHOM_SSM_PREFIX` when set, else in `FATHOM_SECRETS_FILE`, else in memory.
- **OAuth connections** need `FATHOM_PUBLIC_URL` for `/v1/oauth/callback` ([RFC 0005 §5](/rfcs/0005-integrations/#5-connections)).
- **AWS connections** assume each connection's role with the process's `AWS_*` credentials.
- **Schedule.** Integration test runs fire every `FATHOM_INTEGRATION_TICK` seconds in the scheduler process.

## Library source

`FATHOM_LIBRARY_REPO` is the git repository the server pulls the standard library from. Unset, it uses a local `library/` or `../ogrl-library/library` checkout if present, else `https://github.com/adversitydotdev/ogrl-library`. Library pulls run as jobs. Once an organization pulls a pinned library revision, its database is the source of truth for its program. Library building and linting use the standalone CLI; see [CLI](/docs/cli/).

## Production on AWS

[deploy/aws/template.yaml](https://github.com/adversitydotdev/fathom/blob/main/deploy/aws/template.yaml) provisions networking, RDS for PostgreSQL, a private S3 bucket, two ECR repositories (`<prefix>/api`, `<prefix>/web`), task definitions, IAM roles, CloudWatch log groups, and an SES domain identity when a domain is given. Leaving the SES sandbox is an account-level step for the operator. Topology rationale: [RFC 0003 §9](/rfcs/0003-application/#9-production-topology).

Default topology: one Linux/ARM Fargate task (0.25 vCPU, 1 GB) running the `fathom` and `web` containers, and one single-AZ `db.t4g.micro` with 20 GB gp3. No load balancer, NAT gateway, RDS Proxy, or SQS. The task sits in a public subnet and reaches git remotes and model APIs directly. The web container owns the public port: `443` with TLS terminated on the task, or `3000` behind the load balancer. It proxies `/v1` and `/health` to the API over loopback. RDS sits in a private subnet reachable only from the task security groups.

### Deploy

CloudFormation cannot create SecureStrings, so write the database password before the first apply:

```bash
aws ssm put-parameter \
  --name /fathom/fathom/database/password \
  --type SecureString \
  --value 'replace-with-at-least-16-characters'

aws cloudformation deploy \
  --template-file deploy/aws/template.yaml \
  --stack-name fathom \
  --capabilities CAPABILITY_IAM
```

The password cannot contain a slash, an at-sign, a quote, or a space. The stack name `fathom` is the path on the log groups and the SSM prefix (`/fathom/<stack>`). After rotating the password, deploy again with `DatabasePasswordVersion` set to the new SSM version so the database picks it up.

The first apply leaves `EnableServices` false so the ECR repositories exist before images do. Push the API and web images, built for `CpuArchitecture`, to the `ApiRepositoryUri` and `WebRepositoryUri` outputs, then deploy again with services on:

```bash
aws cloudformation deploy \
  --template-file deploy/aws/template.yaml \
  --stack-name fathom \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides EnableServices=true
```

With TLS on the task, put the PEM certificate at `tls/certificate` and the key at `tls/private-key` under the SSM prefix before the first apply. Harness values go under `harness/`.

The API task runs `FATHOM_PROCESS=api` with `FATHOM_RUN_SCHEDULER=true` unless `EnableJobService` is on; the job task runs `FATHOM_PROCESS=jobs` with the scheduler. Both receive the `FATHOM_DATABASE_*` settings (with `sslmode=require`), `FATHOM_S3_BUCKET`, `FATHOM_SSM_PREFIX`, `FATHOM_PUBLIC_URL`, and `FATHOM_QUEUE_URL`. The password is injected from SSM. Schema migrations (`alembic upgrade head`) are a separate step; the server does not run them.

### Parameters

| Parameter | Default | Effect |
|---|---|---|
| `EnableServices` | `false` | Start the tasks. Leave false until images are pushed. |
| `TaskSize` | `small` | API task: `small` 0.25 vCPU/1 GB, `medium` 0.5/2, `large` 1/2, `xlarge` 2/4, `2xlarge` 4/8. |
| `CpuArchitecture` | `ARM64` | `ARM64` or `X86_64`. Images must match. |
| `RepositoryPrefix` | `fathom` | ECR repositories `prefix/api` and `prefix/web`. One pair per account. |
| `ApiImageTag` / `WebImageTag` | `latest` | Image tags. |
| `EnableJobService` | `false` | Second task from the API image runs the schedule and claimed jobs; the API task stops scheduling. |
| `JobTaskSize` | `small` | Job task size. |
| `DatabaseInstanceClass` | `db.t4g.micro` | `db.t4g.micro` through `db.t4g.large`, single-AZ. |
| `DatabaseAllocatedStorage` | `20` | Initial gp3 GB. 20 is the minimum. |
| `DatabaseMaxAllocatedStorage` | `100` | Storage autoscaling ceiling in GB. |
| `DatabaseEngineVersion` / `DatabaseFamily` | `18.6` / `postgres18` | Keep on the same major version. |
| `DatabaseName` / `DatabaseUsername` | `fathom` / `fathom` | Initial database and master user. |
| `DatabasePasswordVersion` | `1` | SSM version of `/fathom/STACK/database/password`. Increment after rotating. |
| `DeletionProtection` | `true` | Set false before deleting the stack. |
| `DomainName` | empty | SES identity, and the alias record with a hosted zone and load balancer. Empty skips mail. |
| `PublicUrl` | empty | Stable `https://` origin; becomes `FATHOM_PUBLIC_URL`. Needed for OAuth connections. |
| `HostedZoneId` | empty | Route 53 zone for `DomainName`: SES DKIM records and the load balancer alias. Requires `DomainName`. |
| `EnableLoadBalancer` | `false` | ALB terminating TLS for a stable name. Requires `CertificateArn` once services are on. |
| `CertificateArn` | empty | ACM certificate in the stack's region. |
| `EnableNatGateway` | `false` | Tasks move to the private subnet behind one NAT gateway; S3 uses a free gateway endpoint. Requires `EnableLoadBalancer` once services are on. |
| `EnableRdsProxy` | `false` | RDS Proxy in front of Postgres; stores the password in Secrets Manager. |
| `EnableQueue` | `false` | SQS queue and dead-letter queue; sets `FATHOM_QUEUE_URL`. |
| `AvailabilityZoneA` / `AvailabilityZoneB` | empty | Set both or neither. Empty uses the region's first two AZs. |

RFC 0003 recommends raising `TaskSize` and the RDS class before splitting out a job service, and enabling the load balancer once a stable DNS name across task replacements is needed. Without it, the API service's public address changes when the task is replaced.

Outputs include `BucketName`, `ApiRepositoryUri`, `WebRepositoryUri`, `ConfigurationPrefix`, `DatabaseEndpoint`, `ClusterName`, the service names, and, when enabled, `QueueUrl`, `ProxyEndpoint`, `LoadBalancerDnsName`, `ApplicationUrl`, and the SES DKIM records.

### Estimated monthly cost

From the repository README. AWS on-demand list prices for US East (N. Virginia) as of 9 November 2026; 730-hour month; 12-month free tier not subtracted. The two containers share one task, so vCPU and memory are billed once.

| Line | Rate | Per month |
|---|---|---|
| Fargate, 0.25 vCPU | $0.03238 per vCPU-hour | $5.91 |
| Fargate, 1 GB memory | $0.00356 per GB-hour | $2.60 |
| Public IPv4 on the task | $0.005 per hour | $3.65 |
| RDS for PostgreSQL, `db.t4g.micro` | $0.016 per hour | $11.68 |
| RDS gp3, 20 GB | $0.115 per GB-month | $2.30 |
| S3 Standard, 5 GB of evidence | $0.023 per GB-month | $0.12 |
| SSM Parameter Store, standard parameters | no charge | $0.00 |
| SES, no mail sent | $0.10 per 1,000 messages | $0.00 |
| CloudWatch Logs, under 5 GB | $0.50 per GB ingested after the included 5 GB | $0.00 |
| **Total** | | **$26.26** |

That is the idle bill: the task and database run all month, evidence is about 5 GB, and mail, logs, and data transfer stay inside the included amounts. Automated backups up to the 20 GB volume are included. Not included: the model provider's token bill, data transfer out past 100 GB ($0.09 per GB), backup storage past 20 GB, SES once it sends, and ECR storage ($0.10 per GB-month). Before `EnableServices` is true the bill is the database, about $13.98.

| Change | Added per month |
|---|---|
| `EnableJobService` at `small` | $12.16, the second task ($8.51) and its public IPv4 ($3.65) |
| `EnableLoadBalancer` | $23.73 before any traffic: the balancer at $0.0225 per hour ($16.43) and a public IPv4 in each of two zones ($7.30). LCUs are $0.008 per LCU-hour on top. |
| `EnableNatGateway` | $36.50 before any data: the gateway at $0.045 per hour ($32.85) and its public IPv4 ($3.65). Data through it is $0.045 per GB. Each task that moves private drops its own $3.65 address. The gateway bills even while no task is running. |
| `EnableRdsProxy` | $22.30 for a `db.t4g.micro`: $0.015 per vCPU-hour and that class has 2 vCPUs ($21.90), plus $0.40 for the Secrets Manager secret the proxy requires. It bills whether or not a task is connected. |
| `EnableQueue` | $0 at one worker. SQS includes 1 million requests a month, and a long poll every 20 seconds stays under that. After the free tier, requests are $0.40 per million. |

`TaskSize` and `DatabaseInstanceClass` move the existing lines; `medium` is 0.5 vCPU and 2 GB.

## Observability

Detail: [RFC 0003 §11](/rfcs/0003-application/#11-observability). Application code logs through Python `logging`; [fathom/telemetry.py](https://github.com/adversitydotdev/fathom/blob/main/fathom/telemetry.py) is the only module that configures Logfire or OpenTelemetry.

| Setting | Destination |
|---|---|
| none (default) | Single-line structured JSON to stdout, collected by CloudWatch Logs on AWS. No trace export. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Any OTLP collector. |
| `LOGFIRE_TOKEN` | Hosted Logfire. |

`FATHOM_LOG_LEVEL` sets the log level (default `INFO`). `OTEL_SERVICE_NAME` sets the service name (default `fathom`). Trace export needs the optional `telemetry` extra (`logfire[fastapi,sqlalchemy,httpx]`). The Dockerfile installs without extras, so in the stock image a configured endpoint logs a warning and falls back to JSON stdout.

## Backups and export

**Git snapshot export** ([RFC 0002 §8](https://ogrl.adversity.dev/rfcs/0002-tooling/#8-git-export)). Set `FATHOM_EXPORT_REMOTE` to a git remote the organization controls. The scheduler process then exports every `FATHOM_EXPORT_INTERVAL` seconds (default daily); `POST /exports/git` triggers one on demand. A snapshot holds every organization-owned object, policy and procedure bodies, a bundle manifest pinning the library and provider bundles, and read-only provider projections. Evidence blobs are not committed; only their metadata with `resource.uri` and `resource.digest`. The export commits only when the tree changed and pushes without pulling. If the remote has commits the job did not produce, export halts and alerts. The running tool never reads the snapshot back. The CloudFormation template does not set `FATHOM_EXPORT_REMOTE`, so export is off until you add it.

**Restore.** `POST /restore` loads a snapshot at a given commit into an empty organization database and returns `409 Conflict` if any organization objects exist. It pulls the pinned library, verifies provider projections against their digests, validates the whole graph, and copies evidence blobs into the new deployment's object storage. Revision history restarts at the restore time, so RFC 0002 advises keeping database backups alongside git snapshots when historical audit playback matters.

**Database backups.** On AWS, RDS automated backups are included up to the size of the 20 GB volume.

**OSCAL.** `POST /programs/{id}/renders` with `view: oscal` renders the OSCAL package as a job.
