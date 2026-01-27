# Wiki Article Writing Skill

## When to Use

- When creating or editing wiki articles in the `wiki/` directory
- When the user references `product-docs/wiki/article-checklist.md`
- When asked to write content based on the Launch Playbook

## Purpose

This skill provides guidelines for writing consistent, high-quality wiki articles in MDX format. All articles should follow the same structure, tone, and component usage patterns.

## Article Structure

### Frontmatter (Required)

Every article must start with frontmatter containing these fields:

```mdx
{/_
title: Article Title
type: reference | guide | overview | template
phase: 1 | 2 | 3 | 4
section: introduction | core-group | vision-meetings | follow-up | commitment | launch-date | training | leadership | project-management | pre-launch | launch-sunday | legal | financial | purchasing | technology | templates
read_time: <estimated minutes to read>
description: A 1-2 sentence description for SEO and article previews.
_/}
```

**Note:** Use `{/_` and `_/}` for MDX comments in frontmatter (the actual syntax uses `/*` and `*/` but we escape for display).

### Article Types

| Type | Purpose | Typical Length |
|------|---------|----------------|
| `overview` | High-level introduction to a topic | 800-1200 words |
| `guide` | Step-by-step instructions | 1200-2000 words |
| `reference` | Detailed breakdown of concepts | 1500-2500 words |
| `template` | Downloadable/copyable resources | Varies |

### Standard Sections

Most articles should follow this structure:

```mdx
{/*
title: Article Title Here
type: overview
phase: 1
section: introduction
read_time: 5
description: A 1-2 sentence description for SEO and article previews.
*/}

Opening paragraph (2-3 sentences) that:
- States what this article covers
- Explains why it matters
- Sets expectations for the reader

---

## Section 1

Content...

## Section 2

Content...

---

## Related Articles

- [Article Name](/wiki/path/to/article)

## Related Templates

- [Template Name](/templates/template-name)

---

<Callout type="scripture">
  *"Scripture quote"* — Book Chapter:Verse
</Callout>

Closing statement connecting back to the mission.
```

**IMPORTANT: Do NOT include an H1 (`# Title`) at the start of the article content.** The title is defined in frontmatter and rendered automatically by the page layout. Adding an H1 with the same title creates duplicate headers on the page.

## Writing Guidelines

### Tone & Voice

- **Authoritative but warm** — You're a trusted mentor, not a lecturer
- **Direct and actionable** — Tell readers what to do, not just what exists
- **Encouraging** — Acknowledge challenges while maintaining confidence
- **Ministry-focused** — This is about building the church, not running a business

### Formatting Rules

1. **Never duplicate the title** — The title is in frontmatter; do NOT add an H1 (`# Title`) at the start of content
2. **Use em dashes with bold for key terms** — **This is important** when introducing concepts
3. **Keep paragraphs short** — 2-4 sentences maximum for readability
4. **Use headers liberally** — Break content into scannable sections (start with H2 `##`)
5. **Lead with the "why"** — Explain importance before diving into details
6. **End sections with value** — Don't trail off; make closing statements meaningful

### Tables

Use tables for:
- Comparisons
- Checklists
- Time-based agendas
- Quick reference information

```mdx
| Column 1 | Column 2 |
|----------|----------|
| Value 1  | Value 2  |
```

### Lists

Use bullet lists for:
- Unordered items
- Options or alternatives
- Feature lists

Use numbered lists for:
- Sequential steps
- Prioritized items
- Ranked options

Use checkbox lists for:
- Checklists and to-dos
- Requirements to verify

```mdx
- [ ] Unchecked item
- [x] Checked item (for examples only)
```

## MDX Components

### Callout Component

Use callouts to highlight important information:

```mdx
<Callout type="tip">
  Practical advice the reader can immediately apply.
</Callout>

<Callout type="warning">
  Potential pitfalls or mistakes to avoid.
</Callout>

<Callout type="important">
  Critical information that must not be overlooked.
</Callout>

<Callout type="insight">
  Deeper understanding or "aha moment" content.
</Callout>

<Callout type="scripture">
  *"Bible verse text"* — Book Chapter:Verse
</Callout>
```

**Callout Guidelines:**
- Use sparingly — 2-4 per article maximum
- Don't stack callouts back-to-back
- Always provide actionable or memorable content
- Scripture callouts typically appear at article end

### Future Components

When writing articles, you may reference components that don't exist yet. Note them in `product-docs/wiki/article-checklist.md` under Component Tracker:

- `<PhaseIndicator phase={1} />` — Visual badge showing launch phase
- `<Checklist items={[...]} storageKey="unique-key" />` — Interactive checklist
- `<Timeline events={[...]} />` — Visual timeline
- `<RoleCard role="..." />` — Leadership role summary
- `<ProcessFlow steps={[...]} />` — Visual flowchart
- `<QuickReference title="...">...</QuickReference>` — Collapsible section
- `<RelatedArticles articles={[...]} />` — Styled links
- `<TemplateDownload template="..." />` — Download button

## Content Guidelines

### Source Material

Primary source: `product-docs/launch-playbook.md`

When writing articles:
1. Extract relevant sections from the playbook
2. Expand with additional context and explanation
3. Add practical examples where helpful
4. Break dense content into digestible sections
5. Add callouts for emphasis

### Cross-Referencing

- Link to related articles using relative paths: `/wiki/phase-1/topic/article`
- Link to templates using: `/templates/template-name`
- Only add links to articles that exist (check `article-checklist.md`)
- Use "Related Articles" sections at the end

### The 4 C's

Core Group members must be **COMMITTED, COMPELLED, CONTAGIOUS, and COURAGEOUS**. This framework appears throughout the playbook. When referencing:

- Use bold and all caps: **COMMITTED, COMPELLED, CONTAGIOUS, and COURAGEOUS**
- Or shorthand: "the 4 C's"
- Link to the dedicated article when first mentioned in an article

### Key Terminology

| Term | Usage |
|------|-------|
| Core Group | Always capitalize |
| Launch Team | Always capitalize |
| Vision Meeting | Always capitalize |
| Senior Pastor | Always capitalize |
| Launch Sunday | Always capitalize |
| 4 Pillars | Capitalize, use "the 4 Pillars" |
| Worship/Walk/Work | Use forward slashes |

## Workflow

### Creating a New Article

1. Check `product-docs/wiki/article-checklist.md` for the article assignment
2. Read relevant sections of `product-docs/launch-playbook.md`
3. Create the file at the specified path in the checklist
4. Follow the structure and guidelines in this skill
5. Update the checklist status to ✅ when complete

### Article Checklist

Before marking an article complete:

- [ ] Frontmatter is complete with all required fields
- [ ] **No H1 title in content** (title comes from frontmatter only)
- [ ] Opening paragraph sets context and expectations
- [ ] Content sections start with H2 (`##`), not H1
- [ ] Content is broken into logical sections with headers
- [ ] Tables and lists are used appropriately
- [ ] Callouts are used sparingly and effectively
- [ ] Related Articles section includes relevant links (to existing articles only)
- [ ] Related Templates section includes relevant links (if applicable)
- [ ] Closing scripture and statement are included
- [ ] Article flows logically from start to finish
- [ ] No placeholder text remains
- [ ] New component needs are logged in the checklist

### Updating the Checklist

After completing an article:

1. Open `product-docs/wiki/article-checklist.md`
2. Change status from ⬜ to ✅
3. Update the Progress Summary counts
4. Note any new components needed in the Component Tracker

## File Naming

- Use kebab-case: `article-name-here.mdx`
- Keep names concise but descriptive
- Match the naming pattern in `article-checklist.md`

## Context Management

When working on wiki articles:

1. Load this skill
2. Load `product-docs/wiki/article-checklist.md`
3. Load the specific section of `product-docs/launch-playbook.md` relevant to the article
4. Load one existing article as a reference for formatting (e.g., `wiki/phase-1/introduction/welcome-to-the-launch-playbook.mdx`)

Do NOT load:
- Other FRDs
- Unrelated wiki articles
- The entire launch playbook (only relevant sections)

**Remember:** Articles should NOT have an H1 title in content—the title comes from frontmatter and is rendered by the page layout.
