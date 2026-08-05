# Context Loading & Editing Rules

## Context loading / retrieval policy

For any request to refactor, correct, revise, tighten, improve, update, or align with rules,
load **only**:

- The file(s) being edited
- `product-docs/prd.md`
- `product-docs/system-architecture.md`
- `product-docs/product-brief.md`

**Never load other FRDs by default.** Load another FRD only when at least one holds:

1. The change modifies a **cross-feature contract** for a shared entity (User, Church, Person, Phase)
2. The change **adds or modifies an integration boundary** between features
3. The target FRD **explicitly references another feature's behavior** that must be verified

If additional FRDs are needed, load the minimum set (usually 1–2) and say in one sentence
which and why.

## Refactor / correction protocol

- **In-place editing:** minimal diff; preserve structure unless there is a clear rule
  violation; never rewrite whole documents unless explicitly asked.
- **Surgical edits:** individual headings, specific bullets, small sections.
- **No duplication:** reference the canonical location instead of copying.

When asked to refactor, correct, or audit documentation:

1. Identify content that violates document boundaries
2. Classify it by its correct document type
3. Propose a migration plan (move, split, or reference)
4. Do **not** rewrite content unless explicitly instructed
5. Preserve original intent while enforcing separation of concerns

When ambiguity exists, default to: Product Brief for intent, Architecture for constraints,
FRDs for behavior.

## Do not do

- **Do not load all FRDs to validate a change.**
- **Do not copy feature-owned models into system architecture.**
- **Do not expand a refactor into a full rewrite.**
- **Do not duplicate content across documents** — reference instead.
- **Do not add implementation details to requirements documents.**
- **Do not merge FRDs or collapse document boundaries.**
