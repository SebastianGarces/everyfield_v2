#!/usr/bin/env bash
# One-time board setup: create every label ops/agent-os/labels.md defines.
# --force makes this idempotent, so it is safe to re-run.
set -euo pipefail

gh label create "agent:queued"      --color FBCA04 --description "Spec accepted, awaiting build" --force
gh label create "agent:in-progress" --color 0E8A16 --description "build-until-done loop running"  --force
gh label create "agent:in-review"   --color 1D76DB --description "DoD passed, PR in review queue" --force
gh label create "agent:blocked"     --color B60205 --description "Loop exhausted, needs a human"  --force
gh label create "agent:delivery-failed" --color E99695 --description "DoD passed but the PR/delivery step failed — retry delivery; the code is fine" --force
gh label create "risk:high"         --color D93F0B --description "Auth/tenancy/payments"          --force
gh label create "needs-spec"        --color 5319E7 --description "Not build-ready — no FRD, or an open question inside one" --force
gh label create "feature"           --color 0052CC --description "Feature parent issue — the FRD's home on the board" --force
gh label create "decision"          --color 8B5CF6 --description "An open ruling that gates work; resolution lands in the decision ledger" --force
gh label create "deferred"          --color BFDADC --description "Off the active roadmap — cut or post-beta" --force
