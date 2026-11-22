# OGRL Tooling

Documentation and RFCs for the tools built on **OGRL** (*Open Governance Reference Language*), published at [tools.adversity.dev](https://tools.adversity.dev).

The language itself (RFC 0001 object model, RFC 0002 sources of truth) and the standard library are published separately at [ogrl.adversity.dev](https://ogrl.adversity.dev) from [`ogrl-rfcs`](https://github.com/adversitydotdev/ogrl-rfcs). This repository covers the software around it.

## Documentation

- [Self-hosting the OGRL application](docs/self-hosting.md)
- [The ogrl CLI](docs/cli.md)
- [Integration SDK](docs/integration-sdk.md)
- [First-party integrations](docs/integrations.md)

## RFCs

Tooling RFCs continue the spec's numbering.

- [RFC 0003: Application Architecture](rfcs/0003-application.md)
- [RFC 0004: HTTP API](rfcs/0004-http-api.md)
- [RFC 0005: Integrations](rfcs/0005-integrations.md)
- [RFC 0006: Query Sources](rfcs/0006-query-sources.md)
- [RFC 0007: Smithy Query Sources](rfcs/0007-smithy-query-sources.md)

## Local development

```bash
pnpm install
pnpm dev      # builds and serves on http://localhost:4174 with file watching
pnpm build    # generates static site in dist/
pnpm deploy   # builds and deploys to Cloudflare Workers (tools.adversity.dev)
```

The build compiles `docs/*.md` and `rfcs/*.md` into static HTML under `dist/` (with raw Markdown copies beside each page) and fails if any internal or cross-page anchor link does not resolve. Links into the spec site are checked against a sibling `../ogrl-rfcs` checkout when one exists.

## AI assistance

These documents and the site code were drafted and edited with help from AI tools (Anthropic Claude). The human author directs the design and is responsible for all content.

Review is still in progress. While an RFC has **Draft** status, its text may not have been fully human-reviewed yet. Treat it as a proposal and [open an issue](https://github.com/adversitydotdev/ogrl-tooling/issues) for any errors.
