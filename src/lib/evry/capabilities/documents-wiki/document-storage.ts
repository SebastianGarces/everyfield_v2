import { AsyncLocalStorage } from "node:async_hooks";

import { uploadFile } from "@/lib/storage";

export type EvryDocumentStorage = Readonly<{ store: typeof uploadFile }>;
const PRODUCTION_STORAGE: EvryDocumentStorage = { store: uploadFile };
const proofStorage = new AsyncLocalStorage<EvryDocumentStorage>();

export function evryDocumentStorage(): EvryDocumentStorage {
  return proofStorage.getStore() ?? PRODUCTION_STORAGE;
}

/** Live-DB-only scoped storage adapter; production always resolves the private S3 client. */
export function withEvryDocumentLiveProofStorage<T>(
  storage: EvryDocumentStorage,
  run: () => Promise<T>
): Promise<T> {
  if (process.env.LIVE_DB_TESTS !== "1")
    throw new Error("Document proof storage requires LIVE_DB_TESTS=1");
  return proofStorage.run(storage, run);
}
