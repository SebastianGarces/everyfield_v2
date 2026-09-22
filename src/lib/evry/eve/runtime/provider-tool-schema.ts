import { z } from "zod";
import { eveRuntimeToolSchema } from "./tool-schemas";

/** Share repeated provider definitions without changing the native validator. */
export function compactProviderSchema<T extends z.ZodType>(schema: T) {
  const standard = schema["~standard"];
  return {
    "~standard": {
      ...standard,
      // This is a Standard Schema wrapper, not a Zod instance. The AI SDK
      // dispatches the zod vendor through its instance-specific converter.
      vendor: "everyfield",
      jsonSchema: {
        ...standard.jsonSchema,
        input: () =>
          z.toJSONSchema(schema, {
            target: "draft-7",
            io: "input",
            reused: "ref",
          }),
      },
    },
  };
}

/** Eve restores this factory from scalar tool selection, not captured schemas. */
export function eveProviderToolSchema(
  name: string,
  preparationOperations?: readonly string[]
) {
  return compactProviderSchema(
    eveRuntimeToolSchema(name, preparationOperations)
  );
}
