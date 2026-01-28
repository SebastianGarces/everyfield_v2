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
- [x] W-004: Full-text search across all wiki content
  - PostgreSQL FTS with GIN index (weighted: title > excerpt > content)
  - Command palette (Cmd+K) using shadcn Command component
  - Supports websearch syntax (AND, OR, phrases, exclusion)
- [x] W-005: Current phase indicator
  - Phase badge shown on wiki home page
  - Phase timeline shows current position
- [x] W-006: Phase-relevant recommendations
  - "Recommended for You" section filters by user's current phase
  - Completed articles filtered out from recommendations
- [x] W-007: Article progress tracking (not started/in progress/completed)
  - `wiki_progress` table tracks user reading progress
  - Status badges on article cards (Not started/Started/Complete)
  - `/wiki/progress` page shows overall and per-section progress
- [x] W-008: Breadcrumb navigation
  - `WikiBreadcrumb` component implemented
  - `getBreadcrumbs()` helper in lib
- [ ] W-009: Related articles cross-linking
  - `related_article_ids` defined in FRD but not implemented
- [ ] W-010: Template linking (F6 integration)
  - `related_template_ids` defined in FRD but not implemented

## Should Have

- [x] W-011: Bookmarking
  - `BookmarkButton` component toggles bookmark state
  - `BookmarkIndicator` shows bookmark status in lists
  - `wiki_bookmark` table stores user bookmarks
- [x] W-012: Reading progress (save scroll position)
  - `wiki_progress.scroll_position` tracks reading position
  - "Continue Reading" card on progress page shows last position
- [x] W-013: Time estimates (read time per article)
  - `readTime` parsed from frontmatter
  - Displayed in article header and list views
- [ ] W-014: Table of contents (right-side TOC)
- [x] W-015: Recently viewed
  - "Recently Viewed" section in sidebar shows last 5 articles
  - Updates dynamically as user visits articles
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
