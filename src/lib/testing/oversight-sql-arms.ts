// ============================================================================
// SPLIT A RENDERED OVERSIGHT AUDIENCE INTO ITS ARMS, so an assertion about one
// arm cannot be satisfied by the other.
//
// WHY THIS EXISTS. The audience renders as `(<armA>) or (<armB>)`, and both
// arms contain the substring `church_id is null`. A whole-string
// `assert.match(sql, /church_id is null/)` therefore passes when EITHER arm
// carries the guard — so deleting it from one arm leaves every such assertion
// green while the audience silently admits a row with a competing tenancy. That
// mutant survived a suite that looked thorough, which is the whole reason the
// arms are separated here before anything is asserted about them.
//
// The predecessor of this helper was a per-arm regex pinned to CLAUSE ORDER
// (`fk = $1 and (church_id is null and other is null)`). That failed for the
// opposite reason: the conjunction is built by filtering a column list, so its
// order follows the pairing table and is not itself the rule. Splitting first
// and matching within an arm is what makes an assertion order-free AND
// arm-scoped at the same time.
// ============================================================================

/**
 * One arm of a rendered audience: the tenancy column it is keyed on, and the
 * arm's own SQL text.
 */
export interface OversightSqlArm {
  /** The FK this arm matches on — `sending_church_id` or `sending_network_id`. */
  readonly fk: string;
  /** This arm's text ALONE. Nothing from the sibling arm is in here. */
  readonly sql: string;
}

/** The two columns an audience arm can be keyed on. */
const OVERSIGHT_FKS = ["sending_church_id", "sending_network_id"] as const;

/**
 * Every `(<ref>.<oversight fk> = … and (… is null …))` arm in a rendered
 * statement.
 *
 * SCOPED TO THE REF AND TO THE TWO ORG COLUMNS, deliberately. The digest
 * sweep's statement is far bigger than the audience alone and contains other
 * clauses of the very same `(x.y = … and (…))` shape — an unscoped scan found
 * five "arms" there. Naming the table reference and the FK set is what makes
 * this return the audience's arms and only those.
 *
 * The inner conjunction never nests further, so a scan with no nested-paren
 * handling is exact rather than approximate. Quotes are stripped by the caller
 * (`sql.replace(/"/g, "")`), which is the form every assertion in this repo
 * reads.
 */
export function oversightSqlArms(
  normalised: string,
  ref: string
): OversightSqlArm[] {
  const ARM = new RegExp(
    `\\(${ref}\\.(${OVERSIGHT_FKS.join("|")}) = [^()]*? and \\(([^()]*)\\)\\)`,
    "g"
  );

  return [...normalised.matchAll(ARM)].map((match) => ({
    fk: match[1],
    sql: match[0],
  }));
}

/**
 * The arm keyed on `fk`, or a throw naming what was actually rendered.
 *
 * Throws rather than returning undefined so a caller cannot accidentally assert
 * against `undefined?.sql` and pass — the failure mode this whole module is
 * about.
 */
export function armFor(arms: OversightSqlArm[], fk: string): OversightSqlArm {
  const arm = arms.find((candidate) => candidate.fk === fk);

  if (!arm) {
    throw new Error(
      `no audience arm is keyed on ${fk} — arms found: ${
        arms.map((candidate) => candidate.fk).join(", ") || "(none)"
      }`
    );
  }

  return arm;
}
