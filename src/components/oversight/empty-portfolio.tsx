// ============================================================================
// THE EMPTY PLANT PORTFOLIO — ONE COMPONENT, TWO SURFACES (#636).
//
// The `/oversight` index and the `/oversight/plants` directory show the same
// screen: there are no plants, here is what brings one, and — only for a reader
// who can send it — an invitation. It was written out twice, and the two copies
// had already drifted apart in their link styling before anyone noticed.
//
// THAT DUPLICATION IS WHY #636 EXISTED. #500 made an org Member read-only and
// fixed the empty states that carried a visible LINK; the index's third,
// link-less declaration of the same fact was missed and went on telling a
// Member to "Send invitations to get started" above a page with no invite
// control on it. Fixing the wording without removing the duplication would just
// leave the next fix to miss it the same way.
//
// THE CALLER OWNS THE CONTAINER. This renders a fragment, because the two
// surfaces frame it differently — the directory in a dashed card of its own,
// the index inside the "Plants by Phase" card it is already sitting in. The
// words and the seat gate are the shared part; the box is not.
//
// NOT THE SENDING-CHURCH ROSTER, and not `/oversight/health`. See the note on
// `emptyPortfolioCaption` for why those keep their own sentences.
// ============================================================================

import Link from "next/link";

import {
  EMPTY_PORTFOLIO_HEADLINE,
  emptyPortfolioCaption,
} from "@/lib/oversight/presentation";

export function EmptyPortfolio({
  scopeLabel,
  canInvite,
}: {
  /** "network" or "sending church" — the caller's own org, in their words. */
  scopeLabel: string;
  /**
   * WHETHER THIS READER MAY ACTUALLY SEND THAT INVITATION (#500).
   *
   * The call to action is a promise, and an org MEMBER cannot keep it —
   * `org.invitation.manage` is Owner-only, so the form behind the link is not
   * rendered for them. The sentence above it is true either way, which is why
   * only the link is gated.
   */
  canInvite: boolean;
}) {
  return (
    <>
      <h2 className="font-semibold">{EMPTY_PORTFOLIO_HEADLINE}</h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm text-pretty">
        {emptyPortfolioCaption(scopeLabel)}
      </p>
      {canInvite && (
        <p className="mt-4 text-sm">
          <Link
            href="/oversight/invitations"
            className="text-primary cursor-pointer font-medium underline underline-offset-4"
          >
            Invite a planter
          </Link>
        </p>
      )}
    </>
  );
}
