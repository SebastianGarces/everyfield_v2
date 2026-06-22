# Document Templates & Generation – Implementation Checklist

> **Phase-1 MVP shipped** on branch `feat/document-templates` (commit `e5cd8fb`).
> Scope decision: **generate-on-demand** (code-defined catalog + on-demand PDF,
> no persistence yet) per gap-report P2-1. Built on `@react-pdf/renderer`.
> Reuses the existing church/user profile for merge auto-fill.

## Must Have

- [x] DOC-001: Template library (browse available templates) — `/documents`, category-grouped
- [x] DOC-002: Template preview — inline PDF preview (`?preview=1`)
- [x] DOC-003: Document generation with merged church data
- [x] DOC-004: Merge field support (church name, pastor name, dates)
- [x] DOC-005: PDF generation
- [x] DOC-006: DOCX generation (editable Word documents) — via `docx`; Member Expectations, Launch Team Commitment, and Vision Meeting Agenda
- [x] DOC-007: Template categorization (commitment, VM, etc.)
- [ ] DOC-008: Generated document history — deferred (needs `documents` table + migration)
- [x] DOC-009: Document download
- [x] DOC-010: Core templates available (Commitment Card, Sign-in Sheet, Response Card) — all three shipped, plus Vision Meeting Agenda

## Should Have

- [ ] DOC-011: XLSX generation (spreadsheet templates for budgets)
- [x] DOC-012: Template filtering by category, phase, format — search + category/phase/format filters
- [x] DOC-013: Related wiki linking — per-template "Read the related wiki article" link
- [ ] DOC-014: Contextual access from other features
- [x] DOC-015: Multiple output formats selection — format picker shown when a template supports >1 format
- [x] DOC-016: Document preview (in-app) — opens the rendered PDF inline
- [x] DOC-017: Church profile auto-fill for merge fields
- [ ] DOC-018: Budget templates (First Year Budget, Budget Worksheet)
- [ ] DOC-019: Launch Sunday checklists (team-specific)

## Nice to Have

- [ ] DOC-020: Custom templates (church-specific)
- [ ] DOC-021: Branding support (church logo)
- [ ] DOC-022: Template versioning
- [ ] DOC-023: Document sharing with team members
- [ ] DOC-024: E-signatures for commitments
- [ ] DOC-025: Direct print (without downloading)
