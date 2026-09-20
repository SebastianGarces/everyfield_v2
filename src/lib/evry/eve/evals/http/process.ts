import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  compiledFixtureRequest,
  httpEvalOutcomeSchema,
  type CompiledFixtureRequest,
} from "./process-contract";

/** One child per case prevents fixture observers, credentials and workflow files crossing runs. */
export async function runCompiledEveFixture(
  input: CompiledFixtureRequest,
  signal: AbortSignal
) {
  const request = compiledFixtureRequest.parse(input);
  signal.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), "evry-eve-http-fixture-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: request.databaseUrl,
    RESEND_API_KEY: "re_isolated_fixture_no_send",
    TYPESAFE_API_KEY: "",
    LANGFUSE_PUBLIC_KEY: "",
    LANGFUSE_SECRET_KEY: "",
    // Eve replaces authored models wholesale in NODE_ENV=test. Keep the real
    // production adapter and substitute only our explicit, isolated provider.
    NODE_ENV: "production",
    EVE_MOCK_AUTHORED_MODELS: "0",
  };
  if (request.model.mode === "scripted")
    env.OPENAI_API_KEY = "isolated-scripted-no-provider";
  const worker = spawn(
    process.execPath,
    [
      "--import",
      createRequire(__filename).resolve("tsx"),
      join(__dirname, "../../../../../../scripts/evry-eve-http-worker.ts"),
    ],
    { cwd: directory, env, stdio: ["ignore", "ignore", "ignore", "ipc"] }
  );
  let stopped = false;
  const stop = () => {
    if (!stopped) {
      stopped = true;
      worker.kill("SIGTERM");
    }
  };
  const abort = () => worker.send({ type: "cancel" });
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await new Promise<z.infer<typeof httpEvalOutcomeSchema>>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          stop();
          reject(new Error("Compiled HTTP evaluation timed out"));
        }, request.timeoutMs + 20_000);
        worker.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        worker.once("exit", () => {
          clearTimeout(timer);
          reject(
            new Error(
              "Compiled HTTP evaluation exited before returning evidence"
            )
          );
        });
        worker.on("message", (message) => {
          const success = z
            .object({
              type: z.literal("result"),
              outcome: httpEvalOutcomeSchema,
            })
            .safeParse(message);
          if (success.success) {
            clearTimeout(timer);
            resolve(success.data.outcome);
            return;
          }
          const failed = z
            .object({ type: z.literal("failed"), phase: z.string() })
            .safeParse(message);
          if (failed.success) {
            clearTimeout(timer);
            reject(
              new Error(
                `Compiled HTTP evaluation failed during ${failed.data.phase}`
              )
            );
          }
        });
        worker.send({ type: "run", request });
      }
    );
  } finally {
    signal.removeEventListener("abort", abort);
    stop();
    if (worker.exitCode === null && worker.signalCode === null)
      await new Promise<void>((resolve) =>
        worker.once("exit", () => resolve())
      );
    await rm(directory, { recursive: true, force: true });
  }
}
