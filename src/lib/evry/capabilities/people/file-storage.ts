import { AsyncLocalStorage } from "node:async_hooks";

import {
  createFileIfAbsent,
  deleteFile,
  getFileBytes,
  listFileKeys,
  listFileObjects,
  uploadFile,
} from "@/lib/storage";

export type EvryPeopleFileStorage = Readonly<{
  signingSecret(): string;
  store: typeof uploadFile;
  create: typeof createFileIfAbsent;
  read: typeof getFileBytes;
  remove: typeof deleteFile;
  listKeys: typeof listFileKeys;
  listObjects: typeof listFileObjects;
}>;

const LIVE_EVRY_PEOPLE_FILE_STORAGE: EvryPeopleFileStorage = {
  signingSecret() {
    const value = process.env.AWS_SECRET_ACCESS_KEY;
    if (!value) throw new Error("Attachment signing is unavailable");
    return value;
  },
  store: uploadFile,
  create: createFileIfAbsent,
  read: getFileBytes,
  remove: deleteFile,
  listKeys: listFileKeys,
  listObjects: listFileObjects,
};

const liveProofStorage = new AsyncLocalStorage<EvryPeopleFileStorage>();

/** Resolve the real bucket unless a live DB proof installed a scoped adapter. */
export function evryPeopleFileStorage(): EvryPeopleFileStorage {
  return liveProofStorage.getStore() ?? LIVE_EVRY_PEOPLE_FILE_STORAGE;
}

/**
 * Run one live DB proof with isolated storage effects. The opt-in guard keeps
 * this test seam unreachable from production request handling.
 */
export function withEvryPeopleLiveProofStorage<T>(
  storage: EvryPeopleFileStorage,
  run: () => Promise<T>
): Promise<T> {
  if (process.env.LIVE_DB_TESTS !== "1") {
    throw new Error("People file proof storage requires LIVE_DB_TESTS=1");
  }
  return liveProofStorage.run(storage, run);
}
