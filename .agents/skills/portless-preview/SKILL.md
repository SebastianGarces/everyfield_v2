---
name: portless-preview
description: Create, review, and clean up local development or production previews of Git worktrees using the managed Portless CLI. Use for local preview URLs, preview handoffs, leases, and explicit worktree cleanup.
---

# Managed local previews

Use `portless preview --help` to check the installed CLI. This extension requires the local Portless fork and Node 24+; the upstream npm package does not include these commands.

## Configure and start

Read the project's `.preview.json`. Commands are argv arrays, not shell strings. The app must listen on the supplied `PORT`; bind to `127.0.0.1`. A minimal Next.js configuration is:

```json
{
  "install": ["pnpm", "install", "--frozen-lockfile"],
  "dev": ["pnpm", "exec", "next", "dev", "--hostname", "127.0.0.1"],
  "build": ["pnpm", "exec", "next", "build"],
  "start": ["pnpm", "exec", "next", "start", "--hostname", "127.0.0.1"],
  "env": { "NEXT_TELEMETRY_DISABLED": "1" },
  "timeoutSeconds": 180
}
```

Adapt commands to the project. Application databases and email services need their own disposable configuration. Optional `setup` requires idempotent `teardown`; both receive `PREVIEW_ID` and `PREVIEW_DATA_DIR`. The SQLite registry does not isolate application data. Development frameworks may load the worktree's `.env` files.

```bash
portless preview up --project /absolute/worktree --mode development --json
portless preview up --project /absolute/worktree --mode production --json
```

Development serves live worktree edits with framework hot reload. Production requires a clean committed worktree and builds an owned snapshot. Use production for proof tied to a commit. Never share `node_modules` through worktree symlinks. After committing development edits, recreate that preview to update its recorded SHA.

The default proxy uses HTTPS on port 1355. Trust its CA explicitly with `portless preview trust` when authorized. For disposable HTTP testing set `PORTLESS_PREVIEW_HTTP=1` before starting the supervisor. These URLs are local to this computer. Use `--config /absolute/file.json` for private project configuration.

## Review and handoff

Capture the returned ID, URL, head SHA and mode. Verify the actual change through the returned URL; readiness alone is not acceptance evidence. For UI work use a browser and exercise the changed behavior. To verify hot reload, keep the page open while editing; a later HTTP request only proves recompilation.

When handing off to another agent, include the absolute worktree, preview IDs and URLs, commit, acceptance criteria, evidence location, and any custom `PORTLESS_PREVIEW_DIR`, `PORTLESS_PREVIEW_PORT` or `PORTLESS_PREVIEW_HTTP` values. Those values identify the same supervisor. Delegate review only when delegation is authorized. State whether cleanup and worktree removal are authorized, and whether other agents still need the worktree.

Leases default to one hour. Use `renew ID --ttl 7200` for longer review. `renew ID --pin` prevents expiry until unpinned; prefer a bounded lease for unattended work. Inspect failures with `status --json` and `logs ID`. A socket permission error means the client lacks access, not that the supervisor stopped. Use the environment’s permission mechanism for local sockets and process inspection; do not delete the registry or start a second supervisor to bypass it.

## Finish

```bash
portless preview down ID
portless preview down ID --remove-worktree
portless preview gc
portless preview gc --apply
```

Ordinary `down` stops processes and removes owned dependencies/data/snapshots. It preserves the source worktree and borrowed dependencies. Use `--remove-worktree` when the task authorizes removing the source too and all users of that worktree are finished. Stop any other previews of that worktree first. The CLI refuses main, dirty, detached, changed-HEAD and concurrently previewed worktrees. It keeps the Git branch; ignored files disappear with the worktree. Do not bypass a refusal with force deletion.

Confirm the record is terminal, its URL no longer serves the app, and an explicitly removed worktree is absent from disk and `git worktree list`. Successful cleanup reports `removed`; an already-cleaned failed startup may retain `failed` for diagnosis. `cleanup_pending` is incomplete cleanup; inspect its error and retry after fixing the cause. `gc` is a dry run unless passed `--apply`. Shut down a dedicated test supervisor after verification; do not stop unrelated previews.

Worktree cleanup does not revert commits. If a rehearsal requires reverting the change, keep its SHA and revert it on the retained branch after cleanup. Report preview removal and Git reversion separately.
