# EveryField

A platform purpose-built for the church planting journey. Helps church planters learn, plan, execute, and measure their church plant with guided best practices.

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Language:** TypeScript
- **Database:** PostgreSQL (Neon serverless)
- **ORM:** Drizzle ORM
- **Styling:** Tailwind CSS v4
- **UI Components:** Radix UI, shadcn/ui, cmdk
- **Email:** Resend + React Email
- **Storage:** Tigris (S3-compatible)
- **Charts:** Recharts
- **Drag & Drop:** Pragmatic DnD

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 8
- A PostgreSQL database (we use [Neon](https://neon.tech/) — free tier works fine for dev)

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/SebastianGarces/everyfield_v2.git
cd everyfield_v2
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set up environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in your values:

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (Neon recommended) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` for local dev |
| `AWS_ACCESS_KEY_ID` | Tigris / S3 access key |
| `AWS_SECRET_ACCESS_KEY` | Tigris / S3 secret key |
| `AWS_ENDPOINT_URL_S3` | S3-compatible endpoint |
| `AWS_REGION` | Storage region (`auto` for Tigris) |
| `AWS_BUCKET_NAME` | Your storage bucket name |
| `RESEND_API_KEY` | API key from [Resend](https://resend.com/) |
| `RESEND_WEBHOOK_SECRET` | Webhook signing secret from Resend |
| `EMAIL_FROM` | Sender address (e.g. `EveryField <notifications@yourdomain.com>`) |

### 4. Run database migrations

```bash
pnpm db:migrate
```

### 5. (Optional) Seed the database

```bash
pnpm db:seed
```

### 6. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Format code with Prettier |
| `pnpm format:check` | Check formatting |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:push` | Push schema directly (skip migration files) |
| `pnpm db:studio` | Open Drizzle Studio (database GUI) |
| `pnpm db:seed` | Seed the database with dev data |
| `pnpm db:clean` | Clean the database (remove seeded data) |

## Project Structure

```
src/
├── app/                  # Next.js App Router pages and layouts
│   └── (dashboard)/      # Authenticated dashboard routes
├── components/           # React components
│   ├── ui/               # shadcn/ui base components
│   └── ...               # Feature-specific components
├── db/
│   ├── schema/           # Drizzle table definitions
│   └── migrations/       # SQL migration files
├── lib/                  # Business logic, services, utilities
│   ├── people/           # People CRM / pipeline
│   ├── meetings/         # Meeting management
│   ├── tasks/            # Task & project management
│   ├── feedback/         # Feedback system
│   ├── email/            # Email templates
│   └── ...
└── ...
```

## Database Workflow

When you change a schema file in `src/db/schema/`:

```bash
# Generate a new migration
pnpm db:generate

# Apply it
pnpm db:migrate
```

Use `pnpm db:studio` to browse the database visually during development.
