import { TemplateCardView } from "@/components/documents/template-card-view";

import { COMMITMENT_CARD } from "./doc-card-fixture";

/**
 * The document card that floats over the guides panel — the app's own card,
 * rendered live.
 *
 * It replaces a capture of the same card (r8-doccard.webp) in the feature
 * switcher's "Guides & documents" panel; the profile-with-interview-guide crop
 * underneath it stays a capture. What lands here is
 * `components/documents/template-card-view.tsx` — the single definition of what
 * a template card looks like in the product — reading the real catalog entry
 * (see doc-card-fixture.ts). The card's action is a slot, and passing nothing
 * is exactly right for a landing page: the footer renders the same Generate
 * button the app renders, with no handler behind it.
 *
 * Desktop only, and that is the panel's rule rather than this file's: overlays
 * are desktop-only (the mobile stack shows one visual per feature, nothing
 * layered), and `.fswitch` is itself hidden below 900px. So there is no compact
 * composition here — below 900px the guides story keeps its own single crop.
 *
 * Server component. It must be rendered by a server parent and handed to
 * `FeatureSwitcher` as a prop: that client module importing this one would pull
 * the card, its icons and the template catalog into the browser bundle.
 *
 * `inert` sits inside the `role="img"` mount, not on it: the Generate button is
 * a real focusable button, and a picture of the product must have nothing
 * tabbable in it — but `inert` also drops its subtree from the accessibility
 * tree, so the mount above it keeps the name that describes the picture.
 */

const EMBED_LABEL =
  "The Core Group Commitment Card in EveryField's document library — a one-page PDF founding members sign to commit to GROW, PRAY and GIVE through Launch Sunday, one button away from being generated with this church's details.";

export function DocCardOverlay() {
  return (
    <div className="vg-fs-overlay vg-fs-doc">
      <div className="vg-app-embed" role="img" aria-label={EMBED_LABEL}>
        <div inert>
          <TemplateCardView template={COMMITMENT_CARD} />
        </div>
      </div>
    </div>
  );
}
