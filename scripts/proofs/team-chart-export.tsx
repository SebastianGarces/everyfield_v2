/** Render the actual chart and PDF exporter without a browser or external font requests. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { OrgChartView } from "@/components/ministry-teams/org-chart-view";
import { orgChartPdf } from "@/components/ministry-teams/org-chart-pdf";
import type { ChartTeam } from "@/lib/ministry-teams/org-chart-model";

async function main() {
  const [input, output] = process.argv.slice(2);
  assert.ok(input && output);
  const teams: ChartTeam[] = JSON.parse(readFileSync(input, "utf8"));
  assert.ok(teams.length > 1);
  mkdirSync(output, { recursive: true });
  globalThis.fetch = async (url) => {
    assert.equal(typeof url, "string");
    assert.match(String(url), /^\/fonts\/[a-z-]+\.ttf$/);
    return new Response(
      readFileSync(join(process.cwd(), "public", String(url)))
    );
  };
  for (const [name, scope] of [
    ["all", teams],
    ["single", teams.filter((team) => team.templateKey === null).slice(0, 1)],
  ] as const) {
    const markup = renderToStaticMarkup(<OrgChartView teams={scope} />);
    const image = markup.match(
      /<svg(?=[^>]*role="group")[^>]*>[\s\S]*?<\/svg>/
    )?.[0];
    assert.ok(image);
    writeFileSync(join(output, `${name}.svg`), image);
    const pdf = await orgChartPdf(scope, name === "all");
    assert.ok(pdf.size > 1000);
    writeFileSync(
      join(output, `${name}.pdf`),
      Buffer.from(await pdf.arrayBuffer())
    );
  }
  console.log(
    "PASS: actual SVG chart renderer and PDF exporter produced all-team and single-team files."
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
