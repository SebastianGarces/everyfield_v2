import { PEOPLE_QUERY_READS } from "@/lib/evry/capabilities/queries/people";
import { OPERATIONS_QUERY_READS } from "@/lib/evry/capabilities/queries/operations";
import { CONTENT_QUERY_READS } from "@/lib/evry/capabilities/queries/content";
import {
  createEveHelperTools,
  productionEveHelperDependencies,
} from "../capabilities/helpers";
import { evePreparationInputSchema } from "../preparation";

/** Eve replays this schema factory from a canonical name, never a captured Zod object or identity. */
export function eveRuntimeToolSchema(name: string) {
  if (name === "actions.prepare") return evePreparationInputSchema;
  const read = [
    ...PEOPLE_QUERY_READS,
    ...OPERATIONS_QUERY_READS,
    ...CONTENT_QUERY_READS,
  ].find((entry) => entry.id === name);
  if (read) return read.inputSchema;
  const helper = createEveHelperTools(
    productionEveHelperDependencies,
    new Date(0)
  ).find((entry) => entry.name === name);
  if (helper) return helper.inputSchema;
  throw new Error("Unknown Eve capability schema");
}
