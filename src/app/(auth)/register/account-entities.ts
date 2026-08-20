// ============================================================================
// WHAT REGISTRATION WRITES — the seat, its tenancy, and the org row the tenancy
// points at, decided before any statement is sent.
//
// A SIBLING MODULE WITH NO `"use server"` DIRECTIVE, deliberately. Every export
// of a `"use server"` module is a POSTable endpoint reachable with no session
// and no UI (`memory/invariants.md` → Authentication), so `./actions.ts` may
// export exactly one thing — the `register` action — and this planner is not
// it. Splitting it out is also what lets its suite call it directly: this is
// the ONE place outside seat management where a seat is granted (AS-012), so
// what it grants is worth asserting rather than inferring from a rendered
// INSERT.
//
// The statements are BUILT, never awaited: the caller batches them with the
// users insert so the entity, the account, the church link and the privacy row
// commit or roll back together.
// ============================================================================

import { db } from "@/db";
import type { InvitableSeat, UserSeat } from "@/db/schema";
import { sendingChurches, sendingNetworks } from "@/db/schema";
import { churchCreationStatements } from "@/lib/onboarding/create-church";
import { accountPersonLinkStatements } from "@/lib/people/account-person-link";
import type { AccountType } from "@/lib/validations/auth";
import type { BatchItem } from "drizzle-orm/batch";

/**
 * A seat invitation this registration is redeeming (AS-012, #495) — resolved by
 * the action from the emailed token, never from anything a client said.
 *
 * `matchedPersonId` comes from `findLinkablePersonId`: the plant may already
 * hold a contact record for this address, and AS-013 says it is LINKED rather
 * than duplicated. The read happens in the action because this planner awaits
 * nothing; the DECISION about which statement to issue stays in the directory's
 * own `accountPersonLinkStatements`.
 */
export type RedeemedSeatInvitation = {
  churchId: string;
  seat: InvitableSeat;
  matchedPersonId: string | null;
};

/**
 * Plan the organizational entity for the account type: the seat and tenancy FK
 * to set on the user, plus the entity's statements for the caller's batch —
 * never awaited here, so the entity, the user, the church link and the privacy
 * row commit or roll back together. Ids are minted up front
 * (`crypto.randomUUID()`, as `createChurchDeps.newChurchId` does) so each
 * statement can reference rows that do not exist yet.
 *
 * Planters sign up without creating a church — they get free access to
 * Phase 0 content and the Wiki. They create their church from the dashboard
 * when they're ready.
 */
export function createAccountEntities(
  accountType: AccountType,
  organizationName: string | null,
  userId: string,
  /**
   * The account being registered, for the `persons` row an invited planter's
   * church-creation tuple mints them (AS-013, #378). Every account type takes
   * it because it describes the registrant, not the entity — only the planter
   * branch has a church to put a person in.
   */
  account: { name: string | null; email: string },
  createChurchForPlanter = false,
  /**
   * A seat invitation being redeemed. When present it DECIDES the whole plan and
   * every other argument about organizations is ignored: the plant already
   * exists, nothing is created, and the account joins it with the invited seat.
   */
  seatInvitation: RedeemedSeatInvitation | null = null
): {
  seat: UserSeat | null;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  /**
   * What the USERS INSERT writes into `church_id`.
   *
   * Not the same field as `churchId` above, and the difference is the whole
   * reason it exists. `churchId` names the plant this registration ends up in,
   * whoever writes the link; this is the value the insert itself may carry.
   *
   *   * an invited PLANTER: `null`. Their plant is created in the same batch and
   *     the link is written by `linkUserToChurchFilter`'s compare-and-set, so the
   *     link contract keeps one spelling (ruling 408-4B).
   *   * an invited SEAT: the invitation's plant, which already exists. There is
   *     no race to compare-and-set against — the seat and its tenancy are
   *     written together, in the one insert, which is what AS-012 asks for.
   */
  userChurchId: string | null;
  /**
   * Statements the users FKs point at — batched BEFORE its insert. Empty for
   * planters: an invited planter's church tuple lives in `linkStatements`.
   */
  statements: BatchItem<"pg">[];
  /**
   * Statements that need the users row to exist — batched AFTER its insert.
   * For an invited planter this is `churchCreationStatements` whole.
   */
  linkStatements: BatchItem<"pg">[];
} {
  // A SEAT INVITATION DECIDES EVERYTHING, and it is checked before the account
  // type is even read (AS-012, #495).
  //
  // The registrant clicked a link that already names a plant and a seat, so
  // whichever radio button their form carried is not a question: creating a
  // second organization for them would leave the account naming two tenancies,
  // which `holdsSeatFor` refuses outright and no product path can repair. The
  // ONLY writes are the account's own — the seat and its tenancy go into the
  // users insert, and the person record AS-013 asks for is minted or claimed
  // after it.
  if (seatInvitation) {
    return {
      seat: seatInvitation.seat,
      churchId: seatInvitation.churchId,
      sendingChurchId: null,
      sendingNetworkId: null,
      userChurchId: seatInvitation.churchId,
      statements: [],
      linkStatements: accountPersonLinkStatements({
        userId,
        churchId: seatInvitation.churchId,
        name: account.name,
        email: account.email,
        matchedPersonId: seatInvitation.matchedPersonId,
      }),
    };
  }

  switch (accountType) {
    case "planter": {
      // An INVITED planter is the exception: the invitation exists to associate
      // a church plant, so the plant is created here and named by the planter.
      // Note what is NOT set — neither oversight FK. The association is written
      // by the accept path, guarded on the invitation reading `accepted`, so
      // the plant can never be bound to an org without an acceptance behind it.
      if (createChurchForPlanter && organizationName) {
        // The church-creation contract is stated ONCE, by
        // `churchCreationStatements` (`src/lib/onboarding/create-church.ts`,
        // ruling 408-4B), and spread here WHOLE, in the tuple's own order —
        // no individual statement is named, so a statement added to the
        // contract reaches this path with no edit here. The whole tuple goes
        // AFTER the users insert, which is FK-safe: `churches` references no
        // users column, and the users insert writes `churchId: null` (the
        // tuple's own compare-and-set writes the link), so register and
        // onboarding's step 1 issue identical church-creation SQL.
        const churchId = crypto.randomUUID();

        return {
          seat: "owner",
          churchId,
          sendingChurchId: null,
          sendingNetworkId: null,
          userChurchId: null,
          statements: [],
          linkStatements: [
            ...churchCreationStatements({
              churchId,
              plantedBy: userId,
              plantedByName: account.name,
              plantedByEmail: account.email,
              name: organizationName,
              city: null,
              stateRegion: null,
              country: null,
            }),
          ],
        };
      }

      // No church created at signup — planter gets free Phase 0 / Wiki access
      // They'll create a church from the dashboard when ready
      return {
        seat: "owner",
        churchId: null,
        sendingChurchId: null,
        sendingNetworkId: null,
        userChurchId: null,
        statements: [],
        linkStatements: [],
      };
    }

    case "sending_church": {
      if (!organizationName) {
        throw new Error(
          "Organization name is required for sending church accounts"
        );
      }
      // Create a new sending church (independent, no network)
      const sendingChurchId = crypto.randomUUID();

      return {
        seat: "owner",
        churchId: null,
        sendingChurchId,
        sendingNetworkId: null,
        userChurchId: null,
        statements: [
          db
            .insert(sendingChurches)
            .values({ id: sendingChurchId, name: organizationName }),
        ],
        linkStatements: [],
      };
    }

    case "network": {
      if (!organizationName) {
        throw new Error("Organization name is required for network accounts");
      }
      // Create a new sending network
      const sendingNetworkId = crypto.randomUUID();

      return {
        seat: "owner",
        churchId: null,
        sendingChurchId: null,
        sendingNetworkId,
        userChurchId: null,
        statements: [
          db
            .insert(sendingNetworks)
            .values({ id: sendingNetworkId, name: organizationName }),
        ],
        linkStatements: [],
      };
    }
  }
}
