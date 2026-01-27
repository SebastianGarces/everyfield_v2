---
name: requirements-docs
description: Rules for writing and editing EveryField requirements documentation. Use when working with FRDs, Product Brief, System Architecture, or any files in product-docs/.
---

# EveryField – Requirements Documentation Rules

## When to Use

- Use this skill when creating or editing files in `product-docs/`
- Use when writing or revising Feature Requirements Documents (FRDs)
- Use when updating Product Brief, System Architecture, or PRD
- Use when asked to refactor, correct, or audit documentation

## Purpose

This repository follows a **context-sharded requirements system** designed for reliable AI-assisted development.

Documents are intentionally separated to:

* Limit LLM context
* Prevent scope leakage
* Enable independent reasoning per concern

All new and revised documentation **must follow these rules**.

---

## Canonical Document Types

### 1. Product Brief (`product-brief.md`)

**Purpose:**
Defines *why* the product exists and *what success means*.

**Allowed Content**

* Problem statement
* Product vision
* Target users
* Core concepts & domain language
* Phase structure (high-level only)
* Success metrics
* Explicit non-goals
* Open questions (product-level)

**Forbidden Content**

* Feature requirements
* Screens, workflows, or UX details
* Data models
* Integrations
* Architecture details

**Rules**

* This document is safe to load into any LLM prompt
* This document must remain implementation-agnostic
* Features are referenced by name only

---

### 2. Domain Reference (e.g. `launch-playbook.md`)

**Purpose:**
Acts as authoritative source material the product implements.

**Rules**

* This is not a requirements document
* This document should not be rewritten unless explicitly requested
* Requirements must *reference* this document, not duplicate it

---

### 3. System Architecture (`system-architecture.md`)

**Purpose:**
Defines system-wide constraints and invariants. This document establishes the *sandbox* within which all features operate.

**Allowed Content**

* High-level architecture
* Tech stack constraints
* Data ownership boundaries (conceptual)
* Cross-cutting services (auth, phase engine, search, observability)
* Integration boundaries (what is internal vs external)
* Non-functional system-wide requirements

**Conditionally Allowed (Reference-Only)**

* Shared or core entities **only at a conceptual level**
* Example schemas **clearly marked as non-prescriptive**

**Forbidden Content**

* Feature-specific workflows or behavior
* Screens or UX flows
* Feature-specific entities as canonical schemas
* Step-by-step logic

**Rules**

* Architecture defines **constraints, not feature behavior**
* Detailed field-level schemas live in the owning feature's FRD
* Any schemas included here must be explicitly labeled as *reference-only*

---

### 4. Feature Requirements Documents (FRDs)

**Location**

```
product-docs/features/<feature-name>/frd.md
```

**Purpose:**
Defines *what a single feature must do* from a user and system behavior perspective.

**Rules**

* One feature per FRD
* FRDs must be independently understandable
* FRDs may reference Product Brief and System Architecture only
* FRDs must not reference other FRDs

**Required Sections**

* Feature overview
* User-visible behavior
* Screens and workflows
* Functional requirements
* Acceptance criteria
* Data entities (feature-owned)
* Integration points
* Non-functional requirements (feature-scoped)
* Success metrics
* Open questions

**Requirement Levels (Mandatory)**
FRDs must clearly distinguish requirement criticality:

* **Must Have** – Required for initial release
* **Should Have** – Important but deferrable
* **Nice to Have** – Optional or future enhancement

If requirement level is ambiguous, it must be explicitly labeled.

**Forbidden Content**

* System-wide architecture
* Product vision or philosophy
* Implementation strategy or code

---

### 5. Implementation Plans (Per FRD)

**Purpose:**
Defines one valid execution strategy for an FRD.

**Rules**

* May change without changing the FRD
* Must conform to Architecture + FRD
* Must not introduce new requirements

---

## Context Loading / Retrieval Policy

This section defines **what documentation the assistant must load** when processing requests. The goal is to prevent context blow-ups and ensure focused, efficient edits.

### Default Context for Refactors and Corrections

For any request to **refactor**, **correct**, **revise**, **tighten**, **improve**, **update**, or **align with rules**, the assistant must load **only**:

* The file(s) being edited
* `product-docs/prd.md`
* `product-docs/system-architecture.md`
* `product-docs/product-brief.md`

**The assistant must not load other FRDs by default.**

### When Additional FRDs May Be Loaded

Only load another FRD if **at least one** of the following is true:

1. The change modifies a **cross-feature contract** for a shared entity (User, Church, Person, Phase)
2. The change **adds or modifies an integration boundary** between features
3. The target FRD **explicitly references another feature's behavior** and that behavior must be verified

### Minimum Load Principle

If additional FRDs are needed:

* Load the **minimum set required** (usually 1–2)
* Explain briefly which FRDs are being loaded and why (one sentence)

---

## Refactor / Correction Protocol

When editing documentation, follow these principles to minimize diff size and preserve document integrity.

### In-Place Editing

* Make changes **in-place** with minimal diff
* Preserve structure unless there is a **clear rule violation**
* Do **not** rewrite entire documents unless explicitly asked

### Surgical Edits

Prefer small, targeted changes:

* Individual headings
* Specific bullets or list items
* Small sections or paragraphs

Avoid wholesale rewrites of sections that are not in violation.

### No Duplication

* Never duplicate content across documents
* Use **references** to other documents instead of copying content
* If content exists in its canonical location, point to it rather than repeating it

---

## Refactoring and Correction Rules

When asked to **refactor, correct, or audit documentation**, the following process must be followed:

1. Identify content that violates document boundaries
2. Classify the content by its correct document type
3. Propose a migration plan (move, split, or reference)
4. Do **not** rewrite content unless explicitly instructed
5. Preserve original intent while enforcing separation of concerns

When ambiguity exists, default to:

* Earlier documents for intent (Product Brief)
* Architecture for constraints
* FRDs for behavior

---

## Do Not Do

The following actions are **explicitly prohibited**:

* **Do not load all FRDs to validate a change.** Only load the minimum context required.
* **Do not copy feature-owned models into system architecture.** Schemas belong in their owning FRD; architecture references them conceptually.
* **Do not expand a refactor into a full rewrite.** Stick to the scope of the request.
* **Do not duplicate content across documents.** Use references instead.
* **Do not add implementation details to requirements documents.** Keep FRDs behavior-focused.
* **Do not merge FRDs or collapse document boundaries.** Each feature maintains its own FRD.

---

## Guiding Principle

> **Documents are context boundaries, not convenience bundles.**

Clarity and isolation are more important than completeness.
