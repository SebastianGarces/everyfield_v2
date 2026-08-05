import { WikiProgressCard } from "@/components/wiki/wiki-progress-card";

import {
  FS_WIKI_PROGRESS_FIXTURE,
  FS_WIKI_SECTION_COUNT,
} from "./fs-wiki-progress-fixture";

/**
 * The Wiki panel's overlay — the app's own "My Wiki Progress" page, live.
 *
 * The panel's primary visual stays a capture of the article itself (r5-wiki):
 * a wiki chapter is prose, and prose is the one thing a screenshot renders
 * perfectly. What the overlay adds is the claim the panel actually makes —
 * *the app knows which chapter your plant is living in right now* — so the
 * overlay is the surface that tracks it, and it should be the real one.
 *
 * The Continue Reading card underneath names Launch Day Guide, which is the
 * chapter the crop behind it has open. That is the database's doing, not a
 * composition trick (see fs-wiki-progress-fixture.ts), and it is the reason
 * these two belong on the same panel.
 *
 * ONE COMPONENT, TWO CROPS — and a crop rather than a hand-built subset on
 * purpose. `WikiProgressCard` renders a whole page body: header, overall
 * progress, ten section rows, continue-reading. Dropping rows from the fixture
 * to make it fit would leave "4 of 96" sitting above a section list that no
 * longer adds up, so instead the mount clips it, exactly the way the retired
 * r5-wikiprog capture was itself a crop of the top of that page. Desktop shows
 * through the first section rows; mobile shows through the overall bar, at the
 * app's real type size. The visible footnote says how many sections are below
 * the cut. Crop heights live in marketing.css, in the component's own
 * unscaled pixels, so the zoom ladder cannot desynchronise from them.
 *
 * Server components. The only client island in the subtree is the Radix
 * progress bar the card itself uses.
 */

/** One sentence, because the mount is one picture of the product — and it
 *  carries the section count the crops cut off. It lives on the mount, with
 *  `inert` one level in: an inert element is itself outside the accessibility
 *  tree, so a label on it would never be announced. */
const EMBED_LABEL =
  "My Wiki Progress in the app — 4 of 96 articles read, 4% overall, with each of the ten sections of the methodology tracked underneath.";

function ProgressBody() {
  return <WikiProgressCard {...FS_WIKI_PROGRESS_FIXTURE} />;
}

/** Desktop: the overlay that lands on the open-article crop. */
export function FsWikiProgressOverlay() {
  return (
    <div className="vg-fs-overlay vg-fs-wiki">
      <div className="vg-app-embed" role="img" aria-label={EMBED_LABEL}>
        <div inert>
          <ProgressBody />
        </div>
      </div>
    </div>
  );
}

/**
 * Mobile: the top of the same page at the app's own type sizes — no scaling,
 * because a 375px screen has room for the headline number and nothing else.
 * The stacked story section already carries the heading and the sentence, so
 * the only marketing chrome is the footnote for what sits below the cut.
 */
export function FsWikiProgressMobile() {
  return (
    <div className="vg-fs-m vg-fs-wiki-m">
      <div className="vg-app-embed" role="img" aria-label={EMBED_LABEL}>
        <div inert>
          <ProgressBody />
        </div>
      </div>
      <p className="vg-sc-foot">
        {FS_WIKI_SECTION_COUNT} sections underneath — every phase of the
        methodology, tracked.
      </p>
    </div>
  );
}
