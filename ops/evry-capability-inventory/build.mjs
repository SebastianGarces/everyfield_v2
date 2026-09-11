import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import {
  meta,
  domains,
  questions,
  toolCatalog,
  recipeCatalog,
  likelihoods,
  gaps,
  smokeCaseIds,
} from "./catalog.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const args = process.argv.slice(2);
assert(
  args.every(
    (a, i) => a === "--check" || a === "--audit" || args[i - 1] === "--audit"
  ),
  "Unknown argument"
);
const auditIndex = args.indexOf("--audit");
assert(auditIndex < 0 || args[auditIndex + 1], "--audit requires a JSON path");
const audit = JSON.parse(
  await readFile(
    auditIndex < 0
      ? resolve(here, "current-tools.json")
      : resolve(args[auditIndex + 1]),
    "utf8"
  )
);
assert.equal(audit.schemaVersion, 1);
assert(Object.values(audit.checks).every((value) => value === true));
const readIds = new Set(
  audit.families.flatMap((f) => f.modelReads.map((t) => t.id))
);
const toolIds = new Set(toolCatalog.map((t) => t.id));
const recipeIds = new Set(recipeCatalog.map((r) => r.id));
const domainIds = new Set(domains.map((d) => d.id));
assert.equal(
  new Set(questions.map((q) => q.id)).size,
  questions.length,
  "Duplicate question ID"
);
assert.equal(toolIds.size, toolCatalog.length, "Duplicate tool ID");
assert.equal(recipeIds.size, recipeCatalog.length, "Duplicate recipe ID");
assert.equal(domainIds.size, domains.length, "Duplicate domain ID");
assert.equal(
  new Set(smokeCaseIds).size,
  16,
  "Smoke must name 16 distinct cases"
);
assert(
  smokeCaseIds.every((id) => questions.some((q) => q.id === id)),
  "Unknown smoke case"
);
for (const f of audit.families)
  assert.equal(f.modelReadCount, f.modelReads.length);
const shapes = new Set([
  "lookup",
  "collection",
  "relation",
  "aggregate",
  "synthesis",
  "action",
  "boundary",
]);
for (const q of questions) {
  assert(domainIds.has(q.domain));
  assert(
    q.turns.length &&
      q.turns.every((t) => typeof t === "string" && t.trim().length > 0)
  );
  assert(q.expected.length > 20 && q.likelihoodBasis.length > 20);
  assert(q.likelihood in likelihoods && q.gap in gaps && shapes.has(q.shape));
  assert.equal(q.evaluation, "not_run");
  assert(
    q.tools.every((t) => toolIds.has(t)),
    `${q.id} has an unknown proposed tool`
  );
  assert(q.recipe === null || recipeIds.has(q.recipe));
  assert(q.tools.length > 0 || q.shape === "boundary");
}
for (const t of toolCatalog) {
  assert(
    t.current.every(
      (id) => readIds.has(id) || id === "PRODUCTION_EVRY_EXECUTION_REGISTRY"
    ),
    `${t.id}: unknown current registration`
  );
  assert(
    questions.some((q) => q.tools.includes(t.id)),
    `Unmapped proposed tool ${t.id}`
  );
}
for (const r of recipeCatalog) {
  assert(r.tools.every((t) => toolIds.has(t)));
  assert(
    questions.some((q) => q.recipe === r.id),
    `Unmapped recipe ${r.id}`
  );
}
for (const d of domains) {
  assert(questions.some((q) => q.domain === d.id));
  await access(resolve(root, d.source));
}
const narrative = await readFile(resolve(here, "README.md"), "utf8");
const totals = {
  questions: questions.length,
  domains: domains.length,
  proposedTools: toolCatalog.length,
  recipes: recipeCatalog.length,
  currentReads: [...readIds].length,
  currentEffects: audit.families.reduce(
    (n, f) => n + f.confirmedEffectCount,
    0
  ),
  families: audit.families.length,
};
const payload = {
  meta,
  totals,
  likelihoods,
  gaps,
  domains,
  questions,
  smokeCaseIds,
  proposedTools: toolCatalog,
  recipes: recipeCatalog,
  current: audit,
  narrative,
};
const digest = createHash("sha256")
  .update(JSON.stringify(payload))
  .digest("hex");
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const source = (path) =>
  `https://github.com/SebastianGarces/everyfield_v2/blob/${meta.revision}/${path}`;
const anchor = (path, label) =>
  `<a href="${esc(source(path))}" target="_blank" rel="noreferrer">${esc(label)}</a>`;
// This small renderer supports only the Markdown forms used by our own README.
// All source text is escaped before markup is introduced; raw HTML is never accepted.
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\((https:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    );
}
function markdown(text) {
  const lines = text.split("\n");
  let result = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.startsWith("```")) {
      const body = [];
      while (++i < lines.length && !lines[i].startsWith("```"))
        body.push(lines[i]);
      result += `<pre>${esc(body.join("\n"))}</pre>`;
    } else if (/^#{1,3} /.test(line)) {
      const level = Math.min(4, line.match(/^#+/)[0].length + 1);
      result += `<h${level}>${inline(line.replace(/^#+ /, ""))}</h${level}>`;
    } else if (line.startsWith("|")) {
      const rows = [];
      do {
        if (!/^\|[-| ]+\|$/.test(lines[i]))
          rows.push(
            lines[i]
              .split("|")
              .slice(1, -1)
              .map((s) => s.trim())
          );
        i++;
      } while (i < lines.length && lines[i].startsWith("|"));
      i--;
      result += `<div class="table-wrap"><table><thead><tr>${rows
        .shift()
        .map((c) => `<th scope="col">${inline(c)}</th>`)
        .join(
          ""
        )}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d/.test(line),
        tag = ordered ? "ol" : "ul",
        items = [];
      do {
        items.push(`<li>${inline(lines[i].replace(/^(- |\d+\. )/, ""))}</li>`);
        i++;
      } while (
        i < lines.length &&
        (ordered ? /^\d+\. / : /^- /).test(lines[i])
      );
      i--;
      result += `<${tag}>${items.join("")}</${tag}>`;
    } else {
      const body = [line];
      while (
        i + 1 < lines.length &&
        lines[i + 1].trim() &&
        !/^(#|\||```|- |\d+\. )/.test(lines[i + 1])
      )
        body.push(lines[++i]);
      result += `<p>${inline(body.join(" "))}</p>`;
    }
  }
  return result;
}
const json = JSON.stringify(payload).replaceAll("<", "\\u003c");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="inventory-digest" content="${digest}"><title>Evry capability inventory</title>
<style>
:root{color-scheme:light;--ink:oklch(.224 .011 151.267);--bg:oklch(97.315% .00011 271.152);--card:#fff;--muted:oklch(.5 0 0);--line:oklch(.922 0 0);--green:#0b7a3f;--radius:.625rem}*{box-sizing:border-box}html{background:var(--bg);color:var(--ink);font:16px/1.55 Geist,Inter,system-ui,sans-serif}body{margin:0;background:var(--bg)}a{color:inherit;text-underline-offset:3px}button,a,select,summary{cursor:pointer}button,input,select{font:inherit}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--ink);outline-offset:4px}.skip{position:absolute;inset-inline-start:1rem;top:-5rem;background:white;padding:1rem;z-index:9}.skip:focus{top:0}.bar{background:var(--ink);color:white;padding:14px max(20px,calc((100vw - 1360px)/2));display:flex;gap:20px;align-items:center;justify-content:space-between}.bar a{font-size:14px}.mark{color:#1ce362}.wrap{max-width:1400px;margin:auto;padding:40px 24px 80px}h1{font-size:clamp(2rem,4vw,3.7rem);line-height:1.1;letter-spacing:-.045em;max-width:850px;margin:18px 0}h2{font-size:1.65rem;letter-spacing:-.025em;margin:0 0 14px}h3{font-size:1.1rem;margin:0 0 8px}h4{font-size:1rem}p{margin:0 0 16px;max-width:85ch}.eyebrow{font-size:.8rem;color:var(--green);font-weight:650;letter-spacing:.07em;text-transform:uppercase}.muted{color:var(--muted)}.intro{font-size:1.15rem;max-width:820px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:28px 0}.metric,.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px;min-width:0}.metric b{font-size:2rem;display:block;font-weight:550}.metric span{font-size:.86rem;color:var(--muted)}nav{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0 40px}nav a{padding:8px 14px;background:var(--card);border:1px solid var(--line);border-radius:7px;text-decoration:none}.notice{border-inline-start:3px solid var(--green);padding:12px 20px;background:var(--card);margin:28px 0}.section{margin-top:56px;scroll-margin-top:24px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.grid>*{min-width:0}.badge{display:inline-block;border:1px solid var(--line);border-radius:5px;padding:2px 7px;font-size:.74rem;line-height:1.5;white-space:normal}.badges{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}.filter{display:grid;grid-template-columns:minmax(0,2fr) repeat(3,minmax(0,1fr));gap:14px;padding:20px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius)}label{font-size:.85rem;display:block}input,select{display:block;min-width:0;width:100%;min-height:42px;background:var(--card);border:1px solid #bdbfbd;border-radius:6px;padding:8px;margin-top:6px}button{min-height:40px;padding:7px 14px;border:1px solid var(--line);border-radius:6px;color:var(--ink);background:white}button:disabled{opacity:.5;cursor:default}.results{list-style:none;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.question{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:22px;min-width:0}.question h3{font-size:1rem}.question p{font-size:.91rem}.question .turn{font-size:1.05rem;font-weight:550;margin-bottom:10px}.question details{margin-top:12px}.question details p{margin-top:10px}.question summary{font-size:.87rem;text-decoration:underline;text-underline-offset:3px;min-height:28px}.pager{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:16px 0}.tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}code{font: .87em ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere}.tool h3{font-family:ui-monospace,monospace;font-size:1rem;overflow-wrap:anywhere}.tool p,.recipe p{font-size:.91rem}.tool .example-links{display:flex;flex-wrap:wrap;gap:8px;font-size:.82rem}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.88rem;text-align:start}th,td{padding:10px 12px;vertical-align:top;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th{font-weight:600;background:var(--bg)}.prose{max-width:1000px}.prose h2,.prose h3,.prose h4{margin-top:30px}.prose li{margin-bottom:10px}.prose pre{background:var(--bg);padding:16px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem}details.long{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px}details.long>summary{font-weight:600;min-height:32px}.source-list{display:grid;gap:14px}.source-list p{font-size:.88rem}.source-list summary{padding:10px 0;min-height:40px}footer{font-size:.85rem;margin-top:48px;color:var(--muted)}[hidden]{display:none!important}button.primary{background:var(--ink);color:white}#empty{padding:30px 0}section,p,li{overflow-wrap:break-word}@media(max-width:900px){.filter{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.wrap{padding:24px 16px 60px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.grid,.tools,.results,.filter{grid-template-columns:minmax(0,1fr)}.card,.question,.metric{padding:18px}.bar{align-items:start;flex-direction:column;gap:4px}}@media print{nav,.filter,.pager,.skip,#download{display:none}.results,.tools,.grid{display:block}.question,.tool,.recipe{break-inside:avoid;margin-bottom:12px}.question[hidden]{display:block!important}.section{margin-top:24px}body{background:white}}
</style></head><body><a class="skip" href="#questions">Skip to question inventory</a><header class="bar"><div><span class="mark" aria-hidden="true">●</span> EveryField / Evry</div><a href="${meta.issue}" target="_blank" rel="noreferrer">Issue #758 · capability planning</a></header><main class="wrap">
<div class="eyebrow">Question inventory · ${meta.date} · no paid evals</div><h1>${meta.title}</h1><p class="intro">Give Evry the tools to find, filter and compare application records in bulk, then explain the evidence. Use recipes for recurring workflows with stable steps.</p><p class="muted">Proposed capability design. Current UI and runtime are unchanged.</p>
<div class="metrics"><div class="metric"><b>${totals.questions}</b><span>Questions and multi-turn cases</span></div><div class="metric"><b>${totals.domains}</b><span>Review areas, including edge cases</span></div><div class="metric"><b>${totals.proposedTools}</b><span>Proposed tool contracts</span></div><div class="metric"><b>${totals.recipes}</b><span>Recipe candidates</span></div></div>
<div class="notice"><p><strong>79 registered reads do not mean 79 solved user needs.</strong> Current tools span ${totals.families} families and ${totals.currentEffects} confirmed-effect handlers. The gaps are bulk relationships, query expressiveness, source content and bounded composition.</p><p class="muted">${esc(meta.caveat)}</p></div>
<nav aria-label="Report sections"><a href="#questions">Browse questions</a><a href="#tools">Tool contracts</a><a href="#recipes">Recipe shortlist</a><a href="#evidence">Current evidence</a><a href="#plan">Design and evaluation plan</a><button id="download">Download inventory JSON</button></nav>
<div class="grid"><article class="card"><h2>Fix the reusable operations first</h2><p>Bulk filtering, related-record existence, grouped counts, multi-record lookup and cited retrieval answer many different questions. Preserve working task date filters and reuse existing authorization and services.</p><p class="muted">One query can select prospects with recorded follow-up and no interview. It should not require one model call per prospect.</p></article><article class="card"><h2>Recipes have a narrower job</h2><p>Start with the existing meeting-and-invitation workflow. Evaluate daily-work, follow-up and staffing reviews after the underlying queries work. Do not turn every question into a recipe.</p><p class="muted">The model can compose a read answer. It cannot confirm its own action plan or gain broader access.</p></article></div>
<section class="section" id="questions"><h2>Questions Evry should handle</h2><p>Each case records the expected behavior, likely use and required tools. “Current path candidate” means its contracts look plausible, not that a model passed the case.</p><div class="filter"><label for="search">Search questions, tools or expected behavior<input id="search" type="search" placeholder="For example: no interview" autocomplete="off"></label><label for="domain">Review area<select id="domain"><option value="">All areas</option>${domains.map((d) => `<option value="${d.id}">${esc(d.title)}</option>`).join("")}</select></label><label for="likelihood">Estimated frequency<select id="likelihood"><option value="">All frequencies</option>${Object.keys(
  likelihoods
)
  .map((l) => `<option value="${l}">${l}</option>`)
  .join(
    ""
  )}</select></label><label for="gap">Current gap<select id="gap"><option value="">All gaps</option>${Object.keys(
  gaps
)
  .map(
    (g) =>
      `<option value="${g}">${g === "candidate" ? "Current path candidate" : g}</option>`
  )
  .join(
    ""
  )}</select></label></div><div class="pager"><p id="count" role="status" aria-live="polite"></p><button id="clear">Clear filters</button></div><ol class="results" id="results"></ol><p id="empty" hidden>No matching cases. Clear the filters to see the complete inventory.</p><div class="pager"><button id="previous">Previous 12</button><span id="page"></span><button id="next">Next 12</button></div></section>
<section class="section" id="tools"><h2>Proposed tool contracts</h2><p>These are target contracts, not newly implemented tools. Search selects a filtered set; get-many hydrates one or more known records. Counts and groups operate on the full filtered population, before display pagination.</p><div class="tools">${toolCatalog
  .map(
    (t) =>
      `<article class="card tool" id="tool-${t.id}"><div class="badges"><span class="badge">${t.priority}</span><span class="badge">${esc(t.cardinality)}</span></div><h3>${esc(t.id)}</h3><p class="muted">${esc(t.domain)}</p><p>${esc(t.contract)}</p><p><strong>Existing starting points</strong><br><code>${esc(t.current.join(", "))}</code></p><p>${questions.filter((q) => q.tools.includes(t.id)).length} mapped cases. All use estimates are provisional.</p><div class="example-links">${questions
        .filter((q) => q.tools.includes(t.id))
        .slice(0, 4)
        .map((q) => `<a href="#${q.id}" data-case="${q.id}">${q.id}</a>`)
        .join("")}</div></article>`
  )
  .join("")}</div></section>
<section class="section" id="recipes"><h2>Recipe shortlist</h2><p>Use frequency, repeated multi-step work and consequence handling to choose recipes. A recipe name is never an exact-phrase gate. Each still permits a general tool-based answer.</p><div class="grid">${recipeCatalog.map((r) => `<article class="card recipe"><div class="badges"><span class="badge">${r.priority}</span><span class="badge">${r.likelihood} estimated frequency</span><span class="badge">${esc(r.safety)}</span></div><h3>${esc(r.title)}</h3><p>${esc(r.rationale)}</p><p class="muted">${esc(r.tools.join(" · "))}</p><p>${questions.filter((q) => q.recipe === r.id).length} mapped examples</p></article>`).join("")}</div></section>
<section class="section" id="evidence"><h2>What exists today</h2><p>Source-contract inspection at <code>${meta.revision.slice(0, 12)}</code>. Tool schemas are included in the JSON download. This is not a live behavior score.</p><div class="table-wrap"><table><caption>Registered model reads and confirmed effects</caption><thead><tr><th scope="col">Family</th><th scope="col">Reads</th><th scope="col">Effects</th></tr></thead><tbody>${audit.families.map((f) => `<tr><th scope="row">${esc(f.family)}</th><td>${f.modelReadCount}</td><td>${f.confirmedEffectCount}</td></tr>`).join("")}</tbody></table></div><div class="source-list">${domains.map((d) => `<details><summary>${esc(d.title)}</summary><p>${esc(d.current)}</p><p>${anchor(d.source, d.source)}</p></details>`).join("")}</div><p>${anchor("src/lib/evry/capabilities/model-conversation.ts", "Four-read orchestration loop")} · ${anchor("src/lib/evry/recipes/production-reuse.ts", "Current recipe reuse registry")} · ${anchor("scripts/evry-capability-coverage.ts", "Rerunnable registry audit")}</p></section>
<section class="section" id="plan"><h2>Implementation and evaluation plan</h2><p>Prioritize reusable query correctness, then orchestration and breadth. Run provider-free fixtures before buying model comparisons. Existing scope exclusions remain in force.</p><details class="long"><summary>Read the full design, evidence semantics, delivery order and evaluation gates</summary><div class="prose">${markdown(narrative)}</div></details></section><footer>Design source: EveryField's existing authenticated-app theme in src/app/globals.css. Neutral cards, ink text and restrained field-green accents. Static review artifact; no telemetry, third-party assets or model requests.</footer></main>
<script type="application/json" id="inventory">${json}</script><script>
const data=JSON.parse(document.getElementById('inventory').textContent);
const E=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const controls=['search','domain','likelihood','gap'].map(id=>document.getElementById(id));let pageIndex=0;
const results=document.getElementById('results');
function matching(){const [s,d,l,g]=controls.map(el=>el.value.toLowerCase());return data.questions.filter(q=>(!d||q.domain===d)&&(!l||q.likelihood===l)&&(!g||q.gap===g)&&(!s||JSON.stringify(q).toLowerCase().includes(s)));}
function render(){const all=matching();pageIndex=Math.min(pageIndex,Math.max(0,Math.ceil(all.length/12)-1));results.innerHTML=all.slice(pageIndex*12,(pageIndex+1)*12).map(q=>'<li class="question" id="'+q.id+'"><h3>'+E(q.id)+' · '+E(data.domains.find(d=>d.id===q.domain).title)+'</h3><div class="badges"><span class="badge">'+q.likelihood+' estimated frequency</span><span class="badge">'+q.shape+'</span><span class="badge">'+(q.gap==='candidate'?'Current path candidate':q.gap+' gap')+'</span></div>'+q.turns.map((t,i)=>'<p class="turn">'+(q.turns.length>1?'Turn '+(i+1)+': ':'')+E(t)+'</p>').join('')+'<p><strong>Expected behavior</strong><br>'+E(q.expected)+'</p><details><summary>Tools, gap and evaluation status</summary><p>'+q.tools.map(t=>'<a href="#tool-'+t+'"><code>'+E(t)+'</code></a>').join(', ')+(q.tools.length?'':'No data tool needed for this boundary.')+'</p><p>'+E(data.gaps[q.gap])+'</p><p>'+E(q.likelihoodBasis)+'</p><p>Recipe: '+E(q.recipe||'General tools; no recipe needed')+'. Evaluation: not run.</p></details></li>').join('');document.getElementById('count').textContent=all.length+' of '+data.questions.length+' cases';document.getElementById('page').textContent=all.length?'Page '+(pageIndex+1)+' of '+Math.ceil(all.length/12):'No pages';document.getElementById('empty').hidden=all.length>0;document.getElementById('previous').disabled=pageIndex===0;document.getElementById('next').disabled=(pageIndex+1)*12>=all.length;}
controls.forEach(el=>el.addEventListener(el.id==='search'?'input':'change',()=>{pageIndex=0;render();}));
document.getElementById('clear').onclick=()=>{controls.forEach(el=>el.value='');pageIndex=0;render();};
document.getElementById('previous').onclick=()=>{pageIndex--;render();document.getElementById('questions').scrollIntoView();};
document.getElementById('next').onclick=()=>{pageIndex++;render();document.getElementById('questions').scrollIntoView();};
function showCase(id){controls.forEach(el=>el.value='');const index=data.questions.findIndex(q=>q.id===id);if(index<0)return;pageIndex=Math.floor(index/12);render();const el=document.getElementById(id);el.scrollIntoView();el.tabIndex=-1;el.focus({preventScroll:true});}
document.querySelectorAll('[data-case]').forEach(a=>a.addEventListener('click',()=>showCase(a.dataset.case)));
document.getElementById('download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='evry-capability-inventory.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
render();if(location.hash)showCase(location.hash.slice(1));
addEventListener('beforeprint',()=>{document.querySelectorAll('details').forEach(d=>{d.dataset.wasOpen=String(d.open);d.open=true;});});
addEventListener('afterprint',()=>{document.querySelectorAll('details').forEach(d=>d.open=d.dataset.wasOpen==='true');});
</script></body></html>`;
const out = resolve(root, ".lavish");
if (args.includes("--check")) {
  const saved = await readFile(
    resolve(out, "evry-capability-inventory.json"),
    "utf8"
  );
  assert.deepEqual(JSON.parse(saved), payload, "Regenerate stale JSON");
  const report = await readFile(
    resolve(out, "evry-capability-inventory.html"),
    "utf8"
  );
  assert(report.includes(digest), "Regenerate stale HTML");
  assert(report.includes('id="inventory"') && report.includes('id="results"'));
  console.log(
    JSON.stringify(
      {
        inventoryIntegrity: "passed",
        ...totals,
        modelCalls: 0,
        behaviorEvaluations: 0,
      },
      null,
      2
    )
  );
} else {
  await mkdir(out, { recursive: true });
  if (auditIndex >= 0)
    await writeFile(
      resolve(here, "current-tools.json"),
      JSON.stringify(audit, null, 2) + "\n"
    );
  await writeFile(
    resolve(out, "evry-capability-inventory.json"),
    JSON.stringify(payload, null, 2) + "\n"
  );
  await writeFile(resolve(out, "evry-capability-inventory.html"), html);
  console.log(
    JSON.stringify(
      {
        html: resolve(out, "evry-capability-inventory.html"),
        ...totals,
        modelCalls: 0,
      },
      null,
      2
    )
  );
}
