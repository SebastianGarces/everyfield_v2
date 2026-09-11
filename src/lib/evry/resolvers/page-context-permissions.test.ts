import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuthorizedEvryPageContext } from "./page-context";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

for (const seat of ["admin", "member"] as const) {
  for (const kind of ["plant_insight", "plant_intelligence"] as const) {
    test(`${seat} cannot use forged ${kind} context to bypass the registered read permission`, async () => {
      const actor: EvryPlantActor = {
        userId: "10000000-0000-4000-8000-000000000001",
        plantId: "20000000-0000-4000-8000-000000000001",
        seat,
      } as EvryPlantActor;
      assert.equal(
        await resolveAuthorizedEvryPageContext({
          actor,
          pageContext: {
            kind,
            recordId:
              kind === "plant_insight"
                ? "30000000-0000-4000-8000-000000000001"
                : "current",
          },
        }),
        null
      );
    });
  }
}
