import { z } from "zod";
import historical from "./questions.json";
import additions from "./regressions.json";
import { evalQuestionSchema, regressionSchema } from "./contract";

export const questions = z.array(evalQuestionSchema).parse(historical.cases);
export const regressions = z.array(regressionSchema).parse(additions);
export const domains = historical.domains;
export const contracts = historical.contracts;
export const workflows = historical.workflows;

export function selectCases(profile: "smoke" | "security" | "full") {
  if (profile === "security")
    return regressions.filter((entry) => entry.tags.includes("security"));
  if (profile === "smoke")
    return [
      ...questions.filter((entry) =>
        historical.smokeCaseIds.includes(entry.id)
      ),
      ...regressions.filter((entry) => entry.tags.includes("smoke")),
    ];
  return [...questions, ...regressions];
}

export function catalogCoverage() {
  const all = selectCases("full");
  return {
    historical: questions.length,
    regressions: regressions.length,
    total: all.length,
    domains: domains.map(({ id, title }) => ({
      id,
      title,
      count: all.filter((entry) => entry.domain === id).length,
    })),
    contracts: contracts.map((id) => ({
      id,
      cases: questions
        .filter((entry) => entry.tools.includes(id))
        .map((entry) => entry.id),
    })),
    workflows: workflows.map((id) => ({
      id,
      cases: questions
        .filter((entry) => entry.recipe === id)
        .map((entry) => entry.id),
    })),
  };
}
