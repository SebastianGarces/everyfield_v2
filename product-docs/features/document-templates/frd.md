# F6: Document Templates & Generation
## Feature Requirements Document (FRD)

**Version:** 1.1  
**Date:** January 25, 2026  
**Feature Code:** F6

---

> **Tracked on the board:** [F6 #69](https://github.com/SebastianGarces/everyfield_v2/issues/69) — open requirements are its sub-issues. Implementation status is not tracked in this file.

## References

- [Product Brief](../../product-brief.md) - Core concepts and domain language
- [System Architecture](../../system-architecture.md) - Data ownership and cross-cutting services
- [Core Data Contracts](../../core-data-contracts.md) - Shared entity contracts (Church, User, Person, Phase)

---

## Overview

Document Templates & Generation provides ready-to-use templates for critical documents throughout the church planting journey. This feature enables planters to generate professionally formatted documents with their church-specific information auto-populated.

---

## Template Categories

### Commitment Documents
- Core Group Member Commitment Card
- Expectations of a Core Group Member
- Commitments of a Core Group (organizational agreement)
- Launch Team Commitment

### Vision Meeting Materials
- Invitation Card Template
- Welcome Brochure Content
- Response Card Template
- Guest Sign-in Sheet
- Follow-up Letter Templates (committed, uncommitted, questions)
- Vision Meeting Agenda Template

### Administrative Documents
- Budget Worksheet Template
- First Year Budget Template
- 501(c)(3) Application Checklist
- Incorporation Checklist (state-specific guidance)
- Financial Procedures Documentation
- Board/Elder Meeting Agenda

### Operational Documents
- Launch Sunday Checklists (per ministry team)
- Volunteer Application Form
- Background Check Authorization
- Contribution Statement Template
- Weekly Service Checklist
- Room Setup Diagrams

### Communication Templates
- Email Templates (by purpose)
- Text Message Templates
- Newsletter Templates
- Social Media Post Templates

---

## Functional Requirements

### Must Have (MVP)

| ID | Requirement | Description |
|----|-------------|-------------|
| DOC-001 | Template library | Browse available document templates |
| DOC-002 | Template preview | Preview template before generating |
| DOC-003 | Document generation | Generate documents with merged church data |
| DOC-004 | Merge field support | Auto-populate church name, pastor name, dates |
| DOC-005 | PDF generation | Generate printable PDF documents |
| DOC-006 | DOCX generation | Generate editable Word documents |
| DOC-007 | Template categorization | Organize templates by category (commitment, VM, etc.) |
| DOC-008 | Generated document history | Track all generated documents |
| DOC-009 | Document download | Download generated documents |
| DOC-010 | Core templates available | Commitment Card, Sign-in Sheet, Response Card |

### Should Have

| ID | Requirement | Description |
|----|-------------|-------------|
| DOC-011 | XLSX generation | Generate spreadsheet templates (budgets) |
| DOC-012 | Template filtering | Filter by category, phase, format |
| DOC-013 | Related wiki linking | Link templates to explanatory wiki articles |
| DOC-014 | Contextual access | Access templates from within other features |
| DOC-015 | Multiple output formats | Choose format when generating |
| DOC-016 | Document preview | In-app preview of generated documents |
| DOC-017 | Church profile auto-fill | Pre-populate merge fields from church settings |
| DOC-018 | Budget templates | First Year Budget, Budget Worksheet |
| DOC-019 | Launch Sunday checklists | Team-specific launch day checklists |

### Nice to Have (Future)

| ID | Requirement | Description |
|----|-------------|-------------|
| DOC-020 | Custom templates | Create and save church-specific templates |
| DOC-021 | Branding support | Add church logo to generated documents |
| DOC-022 | Template versioning | Track updates to system templates |
| DOC-023 | Document sharing | Share documents with team members |
| DOC-024 | E-signatures | Electronic signature support for commitments |
| DOC-025 | Direct print | Print documents without downloading |

---

## Screens

### 1. Templates Library

Browse all available templates.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Document Templates                                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  🔍 Search templates...           [Category ▼] [Phase ▼] [Format ▼]         │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  COMMITMENT DOCUMENTS                                                        │
│                                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │ 📄                  │  │ 📄                  │  │ 📄                  │  │
│  │ Commitment Card     │  │ Member Expectations │  │ Core Group          │  │
│  │                     │  │                     │  │ Commitments         │  │
│  │ PDF • 1 page        │  │ DOCX • 2 pages      │  │ DOCX • 3 pages      │  │
│  │ Phase 1             │  │ Phase 1             │  │ Phase 1             │  │
│  │                     │  │                     │  │                     │  │
│  │ [Preview][Generate] │  │ [Preview][Generate] │  │ [Preview][Generate] │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  VISION MEETING MATERIALS                                                    │
│                                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │ 📄                  │  │ 📄                  │  │ 📄                  │  │
│  │ Invitation Card     │  │ Response Card       │  │ Sign-in Sheet       │  │
│  │                     │  │                     │  │                     │  │
│  │ PDF • 1 page        │  │ PDF • 1 page        │  │ PDF • 1 page        │  │
│  │ Phase 1             │  │ Phase 1             │  │ Phase 1             │  │
│  │                     │  │                     │  │                     │  │
│  │ [Preview][Generate] │  │ [Preview][Generate] │  │ [Preview][Generate] │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  MY GENERATED DOCUMENTS                                           [View All] │
│                                                                              │
│  • Commitment Card (Jan 20, 2026)                              [Download]   │
│  • Budget Worksheet (Jan 15, 2026)                             [Download]   │
│  • Vision Meeting Agenda (Jan 10, 2026)                        [Download]   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 2. Template Preview

View template before generating.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ← Back to Templates                                                         │
│                                                                              │
│  Commitment Card                                                             │
│  PDF • 1 page • Phase 1                                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                        │  │
│  │                    CORE GROUP COMMITMENT                               │  │
│  │                    {{church_name}}                                     │  │
│  │                                                                        │  │
│  │  I, _________________, commit to being a founding                      │  │
│  │  member of {{church_name}} and pledge to:                              │  │
│  │                                                                        │  │
│  │  ☐ GROW - Actively invite others to Vision Meetings                   │  │
│  │  ☐ PRAY - Faithfully pray for the church plant                        │  │
│  │  ☐ GIVE - Generously and sacrificially give                           │  │
│  │                                                                        │  │
│  │  I understand this commitment covers the period from                   │  │
│  │  __________ until Launch Sunday.                                       │  │
│  │                                                                        │  │
│  │  Signed: _____________________ Date: __________                        │  │
│  │                                                                        │  │
│  │                                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  MERGE FIELDS USED                                                           │
│  • {{church_name}} - Your church name                                       │
│  • {{pastor_name}} - Senior Pastor name (optional)                          │
│  • {{church_address}} - Church address (optional)                           │
│                                                                              │
│  Related Wiki Article: The 3 Key Documents                    [Read →]      │
│                                                                              │
│                                            [Cancel]  [Generate Document]    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Document Generation Form

Configure and generate document.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Generate: Commitment Card                                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MERGE FIELDS                                                                │
│                                                                              │
│  Church Name *                                                               │
│  [New Life Church                    ] ← Auto-filled from church profile    │
│                                                                              │
│  Pastor Name                                                                 │
│  [Pastor John Smith                  ] ← Auto-filled from church profile    │
│                                                                              │
│  Church Address (optional)                                                   │
│  [                                   ]                                       │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  OUTPUT OPTIONS                                                              │
│                                                                              │
│  Format: ● PDF  ○ DOCX (editable)  ○ Print directly                        │
│                                                                              │
│  Copies: [1  ▼]  (for print)                                                │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  PREVIEW                                                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  [Live preview with merged values]                                     │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│                                            [Cancel]  [Generate & Download]  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 4. Generated Documents History

Track all generated documents.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  My Generated Documents                                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Filter: [All ▼]  [All Time ▼]                                              │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  Document                  Template              Generated       Actions     │
│  ─────────────────────────────────────────────────────────────────────────   │
│  Commitment_Card.pdf       Commitment Card       Jan 20, 2026   [↓] [👁] [🗑]│
│  Budget_2026.xlsx          First Year Budget     Jan 15, 2026   [↓] [👁] [🗑]│
│  VM_Agenda_Jan14.pdf       VM Agenda             Jan 10, 2026   [↓] [👁] [🗑]│
│  Invitation_Card.pdf       Invitation Card       Jan 8, 2026    [↓] [👁] [🗑]│
│  Sign_in_Sheet.pdf         Guest Sign-in         Jan 5, 2026    [↓] [👁] [🗑]│
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  Showing 5 of 12 documents                                      [Load More] │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Workflows

### Workflow 1: Generate Document

**Trigger:** User clicks "Generate" on a template

**Steps:**

```
[Template Library] → [Click Generate]
    ↓
[Generation Form opens]
    ↓
Auto-fill merge fields from church profile
    ↓
User reviews/edits merge field values
    ↓
Select output format (PDF/DOCX/Print)
    ↓
[Generate & Download]
    ↓
Document created with merged values
    ↓
Document saved to history
    ↓
Download initiated
```

---

### Workflow 2: Customize Template (DOCX)

**Trigger:** User generates DOCX format

**Steps:**

```
[Generate as DOCX]
    ↓
Download DOCX file
    ↓
User opens in Word/Google Docs
    ↓
User makes customizations
    ↓
User can upload customized version (optional)
    ↓
Customized version stored in Documents
```

---

### Workflow 3: Contextual Template Access

**Trigger:** User is in another feature and needs template

**Steps:**

```
[Other Feature Context] → [Materials/Documents Section]
    ↓
See: "📄 [Relevant Template]" with [Get Template] link
    ↓
Click [Get Template]
    ↓
[Template Preview opens in modal]
    ↓
[Generate] → Document created
    ↓
Return to originating context
```

---

## Data Model

> **Shared Entities:** This feature references `Church`, `User`, and `Person` entities. See [Core Data Contracts](../../core-data-contracts.md) for field definitions and referencing rules.

### Template

The catalog is a fixed set of templates that ship with the product. Templates are product content,
not user data, so they version with the product and there are no template tables to migrate.

A template is defined by:

| Attribute | Description |
|-----------|-------------|
| Identifier | A stable id that outlives renames, so saved documents and cross-feature links keep pointing at the same template |
| Name | The title a planter sees in the library |
| Description | One line saying what the document is for |
| Category | `commitment` / `vision_meeting` / `administrative` / `operational` / `communication` |
| Phase | The phase the template belongs to (0-6), where one applies |
| Output | What generating produces: the format(s) offered (PDF, DOCX, XLSX) and the page count of the printed result |
| Merge fields | The values the template asks for — each with the field name in the document, the label shown on the generation form, where it is read from, and whether it is required |
| Related wiki article | The article that explains when to use the document, where one exists |

Generating a template produces a Document (below): the template is rendered on demand with the
merge values supplied, and only the resulting document is stored.

---

### Document

Generated and uploaded documents.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| church_id | UUID (FK) | Yes | Reference to Church |
| template_id | String | No | Catalog template identifier (set when the document was generated from a template) |
| name | String | Yes | Document name |
| description | Text | No | Description |
| file_url | String | Yes | URL to stored file |
| file_format | Enum | Yes | `pdf` / `docx` / `xlsx` / `jpg` / `png` |
| file_size_bytes | Integer | No | File size |
| category | Enum | No | Document category |
| related_type | Enum | No | `person` / `facility` / `meeting` / etc. |
| related_id | UUID | No | Reference to related entity |
| merge_values | JSON | No | Values used for generation |
| created_by_id | UUID (FK) | Yes | Reference to User |
| created_at | Timestamp | Yes | Creation timestamp |

---

## Template Specifications

### Commitment Card
- **Format:** PDF (print-ready)
- **Size:** 5.5" x 4.25" (quarter page)
- **Merge Fields:** church_name, pastor_name
- **Content:** Commitment statement, GROW/PRAY/GIVE checkboxes, signature line

### Member Expectations
- **Format:** DOCX (editable)
- **Size:** Letter (8.5" x 11")
- **Merge Fields:** church_name
- **Content:** Detailed expectations for Core Group members

### Guest Sign-in Sheet
- **Format:** PDF (print-ready)
- **Size:** Letter (8.5" x 11")
- **Merge Fields:** church_name, meeting_date, meeting_number
- **Content:** Name, email, phone, invited_by columns (10-15 rows)

### First Year Budget
- **Format:** XLSX (editable)
- **Size:** N/A
- **Merge Fields:** church_name
- **Content:** Budget categories, monthly columns, formulas for totals

### Launch Sunday Checklists
- **Format:** PDF (print-ready)
- **Size:** Letter (8.5" x 11")
- **Merge Fields:** church_name, launch_date, team_name
- **Content:** Team-specific checklist items with checkboxes

---

## Integration Contracts

This feature exposes and consumes the following integration points. For system-wide architecture, see [System Architecture](../../system-architecture.md).

### Inbound (This Feature Consumes)

**Church Profile Data**
- Reads `church.name`, `church.address` for merge field auto-fill
- Reads planter/pastor name from `User` for merge fields
- All reads follow contracts in [Core Data Contracts](../../core-data-contracts.md)

### Outbound (This Feature Exposes)

**Template Access API**
- Lists templates filtered by category, so other features can surface the ones relevant to their context
- Exposes modal-based template generation flow callable from external contexts
- Returns generated `Document.id` and `Document.file_url` on successful generation

**Document Storage**
- Stores generated documents with optional `related_type` and `related_id` for cross-feature linking
- Other features may query documents by `related_type`/`related_id` to retrieve associated files

---

## Success Metrics

### Template Usage
- Templates generated per church
- Most popular templates
- Download rate

### Document Quality
- Regeneration rate (indicates issues)
- DOCX vs PDF preference

### User Satisfaction
- Template completeness feedback
- Feature satisfaction score

---

## Oversight Access Patterns

### Coach Access
- Can view generated documents for assigned churches

### Sending Church Admin Access
- Can see which templates have been used by their plants
- No document content access

### Network Admin Access
- Can see template usage statistics across network

### Privacy Controls
- Document template usage data is not considered sensitive and is not subject to privacy toggles
- Network-level template sharing (templates visible to all plants in a network) is a future enhancement

---

## Open Questions

1. **Custom templates:** Should planters be able to create and save custom templates?

2. **Branding:** Should templates support church logos and custom branding?

3. **Version control:** Should template versions be tracked when system templates are updated?

4. **Sharing:** Should documents be shareable with team members or coaches?

5. **E-signature:** Should commitment documents support electronic signatures?
