# Native HTTP runtime evaluation

`createHttpEveEvalRunner` uses the official `eve/client` against the compiled,
cookie-authenticated HTTP runtime. It does not replace the agent with a tool
loop, expose `/info`, or allow the client to choose an actor or tenant.

`runCompiledEveFixture` starts one private child process per scenario. The child
imports the real `.output/server/index.mjs`, uses a disposable Postgres/Neon
proxy, and installs a process-local observer before the server starts. Only
that isolated test host can provide the frozen clock, explicit scripted model,
and trusted call journal. Production code has no endpoint or model tool that
can install or change the observer. Every captured call retains its original
authorized call ID; presentations must refer to those calls.

Run with Node 24 and Docker available, after building the current agent:

```sh
pnpm exec eve build
node --import tsx --test src/lib/evry/eve/evals/http/http.test.ts
EVRY_EVE_HTTP_PROOF=1 node --import tsx --test src/lib/evry/eve/evals/http/compiled.test.ts
EVRY_EVE_HTTP_PROOF=1 node --import tsx --test scripts/evry-eve-compiled-preparation.test.ts
```

The compiled proof uses deterministic provider responses and **no paid calls**.
It checks actual authentication, complete tool and skill discovery, database
reads, result presentation, and follow-up request context. `judge: null` is
intentional: this proves runtime wiring, not Luna's reasoning or answer quality.
The process must run with `NODE_ENV=production`; Eve automatically substitutes
authored models in test mode, bypassing the application provider middleware.

The compiled question case also uses native `ask_question` and `respond()`. On
resume, Eve re-runs the turn resolver with the original user request; the answer
appears as an answered tool result in the next model input. The proof checks
both, the resulting database query, and the native UI reducer's answered part.

The two-turn case attaches a fresh official client and reads the saved session
twice. It compares the restored transcript and checks that generation counts,
tool-invocation counts and the authorized-result journal did not change. This
is a fresh-client replay in the same server process, not a process-restart or
Vercel cold-start proof.

The separate compiled preparation proof checks the actual native transcript
through `projectEveMessage`: one confirmation card matches the database plan's
fingerprint, the plan awaits confirmation, and no unconfirmed effects or email
sends occur.

The unit protocol tests separately prove server cancellation on abort, fixed
session follow-ups, and reservation-before-generation. They are not a
substitute for the compiled database proof. Process-restart and Vercel cold-start
replay still need their own cases before claiming coverage. `outcome.messages`
contains typed messages from Eve's native reducer
over the actual events, with transport/authorization metadata omitted.

Live runs require explicit spending approval, `model.mode="live"`, and supplied
price ceilings. The host reserves an upper estimate before each provider call,
caps output tokens, and retains the reservation when usage is unknown or a call
fails. These are operational guardrails, **not a guaranteed provider billing
cap**: prices are caller-supplied, and visible prompt bytes do not account for
provider-added framing. No live model-quality run has been performed by this
proof. A future quality judge must also use the same reservation accounting.

External fetches are blocked in scripted mode. Approved live mode permits only
the OpenAI API in addition to loopback; email, Jev and Langfuse remain blocked.
The temporary process directory and Docker fixtures are removed on completion.
