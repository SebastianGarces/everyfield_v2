import {
  catalogCoverage,
  selectCases,
} from "../src/lib/evry/eve/evals/catalog";

// Read-only, zero-provider-cost inventory. This command deliberately does not say pass.
const profileArg = process.argv[2] ?? "full";
if (
  profileArg !== "full" &&
  profileArg !== "smoke" &&
  profileArg !== "security"
) {
  throw new Error(
    "Usage: node --import tsx scripts/evry-eve-eval-inventory.ts [full|smoke|security]"
  );
}
console.log(
  JSON.stringify(
    {
      status: "not_run",
      profile: profileArg,
      coverage: catalogCoverage(),
      selected: selectCases(profileArg).map(
        ({ id, domain, turns, expected }) => ({
          id,
          domain,
          turns,
          expected,
          status: "not_run",
        })
      ),
    },
    null,
    2
  )
);
