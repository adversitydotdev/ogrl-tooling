// Inline SVG figures for docs and RFC pages, in the style of ogrl-rfcs (src/diagrams.mjs there).
// Place one in Markdown with `<!-- figure: <id> -->`. Marker ids are prefixed per figure because
// several figures share a page and SVG ids are document-global.

const arrow = (id, color = "var(--fg-faint)") =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill="${color}"/>
    </marker>`;

const node = (x, y, w, h, title, sub, cls = "") => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" class="svg-node ${cls}"/>
  <text x="${x + w / 2}" y="${y + (sub ? h / 2 - 3 : h / 2 + 4)}" text-anchor="middle" class="svg-node-title">${title}</text>${
    sub ? `\n  <text x="${x + w / 2}" y="${y + h / 2 + 13}" text-anchor="middle" class="svg-node-sub">${sub}</text>` : ""
  }`;

const pill = (x, y, w, text, cls = "svg-pill-neutral", ink = "") => `
  <rect x="${x}" y="${y}" width="${w}" height="26" rx="5" class="${cls}"/>
  <text x="${x + w / 2}" y="${y + 17}" text-anchor="middle" class="svg-mono-sm ${ink}">${text}</text>`;

export const FIGURES = {
  "evidence-pipeline": {
    number: "1",
    caption:
      "From a vendor account to control status. The test names a <em>source</em>, never a connection; the implementation it runs against decides which connections are read. Built-in resources and query sources reach the snapshot the same way.",
    html: `<svg viewBox="0 0 860 318" class="rfc-svg" role="img" aria-label="Integration, connection, snapshot, test, and result, with query sources, bindings, and implementations">
  <defs>
    ${arrow("ep-a")}
    ${arrow("ep-g", "var(--met)")}
    ${arrow("ep-b", "var(--contribution)")}
  </defs>

  <rect x="10" y="10" width="502" height="298" rx="10" class="svg-zone-lib"/>
  <text x="26" y="32" class="svg-eyebrow svg-ink-blue">VENDOR SIDE · INTEGRATIONS (RFC 0005–0007)</text>
  <rect x="522" y="10" width="328" height="298" rx="10" class="svg-zone-org"/>
  <text x="538" y="32" class="svg-eyebrow">PROGRAM SIDE · OGRL OBJECTS (RFC 0001)</text>
${node(26, 52, 150, 56, "integration", "resources · API model", "svg-node-accent")}
${node(196, 52, 150, 56, "connection", "one account · config · secrets")}
${node(366, 52, 136, 56, "snapshot", "one source × connection")}
${node(538, 52, 140, 56, "rule test", "source + select / assert")}
${node(698, 52, 140, 56, "result", "outcome + evidence", "svg-node-green")}

  <line x1="176" y1="80" x2="194" y2="80" class="svg-edge" marker-end="url(#ep-a)"/>
  <line x1="346" y1="80" x2="364" y2="80" class="svg-edge" marker-end="url(#ep-a)"/>
  <line x1="502" y1="80" x2="536" y2="80" class="svg-edge-green" marker-end="url(#ep-g)"/>
  <line x1="678" y1="80" x2="696" y2="80" class="svg-edge-green" marker-end="url(#ep-g)"/>
  <text x="356" y="46" text-anchor="middle" class="svg-label">collect</text>
  <text x="519" y="70" text-anchor="middle" class="svg-label">read</text>
  <text x="688" y="46" text-anchor="middle" class="svg-label">record</text>
${node(26, 176, 150, 56, "query source", "org-defined: operation + fields")}
  <line x1="101" y1="176" x2="101" y2="110" class="svg-edge-blue" marker-end="url(#ep-b)"/>
  <text x="108" y="148" class="svg-label">defined over the API model</text>
  <path d="M 176 204 L 434 204 L 434 110" class="svg-edge-blue" fill="none" marker-end="url(#ep-b)"/>
  <text x="300" y="196" text-anchor="middle" class="svg-label">collected like a built-in resource</text>
${node(196, 248, 150, 50, "component / system", "the binding target")}
  <path d="M 271 108 L 271 128 L 230 128 L 230 246" class="svg-edge" fill="none" marker-end="url(#ep-a)"/>
  <text x="238" y="160" class="svg-label">bound to</text>
${node(538, 176, 140, 56, "implementation", "control × scope", "svg-node-green")}
  <line x1="608" y1="176" x2="608" y2="110" class="svg-edge" marker-end="url(#ep-a)"/>
  <text x="614" y="148" class="svg-label">run against</text>
  <path d="M 346 273 L 608 273 L 608 234" class="svg-edge" fill="none" marker-end="url(#ep-a)"/>
  <text x="470" y="266" text-anchor="middle" class="svg-label">its scope picks the connections</text>
${node(698, 176, 140, 56, "control status", "met · gap · waived")}
  <line x1="768" y1="110" x2="768" y2="174" class="svg-edge-green" marker-end="url(#ep-g)"/>
</svg>`,
  },

  bindings: {
    number: "2",
    caption:
      "Bindings decide what a run reads. An implementation on a component reads connections bound to that component; one on a system also reads connections bound to the system's components. Several matching connections are combined in binding order. Disabled connections are skipped.",
    html: `<svg viewBox="0 0 860 330" class="rfc-svg" role="img" aria-label="Connections bound to components and systems, and which connections two implementations read">
  <defs>
    ${arrow("bd-a")}
    ${arrow("bd-g", "var(--met)")}
  </defs>
  <text x="20" y="26" class="svg-eyebrow">CONNECTIONS</text>
  <text x="300" y="26" class="svg-eyebrow">BINDING TARGETS</text>
  <text x="620" y="26" class="svg-eyebrow">IMPLEMENTATIONS · WHAT THEY READ</text>
${node(20, 44, 200, 46, "Okta production", "dev.adversity.okta")}
${node(20, 110, 200, 46, "AWS production", "dev.adversity.aws · account 1")}
${node(20, 176, 200, 46, "AWS staging", "dev.adversity.aws · account 2")}
${node(20, 256, 200, 46, "AWS sandbox", "disabled · never read", "svg-box-subtle")}

  <rect x="280" y="36" width="270" height="200" rx="10" class="svg-zone-org"/>
  <text x="296" y="58" class="svg-eyebrow">SYSTEM · ACME PLATFORM</text>
${node(300, 70, 230, 40, "component · Okta", "")}
${node(300, 124, 230, 40, "component · AWS prod", "")}
${node(300, 178, 230, 40, "component · AWS staging", "")}
${node(300, 260, 230, 40, "component · Sandbox", "")}

  <line x1="220" y1="67" x2="298" y2="90" class="svg-edge" marker-end="url(#bd-a)"/>
  <line x1="220" y1="133" x2="298" y2="144" class="svg-edge" marker-end="url(#bd-a)"/>
  <line x1="220" y1="199" x2="298" y2="198" class="svg-edge" marker-end="url(#bd-a)"/>
  <line x1="220" y1="279" x2="298" y2="280" class="svg-guide"/>

${node(612, 52, 236, 70, "AC-05 on component Okta", "reads okta/users@1 from", "svg-node-green")}
  <text x="730" y="114" text-anchor="middle" class="svg-mono-xs svg-ink-green">Okta production</text>
  <rect x="612" y="150" width="236" height="90" rx="7" class="svg-node svg-node-green"/>
  <text x="730" y="172" text-anchor="middle" class="svg-node-title">CR-01 on system Acme Platform</text>
  <text x="730" y="190" text-anchor="middle" class="svg-node-sub">reads aws/s3-encryption@1 from</text>
  <text x="730" y="208" text-anchor="middle" class="svg-mono-xs svg-ink-green">AWS production, then AWS staging</text>
  <text x="730" y="226" text-anchor="middle" class="svg-node-sub">items combined in binding order</text>

  <line x1="530" y1="90" x2="610" y2="87" class="svg-edge-green" marker-end="url(#bd-g)"/>
  <path d="M 530 144 L 578 144 L 578 195 L 610 195" class="svg-edge-green" fill="none" marker-end="url(#bd-g)"/>
  <path d="M 530 198 L 578 198" class="svg-edge-green" fill="none"/>
  <text x="612" y="262" class="svg-caption-inline">systems include their components</text>
</svg>`,
  },

  "test-run": {
    number: "3",
    caption:
      "One run of a rule test against one implementation. Fresh means newer than both the test interval's window and <code>OGRL_SNAPSHOT_REUSE</code> (one hour by default). Every path that cannot vouch for its data records <code>error</code>, never <code>pass</code>.",
    html: `<svg viewBox="0 0 860 300" class="rfc-svg" role="img" aria-label="Steps of a test run: find connections, choose or collect a snapshot, check it, evaluate, record">
  <defs>
    ${arrow("tr-a")}
    ${arrow("tr-r", "var(--gap)")}
    ${arrow("tr-g", "var(--met)")}
  </defs>
${node(16, 40, 148, 64, "1 · find connections", "bound to the scope, per source")}
${node(186, 40, 148, 64, "2 · pick a snapshot", "fresh one, else collect now")}
${node(356, 40, 148, 64, "3 · check it", "complete? bytes intact?")}
${node(526, 40, 148, 64, "4 · evaluate", "select → assert / aggregate")}
${node(696, 40, 148, 64, "5 · record", "result + subjects + evidence", "svg-node-green")}
  <line x1="164" y1="72" x2="184" y2="72" class="svg-edge" marker-end="url(#tr-a)"/>
  <line x1="334" y1="72" x2="354" y2="72" class="svg-edge" marker-end="url(#tr-a)"/>
  <line x1="504" y1="72" x2="524" y2="72" class="svg-edge" marker-end="url(#tr-a)"/>
  <line x1="674" y1="72" x2="694" y2="72" class="svg-edge-green" marker-end="url(#tr-g)"/>

  <line x1="90" y1="104" x2="90" y2="150" class="svg-edge" style="stroke: var(--gap)" marker-end="url(#tr-r)"/>
  <line x1="430" y1="104" x2="430" y2="150" class="svg-edge" style="stroke: var(--gap)" marker-end="url(#tr-r)"/>
  <line x1="600" y1="104" x2="600" y2="150" class="svg-edge" style="stroke: var(--gap)" marker-end="url(#tr-r)"/>
${pill(16, 152, 148, "no bound connection", "svg-pill-red", "svg-ink-red")}
${pill(356, 152, 148, "incomplete / altered", "svg-pill-red", "svg-ink-red")}
${pill(526, 152, 148, "nothing selected*", "svg-pill-red", "svg-ink-red")}
  <path d="M 90 178 L 90 214 L 770 214 L 770 106" class="svg-edge" style="stroke: var(--gap)" fill="none" marker-end="url(#tr-r)"/>
  <line x1="430" y1="178" x2="430" y2="212" class="svg-edge" style="stroke: var(--gap)"/>
  <line x1="600" y1="178" x2="600" y2="212" class="svg-edge" style="stroke: var(--gap)"/>
  <text x="250" y="232" text-anchor="middle" class="svg-label">outcome: error, with the reason as the summary</text>

  <text x="16" y="266" class="svg-eyebrow">WHAT STEP 5 WRITES</text>
${pill(16, 274, 196, "outcome: pass/fail/error")}
${pill(220, 274, 226, "summary: \"2 of 3 items pass\"")}
${pill(454, 274, 190, "subjects: failing items")}
${pill(652, 274, 192, "evidence: snapshots used")}
  <text x="844" y="250" text-anchor="end" class="svg-caption-inline">* unless allow_empty: true</text>
</svg>`,
  },

  "query-anatomy": {
    number: "4",
    caption:
      "A query source definition. The operation and paths are checked against the vendor's own API model before anything runs; the item schema that rules see is derived from the projected paths.",
    html: `<svg viewBox="0 0 860 300" class="rfc-svg" role="img" aria-label="An annotated query source definition">
  <rect x="16" y="16" width="430" height="268" rx="8" class="svg-box-subtle"/>
  <text x="32" y="44" class="svg-mono svg-muted">integration: <tspan class="svg-ink-blue">dev.adversity.aws</tspan></text>
  <text x="32" y="68" class="svg-mono svg-muted">name: <tspan class="svg-ink-green">internet-open-groups</tspan></text>
  <text x="32" y="92" class="svg-mono svg-muted">version: <tspan class="svg-ink-green">1</tspan></text>
  <text x="32" y="116" class="svg-mono svg-muted">operation: <tspan class="svg-ink-amber">ec2.DescribeSecurityGroups</tspan></text>
  <text x="32" y="140" class="svg-mono svg-muted">params:</text>
  <text x="48" y="160" class="svg-mono-sm">Filters: '[{"Name": "ip-permission.cidr",</text>
  <text x="48" y="176" class="svg-mono-sm">           "Values": ["0.0.0.0/0"]}]'</text>
  <text x="32" y="200" class="svg-mono svg-muted">regions: <tspan class="svg-ink-blue">"*"</tspan></text>
  <text x="32" y="224" class="svg-mono svg-muted">fields:</text>
  <text x="48" y="244" class="svg-mono-sm"><tspan class="svg-ink-green">id</tspan>: GroupId     <tspan class="svg-ink-green">name</tspan>: GroupName</text>
  <text x="48" y="262" class="svg-mono-sm"><tspan class="svg-ink-green">vpc</tspan>: VpcId       <tspan class="svg-ink-green">rules</tspan>: IpPermissions</text>

  <line x1="240" y1="40" x2="470" y2="40" class="svg-guide"/>
  <text x="480" y="44" class="svg-label">which package, and so which API model</text>
  <line x1="260" y1="80" x2="470" y2="80" class="svg-guide"/>
  <text x="480" y="76" class="svg-label">the source rules read:</text>
  <text x="480" y="92" class="svg-mono-xs svg-ink-green">dev.adversity.aws/internet-open-groups@1</text>
  <line x1="300" y1="112" x2="470" y2="112" class="svg-guide"/>
  <text x="480" y="116" class="svg-label">one read operation (GET, List/Describe/Get, not denied)</text>
  <line x1="370" y1="160" x2="470" y2="160" class="svg-guide"/>
  <text x="480" y="156" class="svg-label">request parameters, typed by the model;</text>
  <text x="480" y="172" class="svg-label">lists and structures as JSON text</text>
  <line x1="160" y1="196" x2="470" y2="196" class="svg-guide"/>
  <text x="480" y="200" class="svg-label">AWS only: once per region; items gain <tspan class="svg-mono-xs">region</tspan></text>
  <line x1="380" y1="252" x2="470" y2="252" class="svg-guide"/>
  <text x="480" y="240" class="svg-label">output field ← path in each item.</text>
  <text x="480" y="256" class="svg-label"><tspan class="svg-mono-xs">id</tspan> and <tspan class="svg-mono-xs">name</tspan> are required: they name failing items</text>
</svg>`,
  },

  "for-each": {
    number: "5",
    caption:
      "<code>for_each</code>: list first, then one call per listed item. <code>bind</code> fills the call's parameters from each listed item, <code>$parent.&lt;path&gt;</code> projects the listed item, and a client error becomes an item with <code>error</code> set instead of failing the collection.",
    html: `<svg viewBox="0 0 860 300" class="rfc-svg" role="img" aria-label="for_each: a list operation, one call per listed item, and the resulting items">
  <defs>
    ${arrow("fe-a")}
    ${arrow("fe-b", "var(--contribution)")}
  </defs>
  <text x="16" y="26" class="svg-eyebrow">1 · LIST</text>
  <text x="300" y="26" class="svg-eyebrow">2 · ONE CALL PER LISTED ITEM</text>
  <text x="590" y="26" class="svg-eyebrow">3 · ITEMS THE RULE SEES</text>
${node(16, 40, 230, 56, "s3.ListBuckets", "BucketRegion = $region")}
${pill(30, 116, 202, "Name: acme-evidence")}
${pill(30, 156, 202, "Name: acme-logs")}
${pill(30, 196, 202, "Name: acme-public")}
  <line x1="131" y1="96" x2="131" y2="114" class="svg-edge" marker-end="url(#fe-a)"/>

${node(300, 100, 240, 56, "s3.GetBucketEncryption", "bind: Bucket ← Name", "svg-node-accent")}
  <path d="M 232 129 L 298 129" class="svg-edge-blue" fill="none" marker-end="url(#fe-b)"/>
  <path d="M 232 169 L 266 169 L 266 136 L 298 136" class="svg-edge-blue" fill="none"/>
  <path d="M 232 209 L 272 209 L 272 142 L 298 142" class="svg-edge-blue" fill="none"/>
  <text x="420" y="188" text-anchor="middle" class="svg-label">acme-logs answers 404</text>
  <text x="420" y="204" text-anchor="middle" class="svg-mono-xs svg-ink-red">ServerSideEncryptionConfigurationNotFoundError</text>

  <line x1="540" y1="128" x2="586" y2="128" class="svg-edge" marker-end="url(#fe-a)"/>
  <rect x="590" y="40" width="254" height="232" rx="8" class="svg-box-subtle"/>
  <text x="604" y="64" class="svg-mono-xs">name: acme-evidence</text>
  <text x="604" y="80" class="svg-mono-xs">rules: [{SSEAlgorithm: aws:kms}]</text>
  <text x="604" y="96" class="svg-mono-xs svg-ink-green">error: null</text>
  <line x1="604" y1="108" x2="830" y2="108" class="svg-guide"/>
  <text x="604" y="128" class="svg-mono-xs">name: acme-logs</text>
  <text x="604" y="144" class="svg-mono-xs">rules: null</text>
  <text x="604" y="160" class="svg-mono-xs svg-ink-red">error: ServerSideEncryption…NotFound…</text>
  <line x1="604" y1="172" x2="830" y2="172" class="svg-guide"/>
  <text x="604" y="192" class="svg-mono-xs">name: acme-public</text>
  <text x="604" y="208" class="svg-mono-xs">rules: [{SSEAlgorithm: AES256}]</text>
  <text x="604" y="224" class="svg-mono-xs svg-ink-green">error: null</text>
  <text x="604" y="256" class="svg-caption-inline">name comes from $parent.Name</text>
  <text x="16" y="266" class="svg-label">More than <tspan class="svg-mono-xs">limit</tspan> listed items (default 1000)</text>
  <text x="16" y="282" class="svg-label">makes the collection incomplete.</text>
</svg>`,
  },

  "authoring-loop": {
    number: "6",
    caption:
      "Writing a query source and its rule. Each step answers with problems at exact JSON pointers, so people and the assistant iterate the same way. The assistant may do everything but save: saving needs <code>tests:define-run</code>, which agents never hold.",
    html: `<svg viewBox="0 0 860 270" class="rfc-svg" role="img" aria-label="Search, describe, validate, dry run, preview, save; the assistant stops before save">
  <defs>
    ${arrow("al-a")}
    ${arrow("al-b", "var(--contribution)")}
  </defs>
${node(16, 40, 118, 56, "search", "read operations")}
${node(150, 40, 118, 56, "describe", "params, item fields")}
${node(284, 40, 118, 56, "validate", "static · no vendor")}
${node(418, 40, 118, 56, "dry run", "sample, nothing kept")}
${node(552, 40, 118, 56, "preview rule", "over the sample")}
${node(706, 40, 138, 56, "save", "query, then test", "svg-node-green")}
  <line x1="134" y1="68" x2="148" y2="68" class="svg-edge" marker-end="url(#al-a)"/>
  <line x1="268" y1="68" x2="282" y2="68" class="svg-edge" marker-end="url(#al-a)"/>
  <line x1="402" y1="68" x2="416" y2="68" class="svg-edge" marker-end="url(#al-a)"/>
  <line x1="536" y1="68" x2="550" y2="68" class="svg-edge" marker-end="url(#al-a)"/>
  <line x1="670" y1="68" x2="704" y2="68" class="svg-edge-green" marker-end="url(#al-a)"/>
  <path d="M 343 96 L 343 120 L 209 120 L 209 98" class="svg-edge-blue" fill="none" marker-end="url(#al-b)"/>
  <text x="276" y="136" text-anchor="middle" class="svg-label">fix at the pointer, try again</text>

  <text x="16" y="172" class="svg-eyebrow">PERSON · QUERY EDITOR AND RULE EDITOR</text>
  <rect x="16" y="180" width="828" height="14" rx="4" class="svg-pill-green"/>
  <text x="16" y="216" class="svg-eyebrow svg-ink-blue">ASSISTANT · TOOLS, THEN A DRAFT</text>
  <rect x="16" y="224" width="654" height="14" rx="4" class="svg-pill-blue"/>
  <rect x="706" y="219" width="138" height="24" rx="5" class="svg-pill-red"/>
  <text x="775" y="235" text-anchor="middle" class="svg-mono-sm svg-ink-red">cannot save</text>
  <text x="16" y="262" class="svg-caption-inline">propose_query_source hands the draft to a person: the query editor opens prefilled</text>
</svg>`,
  },
};

export function renderFigure(id) {
  const fig = FIGURES[id];
  if (!fig) {
    throw new Error(`Unknown figure id: ${id}`);
  }
  return `<figure class="rfc-figure" id="fig-${id}">
  <div class="rfc-figure-body">${fig.html}</div>
  <figcaption class="rfc-figcaption"><span class="fig-num">Fig ${fig.number}</span> ${fig.caption}</figcaption>
</figure>`;
}
