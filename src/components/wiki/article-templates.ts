// ============================================================================
// Wiki → document templates (W-010, #317)
// ============================================================================
//
// The article a planter is reading is where they decide they need the document
// it describes. This maps a wiki article to the F6 templates that belong under
// it, resolved through the catalog so a link can only ever open a template that
// exists (`src/lib/documents/templates.ts`, read-only here).
//
// This is the wiki's half of DOC-014: resolution goes through
// `resolveContextualTemplates` and the shape is `ContextualTemplate`, both
// imported rather than restated, so the wiki cannot drift into a second
// definition of "link to a template".
//
// WHY A MAP AND NOT `template.relatedWikiSlug`
// --------------------------------------------
// The catalog carries `relatedWikiSlug`, which reads like a ready-made reverse
// index. It is not usable as one:
//
//   - It is the TEMPLATE's "read more" pointer (rendered by
//     `components/documents/generate-dialog.tsx`), a different direction and a
//     different editorial decision — one article per template, at most.
//   - Its values rotted once without anything failing. Every one of them
//     named a slug no published article had (`frameworks/the-3-key-documents`
//     for `core-group/commitment/the-three-key-documents`, and
//     `vision-meetings/running-a-vision-meeting` for
//     `core-group/vision-meetings/running-the-meeting`) — verified against all
//     96 rows in `wiki_articles`. Building this feature on that field would
//     have rendered an empty section on every article in the product while
//     type-checking and passing review — the same unverifiable-by-construction
//     trap W-009 hit with `related_article_slugs` (69ebbc1). The slugs were
//     repointed under ruling 406-1-1 and are now corpus-pinned by
//     `src/lib/documents/templates-live.test.ts`, but the direction argument
//     above still holds.
//   - Four templates (both budgets, the board agenda, the launch checklists)
//     carry no `relatedWikiSlug` at all, so a reverse index could never reach
//     them.
//
// `article-templates-live.test.ts` pins THIS map against the corpus so it
// cannot rot the same way.
//
// The keys are article slugs, exact match. An article that is not a key gets
// no section at all — most articles have no document to hand out, and an empty
// "Templates" heading is a promise the page does not keep.
// ============================================================================

import {
  resolveContextualTemplates,
  type ContextualTemplate,
} from "@/lib/documents/contextual";

/**
 * Article slug → the templates it hands out, in the order they are offered.
 *
 * Ordered deliberately: the document the article is chiefly about comes first.
 */
export const ARTICLE_TEMPLATE_IDS: Readonly<Record<string, readonly string[]>> =
  {
    // Commitment — the three documents this section exists to explain.
    "core-group/commitment/the-three-key-documents": [
      "commitment-card",
      "member-expectations",
      "launch-team-commitment",
    ],
    "core-group/commitment/core-group-commitments-explained": [
      "commitment-card",
      "member-expectations",
    ],
    "core-group/commitment/why-formalized-commitment-matters": [
      "commitment-card",
    ],

    // Vision meetings — the kit a planter prints before running one.
    "core-group/vision-meetings/planning-your-vision-meeting": [
      "vision-meeting-agenda",
      "guest-sign-in-sheet",
      "response-card",
    ],
    "core-group/vision-meetings/running-the-meeting": [
      "vision-meeting-agenda",
      "response-card",
      "guest-sign-in-sheet",
    ],
    "core-group/vision-meetings/the-vision-meeting-kit": [
      "vision-meeting-agenda",
      "guest-sign-in-sheet",
      "response-card",
      "follow-up-letter",
    ],
    "core-group/vision-meetings/vision-meeting-agenda-deep-dive": [
      "vision-meeting-agenda",
    ],

    // Follow-up.
    "core-group/follow-up/the-importance-of-great-follow-up": [
      "follow-up-letter",
    ],
    "core-group/follow-up/4-reasons-follow-up-is-vital": ["follow-up-letter"],

    // Launch team.
    "launch-team/launch-date/transitioning-to-launch-team": [
      "launch-team-commitment",
    ],

    // Administrative.
    "administrative/financial/first-year-budget-planning": [
      "first-year-budget",
      "budget-worksheet",
    ],
    "administrative/legal/setting-up-nonprofit-corporation": [
      "board-meeting-agenda",
    ],

    // Launch Sunday.
    "pre-launch/final-checklist-review": ["launch-sunday-checklists"],
    "launch-sunday/ministry-checklists": ["launch-sunday-checklists"],
  };

/**
 * Resolve catalog ids to renderable links — the DOC-014 resolver, which drops
 * an id the catalog does not know rather than rendering it (ruling 406-2-1;
 * the drop rationale lives on `resolveContextualTemplates`).
 */
export function resolveArticleTemplates(
  ids: readonly string[]
): ContextualTemplate[] {
  return resolveContextualTemplates(ids);
}

/**
 * The templates offered at the foot of `slug`, or `[]` when it offers none.
 *
 * Pure and synchronous — the catalog is code, not a table — so a component may
 * call it during render without a round trip.
 */
export function getArticleTemplates(slug: string): ContextualTemplate[] {
  // `Object.hasOwn`, not `?? []`: the slug arrives from the catch-all route, so
  // an article named `toString` or `constructor` would otherwise resolve to an
  // inherited `Object.prototype` member — a value the types promise is a list
  // of ids and that iterating would throw on.
  const ids = Object.hasOwn(ARTICLE_TEMPLATE_IDS, slug)
    ? ARTICLE_TEMPLATE_IDS[slug]
    : [];

  return resolveArticleTemplates(ids);
}
