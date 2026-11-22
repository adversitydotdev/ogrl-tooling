import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import { renderFigure } from "../src/diagrams.mjs";
import {
  SPEC_SITE,
  renderDocPage,
  renderDocsIndexPage,
  renderIndexPage,
  renderNotFoundPage,
  renderRfcPage,
  renderRfcsIndexPage,
} from "../src/template.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const DIST_DIR = path.join(ROOT, "dist");
// Sibling checkout of the language spec, used to validate links into ogrl.adversity.dev.
const SPEC_RFCS_DIR = path.resolve(ROOT, "..", "ogrl-rfcs", "rfcs");

// Display order and index-card copy for docs pages. Unlisted docs sort last, alphabetically.
const DOCS = {
  "self-hosting": { kicker: "Application", tagline: "Run the API, job worker, and web UI locally or on AWS." },
  cli: { kicker: "ogrl CLI", tagline: "Lint, format, import, evaluate, diff, and render OSCAL from the command line." },
  "integration-sdk": { kicker: "SDK", tagline: "Write, test, and package integrations that collect vendor snapshots." },
  integrations: { kicker: "Integrations", tagline: "Okta, GitHub, and AWS: setup, resources, and check templates." },
  "live-evidence": {
    kicker: "Live evidence",
    tagline: "How connections, query sources, and tests turn vendor data into control status.",
  },
};

function escHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// HTML entities are dropped here; ogrl-rfcs keeps their letters ("&amp;" -> "amp"), so spec
// anchors are checked with `specSlug` instead.
function slugify(text) {
  return specSlug(text.replace(/&[a-z]+;|&#\d+;/g, ""));
}

function specSlug(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/`/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function highlightYaml(code) {
  return code
    .split("\n")
    .map((line) => {
      if (/^\s*#/.test(line)) {
        return `<span class="tok-comment">${escHtml(line)}</span>`;
      }
      let main = line;
      let comment = "";
      const commentMatch = line.match(/^([^"']*?)(\s+#.*)$/);
      if (commentMatch) {
        main = commentMatch[1];
        comment = `<span class="tok-comment">${escHtml(commentMatch[2])}</span>`;
      }
      const kv = main.match(/^(\s*(?:-\s+)?)([A-Za-z0-9_.$-]+)(:)(\s*)(.*)$/);
      if (kv) {
        const [, indent, key, colon, space, val] = kv;
        let renderedVal = escHtml(val);
        if (/^".*"$|^'.*'$/.test(val)) {
          renderedVal = `<span class="tok-str">${escHtml(val)}</span>`;
        } else if (/^(true|false|\d+(?:\.\d+)?)$/.test(val)) {
          renderedVal = `<span class="tok-num">${escHtml(val)}</span>`;
        }
        return `${escHtml(indent)}<span class="tok-key">${escHtml(key)}</span>${colon}${space}${renderedVal}${comment}`;
      }
      return `${escHtml(main)}${comment}`;
    })
    .join("\n");
}

function stripTitleAndMeta(markdown) {
  const lines = markdown.split("\n");
  let i = 0;
  let fullTitle = "";
  if (lines[i]?.startsWith("# ")) {
    fullTitle = lines[i].slice(2).trim();
    i++;
  }
  while (i < lines.length && lines[i].trim() === "") i++;

  const meta = {};
  if (lines[i]?.startsWith("|") && lines[i + 1]?.startsWith("|---")) {
    i += 2;
    while (i < lines.length && lines[i].startsWith("|")) {
      const cells = lines[i]
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.length >= 2 && cells[0]) meta[cells[0]] = cells[1];
      i++;
    }
  }
  while (i < lines.length && lines[i].trim() === "") i++;
  return { fullTitle, meta, bodyMarkdown: lines.slice(i).join("\n") };
}

function extractSummary(bodyMarkdown) {
  const paragraphs = bodyMarkdown
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith("```"));
  if (!paragraphs.length) return "";
  return paragraphs[0]
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/(^|\W)_+|_+(?=\W|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Relative Markdown links (as written for GitHub) become site paths.
function rewriteHref(href) {
  if (!href) return href;
  const rfc = href.match(/^(?:\.\.\/rfcs\/|\.\/)?(\d{4}-[a-z0-9-]+)\.md(#.*)?$/);
  if (rfc) return `/rfcs/${rfc[1]}/${rfc[2] || ""}`;
  const doc = href.match(/^(?:\.\.\/docs\/|\.\/)?([a-z][a-z0-9-]*)\.md(#.*)?$/);
  if (doc) return `/docs/${doc[1]}/${doc[2] || ""}`;
  return href;
}

function parseDependsOn(raw) {
  if (!raw) return [];
  const results = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const href = rewriteHref(m[2].trim());
    results.push({ label: m[1].trim(), href, external: /^https?:\/\//.test(href) });
  }
  return results;
}

function inlineRenderer() {
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      link({ href, tokens }) {
        const rewritten = rewriteHref(href);
        const ext = /^https?:\/\//.test(rewritten) ? ' target="_blank" rel="noopener noreferrer"' : "";
        return `<a href="${escHtml(rewritten)}"${ext}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  return (text) => md.parseInline(text);
}

function loadCollection(kind, outboundLinks, headingIds) {
  const dir = path.join(ROOT, kind);
  const inlineMeta = inlineRenderer();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  const items = [];

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const key = `/${kind}/${slug}/`;
    const raw = fs.readFileSync(path.join(dir, file), "utf-8");
    const { fullTitle, meta, bodyMarkdown } = stripTitleAndMeta(raw);

    const numMatch = fullTitle.match(/^RFC\s+(\d+):\s*(.+)$/);
    const number = numMatch ? numMatch[1] : null;
    const shortTitle = numMatch ? numMatch[2].trim() : fullTitle;
    const words = bodyMarkdown.split(/\s+/).filter(Boolean).length;

    const toc = [];
    const seenIds = new Set();
    const marked = new Marked({ gfm: true, breaks: false });
    marked.use({
      renderer: {
        heading({ tokens, depth }) {
          const inner = this.parser.parseInline(tokens);
          const plain = inner.replace(/<[^>]+>/g, "");
          const base = slugify(plain);
          let id = base;
          let n = 2;
          while (seenIds.has(id)) id = `${base}-${n++}`;
          seenIds.add(id);
          if (depth === 2 || depth === 3) toc.push({ depth, id, text: plain.replace(/&amp;/g, "&") });
          return `<h${depth} id="${id}"><a class="heading-anchor" href="#${id}" aria-label="Link to ${escHtml(plain)}">#</a>${inner}</h${depth}>\n`;
        },
        code({ text, lang }) {
          const language = (lang || "text").trim().toLowerCase();
          const highlighted =
            language === "yaml" || language === "yml" ? highlightYaml(text) : escHtml(text);
          return `<div class="code-block">
  <div class="code-block-head">
    <span class="code-lang">${escHtml(language)}</span>
    <button class="copy-btn" type="button">Copy</button>
  </div>
  <pre><code>${highlighted}</code></pre>
</div>\n`;
        },
        table(token) {
          const head = token.header
            .map((cell) => `<th>${this.parser.parseInline(cell.tokens)}</th>`)
            .join("");
          const rows = token.rows
            .map(
              (row) =>
                `<tr>${row.map((cell) => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join("")}</tr>`,
            )
            .join("\n");
          return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
        },
        link({ href, title, tokens }) {
          const rewritten = rewriteHref(href);
          outboundLinks.push({ from: key, href: rewritten });
          const text = this.parser.parseInline(tokens);
          const titleAttr = title ? ` title="${escHtml(title)}"` : "";
          const ext = /^https?:\/\//.test(rewritten) ? ' target="_blank" rel="noopener noreferrer"' : "";
          return `<a href="${escHtml(rewritten)}"${titleAttr}${ext}>${text}</a>`;
        },
      },
    });

    // `<!-- figure: <id> -->` places an inline SVG figure from src/diagrams.mjs.
    const html = marked
      .parse(bodyMarkdown)
      .replace(/<!--\s*figure:\s*([a-z0-9-]+)\s*-->/g, (_, id) => renderFigure(id));
    headingIds.set(key, seenIds);

    items.push({
      kind,
      file,
      slug,
      number,
      fullTitle,
      shortTitle,
      summary: extractSummary(bodyMarkdown),
      meta,
      inlineMeta,
      dependsOn: parseDependsOn(meta["Depends on"]),
      readingMinutes: Math.max(1, Math.round(words / 230)),
      toc,
      html,
      raw,
      ...(kind === "docs" ? DOCS[slug] || { kicker: "Docs" } : {}),
    });
  }

  if (kind === "docs") {
    const order = Object.keys(DOCS);
    const rank = (s) => (order.includes(s) ? order.indexOf(s) : order.length);
    items.sort((a, b) => rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug));
  } else {
    items.sort((a, b) => a.slug.localeCompare(b.slug));
  }
  return items;
}

// Heading ids of the language spec RFCs, from a sibling ogrl-rfcs checkout when present.
function loadSpecHeadingIds() {
  if (!fs.existsSync(SPEC_RFCS_DIR)) return null;
  const ids = new Map();
  for (const file of fs.readdirSync(SPEC_RFCS_DIR).filter((f) => f.endsWith(".md"))) {
    const seen = new Set();
    const md = fs.readFileSync(path.join(SPEC_RFCS_DIR, file), "utf-8").replace(/```[\s\S]*?```/g, "");
    for (const m of md.matchAll(/^#{1,6}\s+(.+)$/gm)) {
      const base = specSlug(new Marked().parseInline(m[1]));
      let id = base;
      let n = 2;
      while (seen.has(id)) id = `${base}-${n++}`;
      seen.add(id);
    }
    ids.set(file.replace(/\.md$/, ""), seen);
  }
  return ids;
}

function validateLinks(outboundLinks, headingIds) {
  const broken = [];
  const warnings = [];
  const specIds = loadSpecHeadingIds();

  for (const { from, href } of outboundLinks) {
    if (href.startsWith("#")) {
      if (!headingIds.get(from)?.has(href.slice(1))) broken.push(`${from}: broken local anchor ${href}`);
      continue;
    }
    const site = href.match(/^\/(rfcs|docs)\/([^/#]+)\/(?:#(.+))?$/);
    if (site) {
      const [, kind, slug, anchor] = site;
      const ids = headingIds.get(`/${kind}/${slug}/`);
      if (!ids) broken.push(`${from}: unknown page ${href}`);
      else if (anchor && !ids.has(anchor)) broken.push(`${from}: broken anchor ${href}`);
      continue;
    }
    if (/^\/(rfcs|docs)\//.test(href) || /\.md(#|$)/.test(href) && !/^https?:/.test(href)) {
      broken.push(`${from}: unresolved relative link ${href}`);
      continue;
    }
    const spec = href.match(/^https:\/\/ogrl\.adversity\.dev\/rfcs\/([^/#]+)\/(?:#(.+))?$/);
    if (spec && specIds) {
      const [, slug, anchor] = spec;
      const ids = specIds.get(slug);
      if (!ids) warnings.push(`${from}: unknown spec RFC ${href}`);
      else if (anchor && !ids.has(anchor)) warnings.push(`${from}: spec anchor not found ${href}`);
    }
  }

  for (const w of warnings) console.warn(`warning: ${w} (checked against ../ogrl-rfcs)`);
  if (broken.length > 0) throw new Error(`Broken links detected:\n  - ${broken.join("\n  - ")}`);
}

export function build() {
  const outboundLinks = [];
  const headingIds = new Map();
  const rfcs = loadCollection("rfcs", outboundLinks, headingIds);
  const docs = loadCollection("docs", outboundLinks, headingIds);
  // Links on index cards are hand-written in the template; only Markdown bodies are validated.
  validateLinks(outboundLinks, headingIds);

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  for (const d of ["assets", "rfcs", "docs"]) fs.mkdirSync(path.join(DIST_DIR, d), { recursive: true });

  fs.copyFileSync(path.join(SRC_DIR, "styles.css"), path.join(DIST_DIR, "assets", "styles.css"));
  fs.copyFileSync(path.join(SRC_DIR, "client.js"), path.join(DIST_DIR, "assets", "client.js"));
  fs.copyFileSync(path.join(SRC_DIR, "favicon.svg"), path.join(DIST_DIR, "favicon.svg"));

  const write = (rel, html) => fs.writeFileSync(path.join(DIST_DIR, rel), html, "utf-8");
  write("index.html", renderIndexPage({ docs, rfcs }));
  write("404.html", renderNotFoundPage());
  write("docs/index.html", renderDocsIndexPage({ docs }));
  write("rfcs/index.html", renderRfcsIndexPage({ rfcs }));

  for (const [kind, items, render] of [
    ["rfcs", rfcs, renderRfcPage],
    ["docs", docs, renderDocPage],
  ]) {
    items.forEach((item, index) => {
      fs.mkdirSync(path.join(DIST_DIR, kind, item.slug), { recursive: true });
      write(`${kind}/${item.slug}/index.html`, render(item, items, index));
      write(`${kind}/${item.slug}.md`, item.raw);
    });
  }

  console.log(`Built ${docs.length} docs + ${rfcs.length} RFCs into ${path.relative(ROOT, DIST_DIR)}/ (spec: ${SPEC_SITE})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build();
}
