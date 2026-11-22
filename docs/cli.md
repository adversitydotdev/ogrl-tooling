# The ogrl CLI

| Field | Value |
|---|---|
| Repository | [adversitydotdev/ogrl-rs](https://github.com/adversitydotdev/ogrl-rs) |
| Version | 0.2.0 |
| Language | Rust (PyO3 bindings) |

`ogrl` is a standalone Rust binary that lints, formats, imports, bundles, evaluates, diffs, and renders OGRL repositories. It ships with `ogrl_rs`, a Python package that exposes the same engine. Both are built from the `ogrl-rs` workspace: `ogrl-core` holds the object model, strict YAML 1.2 parser, canonical formatter, graph constraints, and status evaluator, and `ogrl-oscal` holds the OSCAL 1.2.3 importers and renderers. Work runs in parallel with `rayon`, and nothing is needed at runtime beyond the binary.

## Install

Prebuilt binaries are attached to [GitHub Releases](https://github.com/adversitydotdev/ogrl-rs/releases).

```bash
# macOS (Apple Silicon)
curl -fsSL https://github.com/adversitydotdev/ogrl-rs/releases/latest/download/ogrl-aarch64-apple-darwin.tar.gz | tar -xz

# Linux (x86_64)
curl -fsSL https://github.com/adversitydotdev/ogrl-rs/releases/latest/download/ogrl-x86_64-unknown-linux-gnu.tar.gz | tar -xz

# Linux (aarch64)
curl -fsSL https://github.com/adversitydotdev/ogrl-rs/releases/latest/download/ogrl-aarch64-unknown-linux-gnu.tar.gz | tar -xz
```

Archives are also published for `x86_64-apple-darwin` (`.tar.gz`) and `x86_64-pc-windows-msvc` (`.zip`), together with `SHA256SUMS.txt`.

To build from source with a Rust toolchain that supports edition 2024:

```bash
git clone https://github.com/adversitydotdev/ogrl-rs
cd ogrl-rs
cargo build --release -p ogrl-cli   # binary at target/release/ogrl
```

## Commands

```text
ogrl <COMMAND>

  lint     Validate YAML 1.2 authoring rules, RFC 0001 schemas, and §7.20 graph constraints
  fmt      Format OGRL YAML files in canonical key order (RFC 0001 §6.1)
  import   Import OSCAL catalogs or component definitions into OGRL objects
  bundle   Pack, unpack, or hash OGRL bundles
  eval     Evaluate RFC 0001 §8 program status or summary at a point in time
  diff     Diff two library revisions (RFC 0002 §5) and preview status impact
  render   Render a program to an OSCAL 1.2.3 package or narrative SSP
```

Inputs called `path` accept a repository-form directory or an exchange-form bundle file (YAML or JSON). Timestamps passed to `--at` use RFC 3339 and default to the current UTC time. When `--program` is omitted, the CLI uses the only program in the graph. If the graph has none, or more than one, the command fails and lists the IDs it found.

### lint

Parses every object with strict YAML 1.2 rules, checks it against the RFC 0001 schemas, and runs the §7.20 graph constraints in parallel. When you pass `--library`, the library is loaded to resolve references, but diagnostics are reported only for objects under `path`.

| Flag | Default | Description |
|---|---|---|
| `<path>` | required | Directory, exchange bundle, or single object file |
| `--library <dir>` | none | Standard library used to resolve references |
| `--profile <p>` | `auto` | Origin profile: `auto`, `library`, `provider`, `organization` |
| `--format <f>` | `text` | `text`, `json`, or `sarif` |
| `--lenient-yaml` | off | Relax the RFC 0001 §6.1 strict YAML checks (allows anchors and nulls) |

```bash
ogrl lint ./my-org --library ../ogrl-library/library --format sarif > ogrl.sarif
```

### fmt

Rewrites `.yaml`/`.yml` files in canonical key order. A leading block of `#` comment lines at the top of a file is kept. Paths that contain a dot-prefixed component, such as `.git/`, are skipped. Files are always parsed in strict mode.

| Flag | Description |
|---|---|
| `<path>` | File or directory |
| `--check` | Report files that would change (`would reformat <file>`) without writing them; exits non-zero if any would change |

```bash
ogrl fmt ../ogrl-library/library --check
```

### import nist

Downloads the pinned NIST SP 800-53 r5 and SP 800-171 r3 OSCAL catalogs and imports them, including assessment objectives. It also builds SP 800-171 r2 from the pinned SP 800-171A CSV, which is checked before import because NIST does not publish OSCAL for r2. Cross-references from SP 800-171 to SP 800-53 r5 are resolved. The command writes a `bundle.yaml` manifest to the output directory. It needs network access.

| Flag | Default | Description |
|---|---|---|
| `--out <dir>` | `library` | Output directory |

```bash
ogrl import nist --out library
```

### import oscal

Imports one local OSCAL 1.2.3 catalog (JSON or XML) as an OGRL framework with its requirements, objectives, and mappings.

| Flag | Default | Description |
|---|---|---|
| `--catalog <file>` | required | OSCAL catalog JSON or XML |
| `--framework-id <slug>` | required | Framework slug, e.g. `nist-sp-800-53-r5` |
| `--name <title>` | catalog `metadata.title` | Framework display title |
| `--publisher <name>` | `NIST` | Publisher recorded on the framework |
| `--out <dir>` | `library` | Output directory |
| `--source-uri`, `--source-path`, `--commit` | none | Upstream provenance recorded on the framework |
| `--resolve-catalog <file>` | none | Second catalog used to resolve cross-framework control references |
| `--resolve-framework <id>` | none | Framework ID for `--resolve-catalog` (required when `--resolve-catalog` is set) |
| `--write-bundle` | off | Also write or update `bundle.yaml` in `--out` |

```bash
ogrl import oscal --catalog catalog.json --framework-id nist-sp-800-53-r5 --out library --write-bundle
```

### import oscal-component

Imports an OSCAL 1.2.3 component definition (JSON or XML) as an OGRL provider bundle. Control IDs are resolved against a pinned library, and anything that can't be resolved is printed to stderr as a warning.

| Flag | Description |
|---|---|
| `--input <file>` | Component definition JSON or XML (required) |
| `--library <path>` | Pinned library directory or bundle (required) |
| `--out <path>` | Output directory, or output file when `--exchange` is set (required) |
| `--exchange` | Write a single exchange-form JSON bundle instead of a directory tree |

```bash
ogrl import oscal-component --input component.json --library ../ogrl-library/library --out provider/django
```

### bundle pack

Packs a repository-form directory into one exchange-form bundle. If the directory has no manifest, the CLI generates one (`name: Packed bundle`, `version: 0.1.0`). It refuses to pack if any file fails parsing or schema checks. JSON output is RFC 8785 canonical JSON. The command prints the projection digest of the packed objects.

| Flag | Default | Description |
|---|---|---|
| `<dir>` | required | Repository-form directory |
| `--out <file>` | required | Output bundle file |
| `--format <f>` | `json` | `json` or `yaml` |

```bash
ogrl bundle pack ../ogrl-library/library --out library.json
```

### bundle unpack

Writes an exchange-form bundle file back out as a repository-form directory tree. It refuses to unpack if the bundle has errors.

```bash
ogrl bundle unpack library.json --out ./library
```

### bundle digest

Prints the deterministic SHA-256 projection digest (`sha-256:<hex>`, computed over RFC 8785 canonical JSON) of the objects in a directory or bundle.

```bash
ogrl bundle digest ../ogrl-library/library
```

### eval

Computes RFC 0001 §8 status for a program at a given instant. By default it prints the state of each control and requirement, listing failed checks under each control and unmet controls next to each requirement. `--summary` prints readiness counts instead. The input must parse cleanly; otherwise the command fails and tells you to run `ogrl lint`.

| Flag | Default | Description |
|---|---|---|
| `<path>` | required | Organization directory or bundle |
| `--library <dir>` | none | Standard library, if stored separately |
| `--program <id>` | sole program | Program to evaluate |
| `--at <rfc3339>` | now | Evaluation instant |
| `--framework <id>` | none | Limit requirement coverage to one framework |
| `--summary` | off | Print summary counts instead of per-item detail |
| `--format <f>` | `text` | `text` or `json` |

```bash
ogrl eval ./my-org --library ../ogrl-library/library --at 2026-11-09T00:00:00Z --summary
```

Example `--summary` text output:

```text
Program: Acme Production (program--com.acme.prod)
At: 2026-11-09T00:00:00Z
Controls:     met=42 gap=3 waived=1 out_of_scope=2
Requirements: covered=120 contribution=8 unmapped=14 gap=5
Alerts:       failing_tests=2 open_risks=4 expiring_evidence=1 expiring_exceptions=0 open_findings=3
```

### diff

Compares two library revisions as described in RFC 0002 §5. It reports added, modified, and removed objects, mapping reviews that the change makes stale, and baseline requirements that are newly withdrawn. With `--org`, it also evaluates each program against both revisions and lists every control and requirement whose state changes (`before -> after`).

| Flag | Default | Description |
|---|---|---|
| `--before <path>` | required | Baseline library directory or bundle |
| `--after <path>` | required | Candidate library directory or bundle |
| `--org <path>` | none | Organization directory or bundle for program impact |
| `--at <rfc3339>` | now | Evaluation instant |
| `--format <f>` | `text` | `text` or `json` |

```bash
ogrl diff --before ./lib-v1 --after ./lib-v2 --org ./my-org --format json
```

### render oscal

Renders a program as a six-document OSCAL 1.2.3 package: `profile`, `ssp`, `mapping-collection`, `component-definition`, `assessment-results`, and `poam`. Each document is written as `.json`, and with `--xml` also as `.xml` (see RFC 0002 §9).

| Flag | Default | Description |
|---|---|---|
| `<path>` | required | Organization directory or bundle |
| `--library <dir>` | none | Standard library |
| `--program <id>` | sole program | Program to render |
| `--framework <id>` | required | Framework ID, e.g. `framework--nist-sp-800-53-r5` |
| `--out <dir>` | required | Output directory (created if missing) |
| `--at <rfc3339>` | now | Evaluation instant |
| `--xml` | off | Also emit XML |

```bash
ogrl render oscal ./my-org --library ../ogrl-library/library --framework framework--nist-sp-800-53-r5 --out ./oscal --xml
```

### render ssp

Renders a narrative System Security Plan as `ssp.md` and `ssp.json`. It takes the same flags as `render oscal` except `--framework` and `--xml`.

```bash
ogrl render ssp ./my-org --library ../ogrl-library/library --out ./ssp
```

## Output formats

- `lint --format text` writes each diagnostic to stderr as `<file>:<line>:<col>: error[<code>] [<pointer>]: <detail>`. It then prints `ok: N objects validated in Xms (0 errors)` to stdout, or a `failed: ...` line to stderr.
- `lint --format json` prints `{ ok, objects, errors, elapsed_ms, diagnostics }`.
- `lint --format sarif` prints a SARIF 2.1.0 log with tool name `ogrl`. Use it for code-scanning upload in CI.
- `eval` and `diff` with `--format json` print the evaluator's status, summary, or diff structure as pretty-printed JSON.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | `lint` found errors; `fmt --check` found files to reformat; or any command failed (message on stderr prefixed `ogrl:`) |
| `2` | Invalid arguments (clap usage error) |

Warnings don't affect the exit code of `lint`; only error-severity diagnostics do.

## Python bindings

The `ogrl-py` crate builds the `ogrl_rs` package (PyPI name `ogrl-rs`, Python 3.13 or later, abi3). Heavy calls release the GIL and run in parallel Rust. Results come back as plain Python `dict`/`list` values decoded from JSON. Inputs that take objects accept a list of dicts, a JSON string, or JSON bytes.

To build locally with [maturin](https://www.maturin.rs/):

```bash
cd crates/ogrl-py
maturin develop --release        # or: uv pip install -e crates/ogrl-py
```

### OgrlGraph

`OgrlGraph` is an indexed graph held in Rust memory. Load it once and query it repeatedly without re-parsing.

| Member | Description |
|---|---|
| `OgrlGraph.from_path(path, *, library=None, strict=True, profile="auto")` | Load a directory or bundle, plus an optional library |
| `OgrlGraph.from_objects(objects, *, library_ids=None, provider_ids=None)` | Build a graph from in-memory objects |
| `len(graph)` | Object count |
| `digest()` | `sha-256:<hex>` projection digest |
| `check_object(obj, *, origin="organization")` | Validate one object against the graph |
| `check_all()` | Validate every object in parallel |
| `evaluate(program_id, at, *, framework_id=None)` | RFC 0001 §8 status |
| `summarize(program_id, at)` | Readiness summary counts |
| `compare_library(after_library, at)` | RFC 0002 §5 diff against a candidate library |
| `render_oscal(program_id, framework_id, at, *, include_xml=False)` | OSCAL package as `list[RenderedFile]` |
| `render_ssp(program_id, at)` | `ssp.md` and `ssp.json` as `list[RenderedFile]` |
| `import_oscal_component(content)` | Import a component definition against this graph as the library |

`at` can be an RFC 3339 string or a `datetime`. `RenderedFile` is a frozen dataclass with the fields `name`, `media_type`, and `content` (bytes). `profile` and `origin` take `auto` (profile only), `library`, `provider`, or `organization`.

### Module functions

| Function | Description |
|---|---|
| `lint_path(path, *, library=None, strict=True, profile="auto")` | Same checks as `ogrl lint`; returns `{ok, objects, errors, diagnostics}` |
| `read_directory(root, *, strict=True, profile="auto")` | Returns `{manifest, objects, diagnostics}` |
| `read_exchange(content, *, strict=True, profile="auto")` | Same as `read_directory`, for an exchange bundle string |
| `parse_yaml(text, *, strict=True)` | Strict YAML 1.2 (or JSON) to Python values |
| `format_yaml(obj, *, header_comment=None)` | Canonical YAML string |
| `canonical_json(value)` | RFC 8785 canonical JSON bytes |
| `projection_digest(objects)` | `sha-256:<hex>` digest |
| `check_object`, `check_graph` | Stateless wrappers over `OgrlGraph` validation |
| `evaluate_program`, `summarize_program` | Stateless wrappers over `evaluate` / `summarize` |
| `compare_library_revisions(before_objects, after_library, at, ...)` | Stateless library diff |
| `import_oscal_catalog(content, framework_id, *, name, publisher="NIST", source_uri, source_path, commit, resolve_catalog, resolve_framework)` | Same as `ogrl import oscal`, in memory |
| `import_oscal_component(content, library_objects)` | Same as `ogrl import oscal-component`, in memory |
| `render_oscal`, `render_ssp` | Stateless wrappers over the graph renderers |

Unlike the CLI, `lint_path` counts every diagnostic, warnings included, in `errors`, and sets `ok` only when there are no diagnostics at all. Invalid arguments and engine errors raise `ValueError`.

```python
import ogrl_rs

report = ogrl_rs.lint_path("./my-org", library="../ogrl-library/library")
if not report["ok"]:
    for d in report["diagnostics"]:
        print(d["code"], d["detail"])

graph = ogrl_rs.OgrlGraph.from_path("./my-org", library="../ogrl-library/library")
status = graph.evaluate("program--com.acme.prod", "2026-11-09T00:00:00Z")
for f in graph.render_oscal(
    "program--com.acme.prod",
    "framework--nist-sp-800-53-r5",
    "2026-11-09T00:00:00Z",
    include_xml=True,
):
    print(f.name, f.media_type, len(f.content))
```

## Related specs

- [RFC 0001: Object model](https://ogrl.adversity.dev/rfcs/0001-object-model/): object types, strict YAML authoring rules (§6.1), graph constraints (§7.20), and status evaluation (§8).
- [RFC 0002](https://ogrl.adversity.dev/rfcs/0002-tooling/): bundles, library revisions and diffs (§5), and OSCAL rendering (§9).
- [RFC 0003: Application](/rfcs/0003-application/) and [RFC 0004: HTTP API](/rfcs/0004-http-api/): the application layer that uses this engine.
- [Self-hosting](/docs/self-hosting/) and [Integrations](/docs/integrations/).
