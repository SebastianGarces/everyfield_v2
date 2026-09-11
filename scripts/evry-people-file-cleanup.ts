import { sweepExpiredEvryPeopleAttachments } from "@/lib/evry/capabilities/people/attachments";

async function main() {
  const result = await sweepExpiredEvryPeopleAttachments();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.failed > 0) process.exitCode = 1;
}

await main();
