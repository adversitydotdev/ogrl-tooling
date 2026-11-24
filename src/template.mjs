export const SPEC_SITE = "https://ogrl.adversity.dev";
export const GITHUB_ORG = "https://github.com/adversitydotdev";

function esc(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const EXT = ' target="_blank" rel="noopener noreferrer"';

// Index rows show whole sentences up to roughly `max` characters.
function blurb(text, max = 260) {
  if (text.length <= max) return text;
  let out = "";
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    if (out && out.length + s.length + 1 > max) break;
    out = out ? `${out} ${s}` : s;
  }
  return out.length > max ? `${out.slice(0, max).replace(/\s+\S*$/, "")}…` : out;
}

const OGRL_MARK_SVG = `<svg viewBox="0 0 32 32" width="24" height="24" fill="none" aria-hidden="true"><path d="M26.2 16V20.2C26.2 23.51 23.51 26.2 20.2 26.2H11.8C8.49 26.2 5.8 23.51 5.8 20.2V11.8C5.8 8.49 8.49 5.8 11.8 5.8H20.2C22.4 5.8 24.32 6.98 25.36 8.75" stroke="currentColor" stroke-width="3.8" stroke-linecap="butt"/><path d="M15.2 16H28.1" stroke="currentColor" stroke-width="3.8" stroke-linecap="butt"/></svg>`;

const THEME_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41"/></svg>`;

const GITHUB_REPO = "adversitydotdev/ogrl-tooling";

const GITHUB_SVG = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

const STAR_SVG = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/></svg>`;

const THEME_INIT_SCRIPT = `<script>(function(){try{var s=localStorage.getItem("ogrl-tools-theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();</script>`;

const REPOS = [
  {
    name: "ogrl-rs",
    kind: "CLI · Rust",
    role: "The ogrl CLI and ogrl_rs Python wheel: lint, format, import, evaluate, diff, and render OSCAL.",
    doc: "/docs/cli/",
  },
  {
    name: "fathom",
    kind: "Application · Python",
    role: "Fathom, the self-hosted application: HTTP API, job worker, web UI, agents, and integration host.",
    doc: "/docs/self-hosting/",
  },
  {
    name: "ogrl-integration-sdk",
    kind: "SDK · Python",
    role: "Library and CLI for writing, testing, and packaging integrations.",
    doc: "/docs/integration-sdk/",
  },
  {
    name: "ogrl-okta",
    kind: "Integration",
    role: "Collects identity-provider snapshots from Okta.",
    doc: "/docs/integrations/",
  },
  {
    name: "ogrl-github",
    kind: "Integration",
    role: "Collects source-host snapshots from GitHub.",
    doc: "/docs/integrations/",
  },
  {
    name: "ogrl-aws",
    kind: "Integration",
    role: "Collects cloud-account snapshots from AWS through a read-only role.",
    doc: "/docs/integrations/",
  },
];

function renderHeader({ currentPath, activeNav, sub, rawHref }) {
  const link = (href, label, key) =>
    `<a class="nav-link" href="${href}"${activeNav === key ? ' aria-current="page"' : ""}>${label}</a>`;

  return `<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="/">
      <span class="brand-mark">${OGRL_MARK_SVG}</span>
      <span class="brand-wordmark">OGRL</span>
      <span class="brand-sep">/</span>
      <span class="brand-sub">${esc(sub)}</span>
    </a>
    <nav class="header-nav" aria-label="Primary">
      ${link("/", "Index", "index")}
      ${link("/docs/", "Docs", "docs")}
      ${link("/rfcs/", "RFCs", "rfcs")}
      <a class="nav-link" href="${SPEC_SITE}/"${EXT} title="OGRL language specification">Spec ↗</a>
    </nav>
    <div class="header-actions">
      ${rawHref ? `<a class="icon-btn" href="${rawHref}" title="Download raw Markdown">Raw .md</a>` : ""}
      <a class="icon-btn gh-btn" href="https://github.com/${GITHUB_REPO}" target="_blank" rel="noopener noreferrer" title="View on GitHub" aria-label="ogrl-tooling on GitHub" data-gh-repo="${GITHUB_REPO}">${GITHUB_SVG}<span class="gh-stars" hidden>${STAR_SVG}<span class="gh-star-count"></span></span></a>
      <button id="theme-toggle" class="icon-btn icon-btn--square" type="button" aria-label="Toggle color theme">${THEME_SVG}</button>
    </div>
  </div>
</header>`;
}

function renderShell({ title, description, activeNav, sub = "Tooling", rawHref = null, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&family=Geist:wght@400;500;600&family=Spectral:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet" />
  ${THEME_INIT_SCRIPT}
  <link rel="stylesheet" href="/assets/styles.css" />
</head>
<body>
  ${renderHeader({ activeNav, sub, rawHref })}
  ${body}
  <footer class="site-footer">
    <div class="footer-inner">
      <span>OGRL Tooling · Docs &amp; RFCs for tools built on the Open Governance Reference Language</span>
      <span>Drafted with AI assistance; human review in progress · <a href="${GITHUB_ORG}/ogrl-tooling#ai-assistance"${EXT}>Details</a></span>
      <span class="footer-links">
        <a href="/docs/">Docs</a>
        <span aria-hidden="true">·</span>
        <a href="/rfcs/">RFCs</a>
        <span aria-hidden="true">·</span>
        <a href="${SPEC_SITE}/"${EXT}>Language spec</a>
        <span aria-hidden="true">·</span>
        <a href="${SPEC_SITE}/library/"${EXT}>Standard library</a>
        <span aria-hidden="true">·</span>
        <a href="${GITHUB_ORG}"${EXT}>GitHub</a>
      </span>
    </div>
  </footer>
  <script src="/assets/client.js" defer></script>
</body>
</html>`;
}

function specCallout() {
  return `<aside class="spec-callout" aria-label="Looking for the language specification?">
  <div class="spec-callout-text">
    <span class="layer-step">Language &amp; taxonomy</span>
    <p>
      The OGRL object model, sources-of-truth rules (RFC 0001–0002), and the standard control
      library are published separately at <a href="${SPEC_SITE}/"${EXT}>ogrl.adversity.dev</a>.
      This site covers the tools built on top of them.
    </p>
  </div>
  <a class="icon-btn" href="${SPEC_SITE}/"${EXT}>Read the spec ↗</a>
</aside>`;
}

function docRow(d) {
  const repo = d.meta.Repository || d.meta.Repositories || "";
  return `<article class="rfc-row">
  <div class="rfc-row-num">DOC</div>
  <div>
    <h2 class="rfc-row-title"><a href="/docs/${d.slug}/">${esc(d.shortTitle)}</a></h2>
    <p class="rfc-row-summary">${esc(blurb(d.summary))}</p>
    <div class="rfc-row-meta">
      ${d.meta.Version ? `<span class="status-pill">v${esc(d.meta.Version.replace(/^v/, ""))}</span>` : ""}
      ${repo ? `<span>${d.inlineMeta(repo)}</span>` : ""}
      <span>${d.readingMinutes} min read</span>
    </div>
  </div>
  <div class="rfc-row-actions">
    <a class="icon-btn" href="/docs/${d.slug}.md">Raw .md</a>
  </div>
</article>`;
}

function rfcRow(r) {
  const deps =
    r.dependsOn.length > 0
      ? `<span>Depends on ${r.dependsOn
          .map((d) => `<a href="${esc(d.href)}"${d.external ? EXT : ""}>${esc(d.label)}${d.external ? " ↗" : ""}</a>`)
          .join(", ")}</span>`
      : "";
  return `<article class="rfc-row">
  <div class="rfc-row-num">RFC ${esc(r.number)}</div>
  <div>
    <h2 class="rfc-row-title"><a href="/rfcs/${r.slug}/">${esc(r.shortTitle)}</a></h2>
    <p class="rfc-row-summary">${esc(blurb(r.summary))}</p>
    <div class="rfc-row-meta">
      <span class="status-pill">${esc(r.meta.Status || "Draft")}</span>
      <span>${esc(r.meta.Date || "")}</span>
      <span>${r.readingMinutes} min read</span>
      ${deps}
    </div>
  </div>
  <div class="rfc-row-actions">
    <a class="icon-btn" href="/rfcs/${r.slug}.md">Raw .md</a>
  </div>
</article>`;
}

function hero(eyebrow, title, lede) {
  return `<section class="hero-band">
  <div class="hero-inner">
    <p class="eyebrow">${eyebrow}</p>
    <h1 class="hero-title">${title}</h1>
    <p class="hero-lede">${lede}</p>
  </div>
</section>`;
}

export function renderIndexPage({ docs, rfcs }) {
  const layerStrip = `<section class="layer-strip layer-strip--4" aria-label="Tooling documentation">
  ${docs
    .map(
      (d) => `<a class="layer-card" href="/docs/${d.slug}/">
    <div class="layer-step">${esc(d.kicker)}</div>
    <div class="layer-name">${esc(d.shortTitle)}</div>
    <div class="layer-role">${esc(d.tagline || d.summary)}</div>
  </a>`,
    )
    .join("\n")}
</section>`;

  const repoCards = REPOS.map(
    (r) => `<a class="lib-fw-card repo-card" href="${GITHUB_ORG}/${r.name}"${EXT}>
  <div class="lib-fw-top">
    <span class="layer-step">${esc(r.kind)}</span>
    <span class="lib-tag">GitHub ↗</span>
  </div>
  <div class="lib-fw-name">${esc(r.name)}</div>
  <div class="lib-fw-id"><code>adversitydotdev/${esc(r.name)}</code></div>
  <div class="layer-role">${esc(r.role)}</div>
</a>`,
  ).join("\n");

  const body = `${hero(
    "OGRL Tooling · Documentation &amp; Request for Comments",
    "Tools for running an OGRL program.",
    `The OGRL language is a spec. This site documents the software built on it: the <code>ogrl</code>
      CLI, Fathom (the self-hosted application) and its HTTP API, the integration SDK, and first-party
      integrations that collect live evidence from vendor systems. Design changes to these tools are
      proposed here as RFCs.`,
  )}
<main class="index-main">
  ${specCallout()}
  ${layerStrip}
  <h2 class="section-heading">Documentation (${docs.length})</h2>
  <section class="rfc-list" aria-label="Documentation">
    ${docs.map(docRow).join("\n")}
  </section>
  <h2 class="section-heading section-heading--spaced">Tooling RFCs (${rfcs.length})</h2>
  <section class="rfc-list" aria-label="Tooling RFCs">
    ${rfcs.map(rfcRow).join("\n")}
  </section>
  <h2 class="section-heading section-heading--spaced">Repositories (${REPOS.length})</h2>
  <section class="lib-fw-grid lib-fw-grid--3" aria-label="Repositories">
    ${repoCards}
  </section>
</main>`;

  return renderShell({
    title: "OGRL Tooling — Docs & RFCs",
    description:
      "Documentation and RFCs for OGRL tooling: the ogrl CLI, the Fathom self-hosted application, the integration SDK, and first-party integrations.",
    activeNav: "index",
    body,
  });
}

export function renderDocsIndexPage({ docs }) {
  const body = `${hero(
    "OGRL Tooling · Documentation",
    "Documentation.",
    "Install, operate, and extend OGRL tooling. Each page tracks the repository it documents.",
  )}
<main class="index-main">
  <section class="rfc-list" aria-label="Documentation">
    ${docs.map(docRow).join("\n")}
  </section>
</main>`;
  return renderShell({
    title: "Docs · OGRL Tooling",
    description: "Documentation for OGRL tooling.",
    activeNav: "docs",
    sub: "Docs",
    body,
  });
}

export function renderRfcsIndexPage({ rfcs }) {
  const body = `${hero(
    "OGRL Tooling · Request for Comments",
    "Tooling RFCs.",
    `Design proposals for the Fathom application, HTTP API, integrations, and query sources. Language
      RFCs (0001–0002) live on the <a href="${SPEC_SITE}/"${EXT}>specification site</a>; tooling RFCs
      continue the same numbering.`,
  )}
<main class="index-main">
  <section class="rfc-list" aria-label="Tooling RFCs">
    ${rfcs.map(rfcRow).join("\n")}
  </section>
</main>`;
  return renderShell({
    title: "RFCs · OGRL Tooling",
    description: "Request for Comments for OGRL tooling.",
    activeNav: "rfcs",
    sub: "RFCs",
    body,
  });
}

function renderDocument({ item, items, index, kind }) {
  const isRfc = kind === "rfcs";
  const prev = index > 0 ? items[index - 1] : null;
  const next = index < items.length - 1 ? items[index + 1] : null;
  const label = (x) => (isRfc ? `RFC ${x.number}: ${x.shortTitle}` : x.shortTitle);

  const metaItems = [];
  if (isRfc) {
    metaItems.push(
      { label: "Status", html: `<span class="status-pill">${esc(item.meta.Status || "Draft")}</span>` },
      { label: "Date", html: esc(item.meta.Date || "") },
      { label: "Reading time", html: `${item.readingMinutes} min` },
    );
    if (item.dependsOn.length > 0) {
      metaItems.push({
        label: "Depends on",
        html: item.dependsOn
          .map((d) => `<a href="${esc(d.href)}"${d.external ? EXT : ""}>${esc(d.label)}</a>`)
          .join(", "),
      });
    }
  } else {
    for (const [k, v] of Object.entries(item.meta)) {
      metaItems.push({ label: k, html: item.inlineMeta(v) });
    }
    metaItems.push({ label: "Reading time", html: `${item.readingMinutes} min` });
  }

  const tocList = item.toc
    .map((t) => `<li class="toc-depth-${t.depth}"><a href="#${esc(t.id)}">${esc(t.text)}</a></li>`)
    .join("\n");

  const pagerLink = (x, dir) =>
    x
      ? `<a class="pager-link${dir === "next" ? " pager-link--next" : ""}" href="/${kind}/${x.slug}/">
    <span class="pager-dir">${dir === "next" ? "Next →" : "← Previous"}</span>
    <span class="pager-title">${esc(label(x))}</span>
  </a>`
      : "";
  const pager =
    prev || next
      ? `<nav class="doc-pager" aria-label="Adjacent pages">
  ${pagerLink(prev, "prev")}
  ${pagerLink(next, "next")}
</nav>`
      : "";

  const body = `<section class="hero-band">
  <div class="doc-header-inner">
    <p class="eyebrow">${isRfc ? `RFC ${esc(item.number)}` : "Documentation"}</p>
    <h1 class="doc-title">${esc(item.shortTitle)}</h1>
    <div class="meta-bar">
      ${metaItems
        .map(
          (m) => `<div class="meta-item">
        <span class="meta-label">${esc(m.label)}</span>
        <span class="meta-value">${m.html}</span>
      </div>`,
        )
        .join("\n")}
    </div>
  </div>
</section>
<div class="doc-shell">
  <main>
    <details class="mobile-toc">
      <summary>On this page</summary>
      <ul>${tocList}</ul>
    </details>
    <article class="prose">
      ${item.html}
      ${pager}
    </article>
  </main>
  <aside class="doc-toc" aria-label="Table of contents">
    <p class="toc-heading">On this page</p>
    <ul>
      ${tocList}
    </ul>
  </aside>
</div>`;

  return renderShell({
    title: `${label(item)} · OGRL Tooling`,
    description: item.summary,
    activeNav: kind,
    sub: isRfc ? "RFCs" : "Docs",
    rawHref: `/${kind}/${item.slug}.md`,
    body,
  });
}

export const renderRfcPage = (item, items, index) =>
  renderDocument({ item, items, index, kind: "rfcs" });
export const renderDocPage = (item, items, index) =>
  renderDocument({ item, items, index, kind: "docs" });

export function renderNotFoundPage() {
  const body = hero(
    "404 · Not Found",
    "Page not found.",
    `The requested page does not exist. Return to the <a href="/">index</a>, browse the
      <a href="/docs/">docs</a>, or read the <a href="${SPEC_SITE}/"${EXT}>language specification</a>.`,
  );
  return renderShell({
    title: "404 · OGRL Tooling",
    description: "Page not found.",
    activeNav: "none",
    body,
  });
}
