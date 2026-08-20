#!/usr/bin/env bash
# One-time board setup: create the board labels (trimmed 2026-08-19 — see ops/process.md;
# retired labels may still sit on old issues, but nothing creates or applies them any more).
# --force makes this idempotent, so it is safe to re-run.
set -euo pipefail

gh label create "agent:queued"      --color FBCA04 --description "Spec accepted, awaiting build" --force
gh label create "agent:in-progress" --color 0E8A16 --description "An agent is building it now"   --force
gh label create "agent:changes-requested" --color E36209 --description "Human asked for changes on the open PR — takeable again" --force
gh label create "feature"           --color 0052CC --description "Feature parent issue — the FRD's home on the board" --force
gh label create "decision"          --color 8B5CF6 --description "An open ruling that gates work; resolution lands in the decision ledger" --force
gh label create "deferred"          --color BFDADC --description "Off the active roadmap — cut or post-beta" --force
