# Restricted tool composition

`runEvryComposition` uses `@ai-sdk/code-mode` 1.0.62, whose worker runs the program in QuickJS compiled to WebAssembly. It does not evaluate generated code in the application's JavaScript context. Only the supplied registry's read and prepare tools cross the host boundary. No filesystem, arbitrary network, module loader, secrets, or effect executor is exposed.

The Eve wrapper supplies a server-owned call identity, authenticated registry, abort signal and turn budget. Do not put these fields or execution limits in the model's input schema. The program input is JavaScript only. Dotted capability names are called with bracket notation, such as `tools["people.query"]`.

Create one `createCompositionBudget` per turn and pass it to every composition invocation. Its in-memory counter complements, but does not replace, the durable run budget and rate limits in the orchestrator. A worker restart must not reset the orchestrator's remaining budget. Preparation receives the nested call identity so the registry can use its existing idempotency mechanism during a replay.

Each nested tool emits metadata-only start/outcome events. The callback receives no input, output, actor, tenant or exception text. Trace callbacks cannot change product behavior. Authorization belongs to `registry.invoke` and runs for every nested call, including after a prior successful read.

The direct runner intentionally accepts no continuation or approval response. Confirmed writes go through the separate trusted UI action. The code-mode package's approval callback always denies as an additional guard against a mistakenly registered approval-requiring tool.

Run the actual worker and mocked-provider tests without credentials:

`node --import tsx --test src/lib/evry/eve/composition/runner.test.ts src/lib/evry/eve/jev/jev.test.ts`

Node 24 is the deployment target. Tests assert parallel execution, host isolation, schema enforcement, resource ceilings, shared call budgets, safe exception handling and stable preparation identities. This is local package verification, not a Vercel deployment proof.

Sources: [AI SDK code mode](https://github.com/vercel/ai/tree/main/packages/code-mode), [TypeSafe API](https://docs.typesafe.ai/api), [skill suggestions](https://docs.typesafe.ai/cookbooks/skill_suggestion).
