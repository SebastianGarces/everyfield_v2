import {
  EVRY_SUGGESTION_MODULES,
  type EligibleEvrySuggestion,
  type EvrySuggestionModule,
} from "./types";

const EXCLUDED_PATH_PREFIXES = [
  "/settings",
  "/coaching",
  "/oversight",
  "/login",
  "/register",
  "/onboarding",
] as const;

const MODULE_PATHS = {
  people: "/people",
  meetings: "/meetings",
  tasks: "/tasks",
  launch: "/launch",
} as const satisfies Record<EvrySuggestionModule, string>;

const isPathWithin = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Current-module suggestions, or a short cross-module set in Evry itself. */
export function evrySuggestionsForPathname(
  pathname: string,
  eligible: readonly EligibleEvrySuggestion[]
): readonly EligibleEvrySuggestion[] {
  if (EXCLUDED_PATH_PREFIXES.some((prefix) => isPathWithin(pathname, prefix))) {
    return [];
  }

  const currentModule = EVRY_SUGGESTION_MODULES.find((module) =>
    isPathWithin(pathname, MODULE_PATHS[module])
  );

  if (currentModule) {
    return eligible.filter((suggestion) => suggestion.module === currentModule);
  }

  if (pathname !== "/evry" && pathname !== "/dashboard") return [];
  return eligible.filter((suggestion) => suggestion.fallback).slice(0, 3);
}
