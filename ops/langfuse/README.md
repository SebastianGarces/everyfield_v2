# Local Langfuse 4.22.0

This directory is a disposable, local-only Langfuse environment for EveryField observability proof. It follows the official Langfuse 4.22.0 Docker Compose topology: web, worker, ClickHouse 25.12, MinIO, Redis 7, and PostgreSQL 17. Langfuse web and worker are pinned to `4.22.0`. The official v4.22.0 compose leaves its Chainguard MinIO image rolling; this stack preserves that one upstream-floating reference instead of inventing an unsupported version.

The stack has no model-provider credentials. Langfuse telemetry, experimental features, and the in-app Assistant are disabled. Every published port is remapped to a non-default host port and bound to `127.0.0.1`.

ClickHouse operational logging is capped locally at information level with three 50 MB archives per log channel. Every service also uses Docker's rotating `local` log driver with three 10 MB files, so dependency output cannot exhaust the Docker VM. These bounds cover disposable operational logs without changing trace or event retention.

This local stack is proven with 8 GB of Docker VM memory. At 4 GB, ClickHouse can exhaust its merge memory on retained trace data; increase Docker Desktop's memory allocation if background merges report `MEMORY_LIMIT_EXCEEDED`. Log rotation keeps that failure bounded, but additional memory is what lets the merge complete.

## Lifecycle

From the repository root:

```sh
(
  set -e
  trap './scripts/live-db-stack.sh down || true; ./ops/langfuse/manage.sh down || true' EXIT

  ./ops/langfuse/manage.sh up
  ./ops/langfuse/manage.sh smoke
  ./scripts/live-db-stack.sh up
  DATABASE_URL="postgresql://postgres:postgres@localhost:55432/live_lib_evry_audit_audit_live" \
    NEON_HTTP_PROXY_URL="http://localhost:4444/sql" \
    pnpm evry:langfuse:smoke
)
```

`up` creates `ops/langfuse/.env` once with random local service secrets, a headless admin, and a headless project/API-key pair. The file is mode `600` and gitignored. Missing public images are pulled with an isolated, empty Docker client configuration, so the operation neither reads nor changes saved registry credentials. Repeated `up` calls preserve the Langfuse credentials and converge the same Compose project. `down` always includes `--volumes`; repeated calls are safe.

Other commands:

```sh
./ops/langfuse/manage.sh init
./ops/langfuse/manage.sh check
./ops/langfuse/manage.sh health
```

The default UI is <http://127.0.0.1:3210>. Read the generated admin password or project keys directly from the local `.env` only when needed; do not copy provider keys into it.

## Provider-free smoke and application hook

`smoke` sends one metadata-only OTLP/JSON span to the authenticated public endpoint with `everyfield.provider_calls=0`, then polls Observations API v2 until that exact trace ID is readable. It does not import an SDK, run an evaluation, or call a model provider. The trace is disposable and is deleted with the stack volumes by `down`.

After that zero-provider infrastructure check, `pnpm evry:langfuse:smoke` exercises the application's captured ten-stage trace fixture against the same local service. The application smoke writes through the real audit seam, so it requires a disposable EveryField database with migrations applied through `0066`. `scripts/live-db-stack.sh up` creates the pgvector Postgres instance, Neon HTTP proxy, and freshly migrated database used above.

Pass `DATABASE_URL` and `NEON_HTTP_PROXY_URL` on the smoke command as shown. Do not add or change `DATABASE_URL` in `.env.local` for this check. The outer subshell registers one `EXIT` trap before either stack starts. The trap runs both down commands after success, failure, or interruption, and both down commands are safe to repeat.

Application integration can use the same local values:

- Base URL: `http://127.0.0.1:<LANGFUSE_WEB_HOST_PORT>`
- Public key: `LANGFUSE_INIT_PROJECT_PUBLIC_KEY`
- Secret key: `LANGFUSE_INIT_PROJECT_SECRET_KEY`
- OTLP endpoint: `<base-url>/api/public/otel/v1/traces`

## Sources

- [Langfuse v4.22.0 Docker Compose topology](https://github.com/langfuse/langfuse/blob/v4.22.0/docker-compose.yml)
- [Langfuse health and readiness endpoints](https://langfuse.com/self-hosting/configuration/health-readiness-endpoints)
- [Langfuse Observations API v2](https://langfuse.com/docs/api-and-data-platform/features/observations-api)
- [Langfuse self-hosted telemetry opt-out](https://langfuse.com/self-hosting/security/telemetry)
