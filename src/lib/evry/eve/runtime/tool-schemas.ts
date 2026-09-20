import { EVE_READ_REGISTRATIONS } from "../capabilities/registry";
import { extendedEveReadSchema } from "../capabilities/extended-reads";
import {
  createEveHelperTools,
  productionEveHelperDependencies,
} from "../capabilities/helpers";
import { evePreparationInputSchema } from "../preparation";

/** Eve replays this schema factory from a canonical name, never a captured Zod object or identity. */
export function eveRuntimeToolSchema(name: string) {
  if (name === "actions.prepare") return evePreparationInputSchema;
  const read = EVE_READ_REGISTRATIONS.find((entry) => entry.id === name);
  if (read) return extendedEveReadSchema(read);
  const helper = createEveHelperTools(
    productionEveHelperDependencies,
    new Date(0)
  ).find((entry) => entry.name === name);
  if (helper) return helper.inputSchema;
  throw new Error("Unknown Eve capability schema");
}
