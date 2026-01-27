# Wiki / Knowledge Base – Implementation Checklist

## Must Have

- [x] W-001: Phase-based content organization
  - Articles organized in `/wiki` by phase directories
  - Navigation groups articles by phase (0-6)
- [x] W-002: Article viewing with rich formatting
  - MDX compilation via `next-mdx-remote`
  - Callout component, prose styling
- [x] W-003: Hierarchical navigation with collapsible sections
  - `WikiSidebar` with collapsible sections via Radix Collapsible
  - Nested navigation structure (groups > sections > articles)
- [ ] W-004: Full-text search across all wiki content
  - Placeholder in sidebar ("Search coming soon...")
  - Requires DB migration or search index
- [ ] W-005: Current phase indicator
  - Requires user/church context integration
- [ ] W-006: Phase-relevant recommendations
  - Home page shows Phase 1 articles statically
  - Needs dynamic filtering based on user's current phase
- [ ] W-007: Article progress tracking (not started/in progress/completed)
  - Requires `WikiProgress` table (DB migration)
- [x] W-008: Breadcrumb navigation
  - `WikiBreadcrumb` component implemented
  - `getBreadcrumbs()` helper in lib
- [ ] W-009: Related articles cross-linking
  - `related_article_ids` defined in FRD but not implemented
- [ ] W-010: Template linking (F6 integration)
  - `related_template_ids` defined in FRD but not implemented

## Should Have

- [ ] W-011: Bookmarking
  - Placeholder in sidebar ("coming soon")
  - Requires `WikiBookmark` table (DB migration)
- [ ] W-012: Reading progress (save scroll position)
  - Requires `WikiProgress.scroll_position` (DB migration)
- [x] W-013: Time estimates (read time per article)
  - `readTime` parsed from frontmatter
  - Displayed in article header and list views
- [ ] W-014: Table of contents (right-side TOC)
- [ ] W-015: Recently viewed
  - Placeholder in sidebar ("coming soon")
  - Requires `WikiProgress.updated_at` tracking (DB migration)
- [ ] W-016: Article feedback (thumbs up/down)
- [ ] W-017: Contextual surfacing in other features
- [ ] W-018: Download as PDF
- [ ] W-019: Video content embedding
  - MDX supports embeds but no dedicated `WikiVideo` integration
- [ ] W-020: Print-friendly styling

## Nice to Have

- [ ] W-021: Offline reading
- [ ] W-022: Audio versions
- [ ] W-023: Coach annotations
- [ ] W-024: Network customization
- [ ] W-025: Content versioning
- [ ] W-026: Interactive quizzes
- [ ] W-027: Personalized paths (AI-driven)
- [ ] W-028: Multi-language support
