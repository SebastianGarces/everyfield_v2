# App Layout - Implementation Notes

**FRD:** `product-docs/features/wiki/frd.md` (primary navigation reference)
**Date Started:** 2026-01-26

## Goal

Implement the initial app layout with shadcn sidebar component, designed to support the Wiki's deep hierarchical navigation requirements.

## Key Decisions

- **Sidebar Pattern**: Using shadcn's collapsible sidebar with nested navigation (similar to sidebar-07/sidebar-09 blocks)
- **Wiki Navigation Strategy**: Collapsible submenu approach within the primary sidebar, with potential for stacked secondary sidebar when Wiki content grows
- **Styling**: Stick to shadcn's default styles, minimal custom Tailwind
- **Responsive**: Mobile uses offcanvas collapsible, desktop uses icon collapse

## Navigation Structure (Primary Sidebar)

Based on the feature set in system-architecture.md:
- Dashboard (F4)
- Wiki (F1) - with deep nested navigation
- People/CRM (F2)
- Vision Meetings (F3)
- Tasks (F5)
- Documents (F6)
- Financial (F7)
- Ministry Teams (F8)
- Communication (F9)
- Facilities (F10)

## Wiki Navigation Depth (from FRD)

```
Wiki
├── Home
├── The Journey (Phase-based)
│   └── Phase 0-6 (each with subsections)
├── Ministry Teams (Reference)
├── Frameworks & Concepts
├── Administrative
├── Templates & Downloads
└── Training Library
```

## Constraints

- Use shadcn CLI to add components (`bunx --bun shadcn@latest add sidebar`)
- Minimal custom Tailwind - rely on shadcn component styles
- Must be responsive (mobile collapsible)
- Must support persisted sidebar state (cookies)

## Open Questions

- Do we need the stacked/sliding secondary sidebar now, or start with collapsible sections and evolve?
  - **Decision**: Start with collapsible sections in primary sidebar. Add secondary sidebar pattern when Wiki is fully implemented.

## Out of Scope

- Wiki content/pages (just layout structure)
- Authentication UI in sidebar (will be added later)
- Search functionality (will be added later)
