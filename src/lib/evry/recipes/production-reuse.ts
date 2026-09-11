import { MEETING_INVITATION_REUSE } from "./meeting-invitation-reuse";
import { createEvryRecipeReuseRegistry } from "./reuse";

export const PRODUCTION_EVRY_RECIPE_REUSE_REGISTRY =
  createEvryRecipeReuseRegistry([MEETING_INVITATION_REUSE]);
