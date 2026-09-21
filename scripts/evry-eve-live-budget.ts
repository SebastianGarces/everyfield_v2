import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { z } from "zod";

const ledgerSchema = z.strictObject({
  approvedUsd: z.number().positive(),
  allocations: z.array(
    z.strictObject({
      id: z.string(),
      reservedUsd: z.number().positive(),
      settledUsd: z.number().nonnegative().nullable(),
    })
  ),
});

/** One local writer; unknown/failed runs retain their full allocation across restarts. */
export async function withLiveReviewBudget<T>(
  path: string,
  allocationUsd: number,
  run: () => Promise<{ result: T; costUsd: number }>
): Promise<T> {
  if (!Number.isFinite(allocationUsd) || allocationUsd <= 0)
    throw new Error("A positive review allocation is required");
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, "wx", 0o600);
  try {
    const ledger = ledgerSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const reserved = ledger.allocations.reduce(
      (sum, entry) => sum + (entry.settledUsd ?? entry.reservedUsd),
      0
    );
    if (reserved + allocationUsd > ledger.approvedUsd + Number.EPSILON)
      throw new Error("Review allocation exceeds the remaining approved total");
    const entry = {
      id: randomUUID(),
      reservedUsd: allocationUsd,
      settledUsd: null as number | null,
    };
    ledger.allocations.push(entry);
    const save = async () => {
      const temporary = `${path}.${entry.id}.tmp`;
      await writeFile(temporary, JSON.stringify(ledger, null, 2) + "\n", {
        mode: 0o600,
      });
      await rename(temporary, path);
    };
    await save();
    const outcome = await run();
    if (
      !Number.isFinite(outcome.costUsd) ||
      outcome.costUsd < 0 ||
      outcome.costUsd > allocationUsd
    )
      throw new Error("Review usage is invalid; allocation remains reserved");
    entry.settledUsd = outcome.costUsd;
    await save();
    return outcome.result;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
