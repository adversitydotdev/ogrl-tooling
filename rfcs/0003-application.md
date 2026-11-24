# RFC 0003: Application Architecture

| Field | Value |
|---|---|
| Status | Draft |
| Spec version | 0.1.0 |
| Date | 2026-11-09 |
| Depends on | [RFC 0001](https://ogrl.adversity.dev/rfcs/0001-object-model/), [RFC 0002](https://ogrl.adversity.dev/rfcs/0002-tooling/) |
| AI assistance | Drafted and edited with AI tools; human review in progress (see [README](https://github.com/adversitydotdev/ogrl-tooling#ai-assistance)) |

[RFC 0001](https://ogrl.adversity.dev/rfcs/0001-object-model/) defines the OGRL language and [RFC 0002](https://ogrl.adversity.dev/rfcs/0002-tooling/) establishes where each copy of an object is authoritative (both published on the [specification site](https://ogrl.adversity.dev/)). This RFC specifies the runtime architecture of the self-hosted OGRL application: its process boundaries, pure Python kernel, agent guardrails, plugin ports, persistence layer, web frontend, observability, and cost-conscious production AWS deployment. Open questions are collected in [Section 12](#12-open-questions).

## 1. Summary

At the center of Fathom sits a single pure-Python **kernel** built on Pydantic models of the RFC 0001 schema. The FastAPI server, the job worker, and AI agents all invoke that same kernel so no two entry points can disagree on validation, parameter resolution, or computed status. The web frontend is a Next.js application that communicates strictly over HTTP and renders status computed by the API.

In production, the entire stack is designed to self-host inside the organization's own AWS account as a single small ARM Fargate task backed by a single `db.t4g.micro` Postgres instance—provisioned directly from the Fathom repository's CloudFormation template. Because a small team's compliance platform spends most of its life idle, minimizing the **idle monthly bill** is a first-order architectural constraint: the default topology deliberately avoids NAT gateways, load balancers, RDS Proxy, and databases with high minimum floors.

AI agents are ordinary callers rather than a privileged sidecar layer. They use the exact same use-case functions as the HTTP API, can write only objects the kernel validates, and are blocked in code from crossing human judgment boundaries—a language model never marks a control `met`.

Extensibility works through four typed ports (importers, renderers, runners, and connectors) that consume and produce RFC 0001 objects without ever overriding status computation. Built-in extensions ship as Python packages; organization-supplied runners and connectors run out-of-process as language-agnostic JSON subprocesses.

## 2. Processes

| Process | Stack | Responsibility |
|---|---|---|
| `ogrl` (library CLI) | Rust ([`ogrl-rs`](https://github.com/adversitydotdev/ogrl-rs)) | Lints, formats, imports, and bundles the shared library in `adversitydotdev/ogrl-library`; requires no server or organization database. |
| `fathom` (server) | Python | Runs the FastAPI HTTP server, background job runner, scheduler, and agents in a single process—the sole writer to the organization's Postgres database. |
| Web frontend | TypeScript, Next.js | User interface; reads and writes exclusively through the HTTP API. |

Self-hosting requires only the `fathom` server process and the web frontend. The `ogrl` CLI and the server's kernel share the same Rust core (`ogrl_rs`), so they share identical bundle semantics. Future CLI commands that operate on an organization's live program will call the HTTP API rather than connecting to Postgres directly, keeping all RFC 0002 invariants enforced behind a single writer.

**Background jobs and scheduling.** Long-running operations defined in [RFC 0004](0004-http-api.md)—library pulls, provider imports, test runs, renders, Git exports, restores, and connector collections—are persisted as job rows and return `202 Accepted` immediately so HTTP requests never block on subprocess execution.

- Periodic schedules from RFC 0002 run in whichever process sets `FATHOM_RUN_SCHEDULER=true` (the combined API process in the default single-task deployment, or the dedicated job service when `EnableJobService` is enabled).
- Workers atomically claim a job row before executing it, preventing duplicate execution across concurrent processes.
- `FATHOM_QUEUE_URL` is unset by default. When SQS wakeups are enabled, the API enqueues the job ID after writing the row and workers receive it as a hint; the database claim remains authoritative so redeliveries safely no-op. Unacknowledged messages become visible again after two hours and move to a dead-letter queue after five deliveries.

**Process environment.** `FATHOM_PROCESS` selects `api` or `jobs`. The Next.js frontend reads `FATHOM_API_ORIGIN` (default `http://127.0.0.1:8080`) and proxies `/v1` and `/health` to the API container inside the same task. `FATHOM_SSM_PREFIX` locates Parameter Store secrets: `database/password`, optional task-terminated TLS material (`tls/certificate`, `tls/private-key`), optional LLM key (`model/api-key`), and test-harness credentials under `harness/`.

The HTTP server uses [FastAPI](https://fastapi.tiangolo.com/) implementing the hand-authored OpenAPI contract ([api/openapi.yaml](https://github.com/adversitydotdev/fathom/blob/main/api/openapi.yaml)) and [RFC 0004](0004-http-api.md).

## 3. Kernel

The kernel is a self-contained Python package containing the Pydantic object models, bundle loader, graph-constraint validator, parameter resolver, and RFC 0001 section 8 status evaluator. Status is a pure function of an object graph and an evaluation timestamp.

The kernel performs **zero I/O**: it never opens network sockets, database sessions, subprocesses, or model clients. HTTP routing, SQL persistence, the `shell` runner, and agent orchestration all live outside it, so kernel unit tests run deterministically in milliseconds on an in-memory bundle and date.

Heavy parsing, parallel graph linting, library diffs, and OSCAL 1.2.3 import/render operations are backed by [`ogrl-rs`](https://github.com/adversitydotdev/ogrl-rs) (`ogrl_rs` PyO3 wheel), sharing the exact same Rust core as the standalone `ogrl` CLI that builds and validates [`ogrl-library`](https://github.com/adversitydotdev/ogrl-library).

## 4. Agents

Fathom uses [Pydantic AI](https://ai.pydantic.dev/) for agent workflows that draft narratives, propose crosswalks, or gather operational context. Every tool exposed to an agent wraps a kernel function or application use case with typed Pydantic inputs and outputs; malformed structured outputs fail validation before reaching storage.

Dependencies flow strictly in one direction: the agent package imports the kernel, never the reverse, and the kernel has no awareness of whether any LLM is configured.

**No parallel suggestion tables.** Agents write ordinary RFC 0001 objects through the same write paths humans use, relying on the language's built-in review gates:

| Agent action | Resulting object state |
|---|---|
| Proposing a crosswalk | `mapping` with `review_status: draft` until reviewed by a human (or accepted via `mapping_review`). |
| Drafting an implementation narrative | `implementation` with `status: planned` until a human promotes it to `implemented`. |
| Recording a test result or artifact | Standard `result` or `evidence` with `created_by_ref` set to the agent's `party` ID. |

Representing the agent as an organization `party` makes provenance transparent in `created_by_ref` and the revision log; accepting a draft is simply a normal human edit.

**Hard-coded write gates.** Because agents ingest untrusted external text—provider bundles, uploaded evidence, and policy documents—that could carry prompt injections, restrictions are enforced unconditionally in application code rather than in prompts. Whenever the caller is an agent, the server refuses:

- Any `implementation.status` other than `planned`.
- Setting `review_status: reviewed` on a `mapping`, creating a `mapping_review`, or setting `combined_with_refs` (and library rows remain read-only per RFC 0004).
- Creating or modifying an `exception`, a `finding`, an `adopted` policy or procedure, or an `accepted` risk.
- Creating or editing a `test.run` block (an agent may still trigger runs of human-authored tests).
- Revoking any object.

Each blocked operation represents either formal human accountability or arbitrary command execution. Agents read the graph exclusively through the standard API query functions—including `GET /programs/{id}/status`—and never recompute status independently.

Model provider selection is purely a deployment setting and cannot alter kernel outputs. A deployment with no model configured omits agents cleanly while running the full API, harness, and import/export workflows identically.

## 5. Ports

External capabilities plug into the core through four Python `Protocol` interfaces. Built-in implementations ship in-tree and are imported directly by the application:

| Port | Input | Output | Packaging |
|---|---|---|---|
| **Importer** | Catalog or component-definition bytes | OGRL objects | In-process (NIST OSCAL catalogs first, OSCAL component definitions next). |
| **Renderer** | Object graph + view name | Rendered files | In-process (Git snapshot and OSCAL 1.2.3 package from RFC 0002). |
| **Runner** | `test`, `implementation`, and secret handle | `result` and `evidence` | `shell` and `rule` runners in-process; `integration` runner through the [RFC 0005](0005-integrations.md) protocol; custom organization runners as subprocesses. |
| **Connector** | Connection and source | Snapshot | Installed integration package run through the [RFC 0005](0005-integrations.md) protocol. |

The secret handle resolves only the variable names declared in `test.run.env`; secret values never appear inside test objects.

**Credential isolation for runners.** The harness spawns runner subprocesses under a dedicated OS user with a scrubbed environment containing *only* the requested `run.env` variables and `FATHOM_*` metadata variables. Subprocesses never inherit database credentials, the API's AWS IAM credentials, or secrets belonging to other tests, and cannot inspect the API process environment. Scripts emit evidence by writing files to their scratch directory, which the harness hashes and uploads. Scripts requiring cloud access receive dedicated, narrowly scoped credentials stored under `harness/` in Parameter Store.

Note that this provides **credential separation**, not a kernel or network sandbox: scripts still share the task's network namespace and kernel. Organizations that do not fully trust test authors should enable the dedicated job service (`EnableJobService`) to isolate script execution from the API task, and RFC 0004 treats permission to author `run` blocks as its own privileged capability.

**Non-extensible core.** Status computation, parameter resolution, and mapping semantics are deliberately not pluggable—allowing plugins to override them would break cross-installation determinism. Agents are callers of the kernel and ports, not a fifth port.

## 6. Subprocess plugins

Organization-supplied runners and connectors run as standalone executables rather than in-process Python plugins, keeping third-party code outside the API's address space.

`fathom` spawns the executable, writes a JSON request containing RFC 0001 objects to `stdin`, and reads RFC 0001 JSON objects from `stdout`. Required secrets are injected exclusively via environment variables (the request payload carries variable names, never values). Every returned object passes through the exact same kernel validator used for files and HTTP writes.

Plugins may be written in any language capable of speaking JSON over stdio. Any non-zero crash, timeout, or schema validation failure is captured as a `result` with `outcome: error` so the harness logs the failure and moves on cleanly to the next test.

Integrations do not use this sketch. They speak the JSON-RPC protocol in [RFC 0005 section 7](0005-integrations.md#7-protocol), return data rather than OGRL objects, and leave every object to the harness.

## 7. Persistence

Organization databases run on **PostgreSQL**. Each object is persisted as canonical JSON inside a `jsonb` column, flanked by derived indexed columns (`id`, `type`, organization scope, and common filter references) updated atomically in the same write.

Table definitions use [SQLModel](https://sqlmodel.tiangolo.com/) over SQLAlchemy's async engine (`asyncpg`), isolated strictly inside the `persistence/` package. Kernel Pydantic models never import SQLModel; the persistence layer handles all row-to-object translation. Application operations declare repository protocols rather than accepting raw sessions or row models, allowing unit tests to run against an in-memory repository implementation.

**Optimistic concurrency (`If-Match`).** Updates enforce concurrency atomically inside SQL (`UPDATE ... WHERE id = :id AND modified = :expected`), returning HTTP `412 Precondition Failed` when zero rows match so racing writers can never overwrite each other silently.

**Migrations and blobs.** Schema changes ship exclusively as reviewed [Alembic](https://alembic.sqlalchemy.org/) migration scripts; the server never mutates tables automatically on startup. Binary artifacts (evidence blobs, policy/procedure bodies, and rendered archives) live in object storage (S3 on AWS), while Postgres stores only their `resource.uri` and `resource.digest`.

Neither the Next.js web app nor the `ogrl` CLI ever connects directly to Postgres, and agents access storage only through the application's validated write functions.

## 8. Web application

The frontend is a Next.js and TypeScript application that acts purely as a presentation layer over [RFC 0004](0004-http-api.md) ([api/openapi.yaml](https://github.com/adversitydotdev/fathom/blob/main/api/openapi.yaml)). It renders computed statuses returned by the API without duplicating evaluation logic in the browser.

UI primitives are sourced from [Spectrum UI](https://ui.spectrumhq.in/) (built on Tailwind CSS, Motion, TypeScript, and shadcn/ui), vendored directly into the repository so components can be tailored without taking a runtime dependency on Spectrum.

Initial views focus strictly on operating a live program—system overview, baseline controls with computed status, implementations, tests, and evidence—leaving marketing pages and visual flourish out of the application. Views surface `created_by_ref` clearly so reviewers can distinguish agent-authored drafts from human edits and accept them via standard editing flows.

**Ingress.** The web container owns the task's public port: listening on `443` with direct TLS termination when deployed without a load balancer, or `3000` behind an ALB when `EnableLoadBalancer` is enabled. In both modes it proxies `/v1` and `/health` to the API container over loopback.

## 9. Production topology

Fathom ships an AWS CloudFormation template ([deploy/aws/template.yaml](https://github.com/adversitydotdev/fathom/blob/main/deploy/aws/template.yaml)) so each organization deploys cleanly into its own cloud account. Additional cloud providers will ship as alternate infrastructure templates implementing the same bindings rather than forks of the application.

**Designing for the idle bill.** A small team's GRC tool sees modest interactive traffic punctuated by periodic test runs and exports. Typical "enterprise defaults" in `us-east-1` burn substantial idle spend before handling a single request—roughly $33/month for a NAT gateway, ~$45/month for Aurora Serverless v2's 0.5 ACU floor, ~$11/month for RDS Proxy, and ~$7/month per AZ for interface VPC endpoints—none of which improve reliability for a low-traffic compliance app.

The baseline topology therefore runs one compact task and one single-AZ database:

| Capability | Default AWS binding | Role |
|---|---|---|
| Compute | 1 Linux/ARM Fargate task (`0.25 vCPU`, `1 GB`) | Runs both `fathom` (API, scheduler, harness, agents) and Next.js in one task so vCPU/RAM are billed once; ARM aligns with `db.t4g`. |
| Database | RDS PostgreSQL `db.t4g.micro`, single-AZ, `20 GB` gp3 | Organization database; scales vertically via template parameters when needed. |
| Object storage | Private S3 bucket | Evidence blobs, policy/procedure bodies, and rendered packages. |
| Secrets | SSM Parameter Store | Database password, TLS material, optional LLM API key, and `harness/` credentials. |
| Mail | SES | Operational alerts (failed jobs, diverged Git exports) and future auth mail. |
| Logs | CloudWatch Logs | Structured JSON logs from stdout (traces disabled unless configured; [Section 11](#11-observability)). |

At US East (N. Virginia) on-demand list pricing as of 9 November 2026, this baseline idles at **$26.26/month** (full itemization and exclusions are maintained in the [self-hosting guide](/docs/self-hosting/#estimated-monthly-cost)), which serves as the cost benchmark for future changes.

By default there is no ALB, NAT gateway, RDS Proxy, Aurora, SQS, or interface VPC endpoint. The Fargate task runs in a public subnet so it can reach Git remotes and LLM APIs directly while terminating TLS itself; RDS sits in a private subnet reachable only from the task's security group.

**Opt-in scaling knobs.** Every upgrade is an explicit parameter in `deploy/aws/template.yaml`:

| Bottleneck or need | Template parameter(s) | Default and upgrade path |
|---|---|---|
| CPU or memory headroom | `TaskSize` | `small` (0.25 vCPU / 1 GB) → `medium` (0.5 / 2 GB) → `large` (1 / 2 GB) → `xlarge` (2 / 4 GB) → `2xlarge` (4 / 8 GB). |
| Database capacity | `DatabaseInstanceClass`, `DatabaseAllocatedStorage` | `db.t4g.micro`, `20 GB` (auto-scales storage up to `DatabaseMaxAllocatedStorage`, default `100 GB`). |
| Long jobs contending with API | `EnableJobService` | `false`. Spins up a second task from the same image (public subnet, no NAT) and shifts scheduling there. |
| Stable hostname across task replacements | `EnableLoadBalancer`, `CertificateArn` | `false`. Adds an ALB terminating TLS while tasks retain public egress. |
| Private tasks / static egress | `EnableNatGateway` | `false`. Moves tasks into private subnets behind one NAT gateway with a free S3 gateway endpoint (requires `EnableLoadBalancer` when services are enabled). |
| Connection pooling across many tasks | `EnableRdsProxy` | `false`. Adds RDS Proxy and mirrors the DB credential to Secrets Manager as required by the proxy. |
| Event-driven worker wakeups | `EnableQueue` | `false`. Adds SQS + DLQ while keeping the Postgres job row authoritative. |

Operators should size up `TaskSize` and the RDS instance before splitting out a job service, and enable the load balancer once a stable DNS name across task replacements is required.

**Deployment lifecycle and mail.** Applying `deploy/aws/template.yaml` provisions networking, RDS, S3, ECR repositories, task definitions, IAM roles, and an SES domain identity (when a domain is provided; exiting the SES sandbox remains an account-level operator step). `EnableServices` defaults to `false` so the first deploy provisions ECR before images are pushed. Because CloudFormation cannot synthesize SecureStrings, operators write `database/password` (and `tls/certificate` / `tls/private-key` when terminating TLS on the task) under the stack's SSM prefix prior to the first apply.

Local development requires none of AWS: `fathom` runs as a single process against local Postgres, and kernel tests run completely in memory.

## 10. Repository layout

Structure of the Fathom application repository (with the shared standard library in `adversitydotdev/ogrl-library` and the Rust core/CLI in `adversitydotdev/ogrl-rs`):

```text
fathom/
  kernel/        # Pydantic models, graph validation, parameter resolution, status
  importer/      # Importer port and NIST / OSCAL component importers
  renderer/      # Git snapshot and OSCAL 1.2.3 renderers
  runner/        # Built-in shell runner
  agent/         # Pydantic AI agents and typed tool wrappers
  persistence/   # SQLModel rows, Postgres repositories, Alembic migrations
  telemetry.py   # Sole module importing logfire
  api/           # FastAPI application and in-process job runner
  main.py        # `fathom` entry point: API server or job worker
web/             # Next.js frontend
deploy/aws/      # CloudFormation template for production AWS deployment
```

Subprocess connectors live in their own independent repositories rather than inside this tree.

## 11. Observability

Application code emits logs through Python's standard `logging` module; neither the kernel nor operations import any observability vendor directly.

Structured logging and distributed tracing are wired once at process startup inside `fathom/telemetry.py` using the MIT-licensed OpenTelemetry-based [Logfire](https://logfire.pydantic.dev/) SDK, which auto-instruments FastAPI, SQLAlchemy, `asyncpg`, `httpx`, and Pydantic AI so an HTTP request, its SQL queries, and any agent invocation correlate under a single trace. Confining the import to one module makes swapping telemetry backends trivial.

Telemetry destination is purely runtime configuration and never requires the hosted Logfire service:

| Environment setting | Destination |
|---|---|
| *(none — default)* | Structured JSON to stdout (collected by CloudWatch Logs); no trace export. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Any self-hosted or third-party OTLP collector (Grafana, SigNoz, Jaeger, etc.). |
| `LOGFIRE_TOKEN` | Hosted Logfire, for teams opting into it. |

Running an extra collector sidecar or paid exporter stays opt-in so it never inflates the baseline idle bill in [Section 9](#9-production-topology).

## 12. Open questions

1. **Authentication and authorization:** User accounts remain out of scope for `0.1.0` (deferred to a dedicated RFC; SES is already wired into the stack for future auth mail). Because creating and running a `test` executes shell commands on the task, exposing the API publicly without authentication is unsafe—`EnableServices` must remain `false` outside private testing until authentication and `run`-block permissions are in place.
2. **Model provider selection:** Pydantic AI supports multiple cloud and local model providers; choosing a vendor or self-hosted model remains an operational deployment decision outside the kernel.
3. **Additional cloud providers:** AWS is the initial deployment target. Because the application binds strictly through portable ports (Postgres, S3-compatible storage, env/secrets, SMTP/SES), templates for GCP or Azure will be authored once real users ask for them.
