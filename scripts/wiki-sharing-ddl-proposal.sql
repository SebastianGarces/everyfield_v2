-- #62 DDL proposal. Not a migration and not allocated a journal number.
-- Generate the versioned migration only after the orchestrator releases the
-- schema slot and the Evri migration journal changes have landed.
-- Up: preserves existing plants' choices by leaving this new decision OFF.
ALTER TABLE "church_privacy_settings"
  ADD COLUMN "share_wiki" boolean DEFAULT false NOT NULL;
-- Down, scratch verification only:
-- ALTER TABLE "church_privacy_settings" DROP COLUMN "share_wiki";
