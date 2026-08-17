# Invocation — how work enters the loop

User-invoked means **entry points only**. Everything the loop calls stays model-invocable. A skill
with `disable-model-invocation: true` is unreachable by subagents *and* from a slash-command body,
because both are executed by the model. `handoff` is the only skill carrying the flag; `/deliver` is
a slash command, so it is user-invoked by construction and needs none. `dispatch` is
schedule-invoked, so its guards live inside the skill.

> **Hazard.** Flagging anything the loop calls breaks it *silently* — the subagent simply cannot see
> the skill, and the failure surfaces as an unrelated gate failure minutes later.

Read this page **before dispatching**. The loop, `dispatch`, and `/deliver` all bind to it.

## The orchestrator ↔ track channel is issue comments

Never `SendMessage` a workflow track agent (`build-until-done`, `frd-implement`, or any agent those
workflows spawn). Sending a message directly does not "talk to" the running loop. It **resumes that
agent from its transcript**, producing a second continuation of work the first is still doing — two
agents on one branch, one issue claim, and a race for the same files.

The channel between orchestrator and track is **GitHub issue comments**: durable, ordered, visible
to a human, and read by the loop at a defined point in its cycle rather than injected mid-turn. Post
on the issue the track claimed. The loop ingests new comments after setup and before implement,
injects them into the implementer's prompt, and records the comment ids it consumed.

### If a track agent receives a direct message

A direct message is a misfire. Do **not** act on its content. Reply with this, and nothing else:

> This agent is mid-loop. The orchestrator↔track channel is **issue comments**, not `SendMessage`
> — a direct message resumes a duplicate continuation of work already in flight. Post on the GitHub
> issue this track claimed. See `ops/agent-os/invocation.md`.

## Serialize loop invocations

Never launch a `build-until-done` while another loop holds any `agent:in-progress` claim. Dispatch
already refuses (its gate 2); the loop itself refuses too, because a direct `/deliver` can skip
dispatch. The refusal names the holder. If the aborting loop already wrote a claim, it reverts
**its own** issue to `agent:queued` — a stranded `agent:in-progress` with no owner is the failure
this prevents. Never clear a claim this invocation did not set.

## Recover a stale claim

A claim is stale when an issue still reads `agent:in-progress` and no loop is running (the owning
agent died). Detect without opening the GitHub UI:

```bash
R=$(gh repo view --json nameWithOwner -q .nameWithOwner)
gh api --paginate "repos/$R/issues?labels=agent:in-progress&state=open&per_page=100" \
  --jq '.[] | select(.pull_request == null) | {number, title, updatedAt: .updated_at}'
```

`--paginate`, never `gh issue list --limit N`: that command caps at 30 and answers silently from a
window over the newest issues, so a holder outside the window reads as an empty board
(`ops/agent-os/labels.md`). The loop's own serialize scan uses this exact form.

If that list is non-empty and no `build-until-done` is in flight, revert the named issues — still
without hand-editing labels:

```bash
gh issue edit <n> --add-label agent:queued --remove-label agent:in-progress
```

One issue per invocation of that command. Do not sweep the label; name the issue you have confirmed
is ownerless. Dispatch never runs this automatically.

## Schema-capable tracks

Dispatch selects **at most one schema-capable track per pass**. A track is schema-capable when it
declares `db/` / `src/db/` **or** when its spec might need schema even though the file list does
not — a new persisted field, a status column, a unique index, anything that will mint a migration.
Worked example: #202 declared onboarding components and lib, no `db/`, then added
`churches.leadership_status` and minted migration 0028 while another track minted a different 0028.
The loop's G5 fence now blocks an undeclared `src/db/migrations/` addition (re-declare, do not
delete). Dispatch must not place two schema-capable tracks in the same pass, because G5 only sees
one track's declaration.

Details of the cycle and the G5 halt live in `ops/agent-os/workflow.md`.
