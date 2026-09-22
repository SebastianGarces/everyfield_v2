import {
  EVE_READ_REGISTRATIONS,
  eveActionStatusInputSchema,
} from "../capabilities/registry";
import { extendedEveReadSchema } from "../capabilities/extended-reads";
import {
  createEveHelperTools,
  productionEveHelperDependencies,
} from "../capabilities/helpers";
import {
  evePreparationInputSchema,
  selectedEvePreparationSchema,
} from "../preparation";
import { eveAttachmentInputSchema } from "./attachment-contract";
import { eveResultSelectionInputSchema } from "./result-selection";

/** Eve replays this schema factory from a canonical name, never a captured Zod object or identity. */
export function eveRuntimeToolSchema(
  name: string,
  preparationOperations?: readonly string[]
) {
  if (name === "results.select") return eveResultSelectionInputSchema;
  if (name === "files.inspect") return eveAttachmentInputSchema;
  if (name === "actions.status") return eveActionStatusInputSchema;
  if (name === "actions.prepare")
    return preparationOperations
      ? selectedEvePreparationSchema(preparationOperations)
      : evePreparationInputSchema;
  const read = EVE_READ_REGISTRATIONS.find((entry) => entry.id === name);
  if (read) return extendedEveReadSchema(read);
  const helper = createEveHelperTools(
    productionEveHelperDependencies,
    new Date(0)
  ).find((entry) => entry.name === name);
  if (helper) return helper.inputSchema;
  throw new Error("Unknown Eve capability schema");
}
