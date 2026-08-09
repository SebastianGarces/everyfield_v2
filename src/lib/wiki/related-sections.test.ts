import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRelatedSection, relatedHrefToSlug } from "./related-sections";

// ----------------------------------------------------------------------------
// Lifting the authored "## Related Articles" section into the column (#317).
//
// This parser ran once, over 96 live articles, and deleted content from every
// one of them. What is pinned here is the two boundaries that make that safe:
//
//   - The section ends at the end of its LINK LIST, not at the next heading.
//     It is the last heading in every article, so the heading rule would have
//     taken the closing Callout and final paragraph with it.
//
//   - The heading is fenced by two `---` rules; the leading one goes with the
//     section, or the two survivors end up adjacent.
//
// Anything else inside the section aborts instead of guessing, because a
// partial strip destroys prose that no test would notice.
// ----------------------------------------------------------------------------

/** The shape every article in the corpus actually has. */
const CORPUS_ARTICLE = `# The Final 3-4 Weeks

Some prose about the final weeks.

## A Section

More prose.

---

## Related Articles

- [Operations](/wiki/pre-launch/operations-setup-teardown)
- [The Promotion Plan](/wiki/pre-launch/the-promotion-plan)

---

<Callout type="scripture">
  *"Unless the Lord builds the house..."* — Psalm 127:1
</Callout>

You've prepared diligently.`;

test("the authored links come out in order", () => {
  const parsed = parseRelatedSection(CORPUS_ARTICLE);

  assert.ok(parsed);
  assert.deepEqual(parsed.hrefs, [
    "/wiki/pre-launch/operations-setup-teardown",
    "/wiki/pre-launch/the-promotion-plan",
  ]);
  assert.equal(parsed.unparsedListItem, null);
});

test("the closing Callout survives — the section stops at its list", () => {
  const parsed = parseRelatedSection(CORPUS_ARTICLE);

  assert.ok(parsed);
  assert.match(parsed.content, /<Callout type="scripture">/);
  assert.match(parsed.content, /You've prepared diligently\.$/);
  assert.doesNotMatch(parsed.content, /Related Articles/);
  assert.doesNotMatch(parsed.content, /operations-setup-teardown/);
});

test("exactly one thematic break is left between the prose and the Callout", () => {
  const parsed = parseRelatedSection(CORPUS_ARTICLE);

  assert.ok(parsed);
  assert.equal(
    parsed.content,
    `# The Final 3-4 Weeks

Some prose about the final weeks.

## A Section

More prose.

---

<Callout type="scripture">
  *"Unless the Lord builds the house..."* — Psalm 127:1
</Callout>

You've prepared diligently.`
  );
});

test("an article with no such section is left alone", () => {
  assert.equal(parseRelatedSection("# Title\n\nJust prose.\n"), null);
});

test("re-parsing stripped content is a no-op — the migration is idempotent", () => {
  const once = parseRelatedSection(CORPUS_ARTICLE);
  assert.ok(once);
  assert.equal(parseRelatedSection(once.content), null);
});

test("the heading matches case-insensitively at either level", () => {
  for (const heading of [
    "## Related Articles",
    "## Related articles",
    "### RELATED ARTICLES",
  ]) {
    const parsed = parseRelatedSection(
      `Prose.\n\n${heading}\n\n- [A](/wiki/a)\n`
    );
    assert.ok(parsed, `${heading} was not recognised`);
    assert.deepEqual(parsed.hrefs, ["/wiki/a"]);
  }
});

test("a heading that merely mentions related articles is not the section", () => {
  assert.equal(
    parseRelatedSection("## Related Articles and Other Reading\n\n- [A](/a)"),
    null
  );
});

test("a section running to EOF takes its leading rule with it", () => {
  const parsed = parseRelatedSection(
    "Prose.\n\n---\n\n## Related Articles\n\n- [A](/wiki/a)\n"
  );

  assert.ok(parsed);
  assert.equal(parsed.content, "Prose.");
});

test("a section with no rule around it removes only itself", () => {
  const parsed = parseRelatedSection(
    "Prose.\n\n## Related Articles\n\n- [A](/wiki/a)\n\nClosing words."
  );

  assert.ok(parsed);
  assert.equal(parsed.content, "Prose.\n\nClosing words.");
});

test("a non-link list item aborts instead of half-stripping the section", () => {
  const parsed = parseRelatedSection(
    "Prose.\n\n---\n\n## Related Articles\n\n- [A](/wiki/a)\n- Ask your coach about the rest\n\n---\n\nEnd."
  );

  assert.ok(parsed);
  assert.equal(parsed.unparsedListItem, "- Ask your coach about the rest");
});

// ============================================================================
// Href → slug
// ============================================================================

test("every authored href shape names the same article", () => {
  for (const href of [
    "/wiki/pre-launch/the-final-3-4-weeks",
    "/pre-launch/the-final-3-4-weeks",
    "pre-launch/the-final-3-4-weeks",
    "/wiki/pre-launch/the-final-3-4-weeks/",
    "/wiki/pre-launch/the-final-3-4-weeks#top",
    "/wiki/pre-launch/the-final-3-4-weeks?from=x",
  ]) {
    assert.equal(
      relatedHrefToSlug(href),
      "pre-launch/the-final-3-4-weeks",
      `${href} did not resolve`
    );
  }
});

test("a link that leaves the wiki is not a slug", () => {
  assert.equal(relatedHrefToSlug("https://example.com/wiki/a"), null);
  assert.equal(relatedHrefToSlug("mailto:someone@example.com"), null);
  assert.equal(relatedHrefToSlug("//example.com/a"), null);
  assert.equal(relatedHrefToSlug("#section"), null);
  assert.equal(relatedHrefToSlug("   "), null);
});
