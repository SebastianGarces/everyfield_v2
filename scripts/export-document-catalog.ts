/** Generate the complete catalog for offline artifact QA. No database or history writes.
 * pnpm exec tsx scripts/export-document-catalog.ts /tmp/document-catalog
 * Preview verification must separately download through the real account flow.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderDocument } from "../src/lib/documents/render";
import { DOCUMENT_TEMPLATES } from "../src/lib/documents/templates";

async function main() {
  const directory = process.argv[2];
  if (!directory)
    throw new Error("Provide an output directory outside the repository");
  for (const [name, church] of Object.entries({
    normal: "Dayspring Community Church",
    long: "New Hope Community Church of the Greater Springfield Valley",
  })) {
    const output = resolve(directory, name);
    await mkdir(output, { recursive: true });
    for (const template of DOCUMENT_TEMPLATES) {
      for (const format of template.formats) {
        const buffer = await renderDocument(format, template.id, {
          church_name: church,
          pastor_name: "Pastor Alexandra Montgomery",
          meeting_date: "September 20, 2026",
          launch_date: "October 4, 2026",
          meeting_number: "12",
        });
        await writeFile(resolve(output, `${template.id}.${format}`), buffer);
        console.log(`${name}/${template.id}.${format}`);
      }
    }
  }
}
void main();
