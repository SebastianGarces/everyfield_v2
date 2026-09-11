import type {
  EvryActionPlanDocument,
  EvryActionStep,
  EvryJsonValue,
  EvryPlanStepDisclosure,
} from "@/lib/evry/plans";

import type {
  EvryRecipeDefinition,
  EvryRecipeDisclosureValue,
  EvryRecipeStepDefinition,
} from "./schema";

function displayValue(
  value: EvryRecipeDisclosureValue,
  arguments_: Readonly<Record<string, EvryJsonValue>>
): string {
  if (value.kind === "literal") return value.value;
  const argument = arguments_[value.argumentKey];
  if (argument === undefined) {
    if (value.absentValue !== undefined) return value.absentValue;
    throw new Error(
      `Evry recipe disclosure is missing argument ${value.argumentKey}`
    );
  }
  const displayed =
    value.kind === "argument_summary"
      ? summarizeArgument(argument)
      : typeof argument === "string"
        ? argument
        : JSON.stringify(argument);
  if (displayed.length === 0) {
    throw new Error(
      `Evry recipe disclosure is empty for argument ${value.argumentKey}`
    );
  }
  return displayed;
}

function summarizeArgument(argument: EvryJsonValue): string {
  if (typeof argument === "string") {
    return argument.length <= 500
      ? argument
      : `${argument.length.toLocaleString("en-US")} characters`;
  }
  if (Array.isArray(argument)) {
    return `${argument.length.toLocaleString("en-US")} ${argument.length === 1 ? "item" : "items"}`;
  }
  if (argument && typeof argument === "object") {
    const fields = Object.keys(argument).length;
    return `${fields.toLocaleString("en-US")} ${fields === 1 ? "field" : "fields"}`;
  }
  return JSON.stringify(argument);
}

export function disclosureForEvryRecipeStep(
  definition: EvryRecipeStepDefinition,
  step: EvryActionStep
): EvryPlanStepDisclosure {
  const items = definition.disclosure.items.map((item) => ({
    label: item.label,
    value: displayValue(item.value, step.arguments),
  }));
  const [first, ...rest] = items;
  if (!first) {
    throw new Error(
      `Evry recipe step ${definition.id} has no confirmation disclosure`
    );
  }
  return {
    title: definition.disclosure.title,
    items: [first, ...rest],
    consequences: definition.disclosure.consequences,
  };
}

function sameStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameDisclosure(
  left: EvryPlanStepDisclosure | undefined,
  right: EvryPlanStepDisclosure
): boolean {
  return (
    left?.title === right.title &&
    sameStrings(left.consequences, right.consequences) &&
    left.items.length === right.items.length &&
    left.items.every(
      (item, index) =>
        item.label === right.items[index]?.label &&
        item.value === right.items[index]?.value
    )
  );
}

/** Rebuild every recipe-owned field from the live trusted registration. */
export function storedDocumentMatchesEvryRecipe(input: {
  definition: EvryRecipeDefinition;
  document: EvryActionPlanDocument;
}): boolean {
  try {
    const expectedSafeRetries = input.definition.steps
      .filter(({ failurePolicy }) => failurePolicy.retry === "same_plan")
      .map(({ id }) => id);
    if (
      input.document.recipe?.identity !== input.definition.identity ||
      !sameStrings(
        input.document.recipe.preconditionIdentities,
        input.definition.preconditions
      ) ||
      !sameStrings(
        input.document.recipe.safeRetryStepIds,
        expectedSafeRetries
      ) ||
      input.document.confirmation?.title !==
        input.definition.confirmation.title ||
      input.document.confirmation.actionLabel !==
        input.definition.confirmation.actionLabel ||
      input.document.steps.length !== input.definition.steps.length
    ) {
      return false;
    }

    return input.document.steps.every((step, index) => {
      const definition = input.definition.steps[index];
      return (
        definition !== undefined &&
        step.id === definition.id &&
        step.capabilityIdentity === definition.capabilityIdentity &&
        sameStrings(step.dependsOn, definition.dependsOn) &&
        sameDisclosure(
          step.disclosure,
          disclosureForEvryRecipeStep(definition, step)
        )
      );
    });
  } catch {
    return false;
  }
}
