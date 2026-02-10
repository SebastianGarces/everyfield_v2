// ============================================================================
// Events Module Entry Point
// ============================================================================
//
// Import this module to ensure event subscriptions are registered.
// The event bus is a singleton — importing it from event-bus.ts directly
// also works, but importing from here guarantees subscriptions are wired up.
// ============================================================================

export { eventBus } from "./event-bus";
export type { AppEvent } from "./types";

// Register all subscriptions on module load
import { eventBus } from "./event-bus";
import { registerSubscriptions } from "./subscriptions";
registerSubscriptions(eventBus);
