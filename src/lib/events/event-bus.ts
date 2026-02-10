// ============================================================================
// In-Process Event Bus
// ============================================================================
//
// A lightweight, typed, synchronous event bus for cross-feature communication.
// All features emit and subscribe to events through this singleton — no feature
// module should ever import directly from another feature module's service layer.
//
// This is intentionally simple: no Kafka, no Redis, no external dependencies.
// Upgrade to a distributed system only if you later need background jobs,
// cross-process communication, or retry-with-backoff semantics.
// ============================================================================

type EventHandler<T = unknown> = (event: T) => Promise<void>;

class EventBus {
  private handlers = new Map<string, EventHandler[]>();
  private initialized = false;

  /**
   * Register a handler for a specific event type.
   * Handlers are called in registration order via Promise.allSettled —
   * one failing handler does not prevent others from running.
   */
  on<T>(eventType: string, handler: EventHandler<T>): void {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler as EventHandler);
    this.handlers.set(eventType, existing);
  }

  /**
   * Emit an event to all registered handlers for its type.
   * On the first emit, lazily registers all cross-feature subscriptions via
   * a dynamic import to avoid circular dependency issues at module load time.
   * Uses Promise.allSettled so individual handler failures don't break others.
   */
  async emit<T extends { type: string }>(event: T): Promise<void> {
    // Lazily register subscriptions on first emit.
    // We pass `this` to avoid subscriptions.ts needing to import eventBus,
    // which would create a circular dependency that breaks in Next.js bundling.
    if (!this.initialized) {
      const { registerSubscriptions } = await import("./subscriptions");
      registerSubscriptions(this);
    }

    const handlers = this.handlers.get(event.type) || [];

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] ${event.type}`,
        handlers.length > 0
          ? `(${handlers.length} handler${handlers.length === 1 ? "" : "s"})`
          : "(no handlers)",
        event
      );
    }

    if (handlers.length === 0) return;

    const results = await Promise.allSettled(
      handlers.map((handler) => handler(event))
    );

    // Log any handler failures
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(
          `[EVENT] Handler failed for ${event.type}:`,
          result.reason
        );
      }
    }
  }

  /**
   * Mark the bus as initialized (subscriptions registered).
   * Prevents duplicate registration on hot-reload.
   */
  markInitialized(): void {
    this.initialized = true;
  }

  /**
   * Check if subscriptions have already been registered.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get count of registered handlers for a given event type.
   * Useful for testing and debugging.
   */
  handlerCount(eventType: string): number {
    return this.handlers.get(eventType)?.length ?? 0;
  }
}

/**
 * Singleton event bus instance shared across the entire process.
 */
export const eventBus = new EventBus();
