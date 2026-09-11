# Evry response experience

Implementation order for the approved response and navigation changes. All work stays on `codex/evry-recipe-reuse`; permission checks and exact action confirmations stay unchanged.

1. Make panel/workspace handoffs safe. Reproduce overlapping mounts and late cleanup, then cover navigation and sending with a mounted regression proof.
2. Store ordered narrative and trusted result components. Let the model explain fresh tool evidence, select result references, and continue between components. Preserve existing conversation history.
3. Stream actual model output through the request-scoped transport. Keep transient output separate from durable completion and preserve reconnect/replay behavior.
4. Show five result rows inline with a larger full-results view. Keep the reader's scroll position unless they are following the latest response; offer Jump to latest.
5. Run targeted contract, mounted UI, and provider-stream tests, then validate the consolidated Vercel preview with the seeded Evry Test account. Close temporary browser tabs. Avoid full paid evals.

Acceptance checks include empty and long results, evidence-based explanations, multiple result components in one reply, old and reloaded history, interrupted streams, keyboard access, and panel → workspace → result link → panel → workspace → send.
