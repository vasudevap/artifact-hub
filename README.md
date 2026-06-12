# ArtifactHub

ArtifactHub is a project documentation workspace for project managers,
business analysts, product owners, and delivery teams. Its objective is to
make important project knowledge easier to structure, maintain, and reuse
through a consistent library of practical artifacts.

## Visual Direction

ArtifactHub should feel like a calm, premium project-delivery workspace for
professional project managers. The product is guided-workflow-first, with a
document-oriented editor as the main working surface.

The intended visual language combines disciplined hierarchy and compact
controls, refined editorial polish, and a structured-knowledge metaphor built
around reusable document blocks, layered information, and clear progress
through a body of work.

The interface should favor:

- a restrained light-mode foundation with warm off-white canvases and white or
  near-white document surfaces
- muted cool-grey borders, dark slate typography, and a muted teal accent for
  active states and primary actions
- soft green, subdued amber, and restrained red for semantic status states
- crisp typography, thin separators, subtle motion, careful spacing, and light
  elevation only where contextual emphasis is needed
- a document-first experience that feels closer to a refined editorial
  workspace than a dashboard, admin panel, or chatbot shell

Avoid saturated teal, neon colors, heavy gradients, pill-heavy softness, and
purple AI-product styling. AI guidance should feel contextual and supportive,
but it should recede during focused editing rather than dominate the interface.

The current visual baseline reflects the approved mockup direction for the
Projects dashboard, project workspace, Artifact Library, Project Charter
editor (guided drafting and review), and RAID Log workflow.

## Live Demo

ArtifactHub is available as an [Active Demo on
Render](https://artifact-hub-y528.onrender.com/).

The hosted service is an evaluation environment, not a production-ready
release. Do not enter confidential, sensitive, regulated, or personally
identifiable information. The application displays this disclosure in the
header and within the signed-in experience.

## What The Demo Does Today

- Supports account creation, sign in, sign out, password reset, and signed-in
  password changes
- Creates project workspaces and routes directly into reusable Project Context
- Keeps project context, artifacts, conversations, reviews, versions, and
  exports private to the owning account
- Provides a versioned artifact catalog, including Project Charter v2 and a
  manually editable Communications Plan
- Creates, edits, and auto-saves revisioned artifact drafts with stale-edit
  protection
- Supports allowlisted AI-guided Charter interview, drafting, refinement, and
  review through deterministic fake or OpenAI providers
- Calculates completeness from required fields and blocks approval while
  required content or blocking findings remain unresolved
- Creates immutable approved snapshots that can be reopened without losing
  prior versions
- Provides export preview plus server-generated Markdown and DOCX files
- Gives configured administrators basic demo-account cleanup controls
- Stores product state in PostgreSQL when `DATABASE_URL` is configured, with
  local JSON retained for local development only

## Run Locally

Prerequisites:

- Node.js 18 or newer
- npm

Install dependencies:

```bash
npm install
```

Optionally create a local environment file:

```bash
cp .env.example .env
```

Build and start the application:

```bash
npm run build
npm start
```

Open `http://localhost:3000`.

For frontend development, run the Express API with `npm start` and Vite with
`npm run dev`, then open `http://localhost:5173`.

Without `DATABASE_URL`, the application uses ignored JSON files under `data/`
for local development. To reset those files and load fictional sample
projects and artifacts, run:

```bash
npm run seed:demo
```

The local demo accounts are:

- `demo@artifacthub.local` / `DemoPass123!`
- `admin@artifacthub.local` / `AdminPass123!`

The seeder refuses to run when `DATABASE_URL` is set so it cannot overwrite a
configured PostgreSQL environment.

Run the smoke test and public-repository safety check with:

```bash
npm test
npm run test:e2e
npm run check:public
```

## Configuration

The supported environment variables are:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Enables PostgreSQL persistence instead of local JSON files |
| `PUBLIC_URL` | Sets the public base URL used by generated links |
| `ADMIN_EMAILS` | Comma-separated account emails with demo administration access |
| `AI_FEATURE_ENABLED` | Enables the AI assistant feature gate |
| `AI_BETA_EMAILS` | Comma-separated emails allowed to use the AI assistant |
| `AI_PROVIDER` | Selects `fake` or `openai` |
| `OPENAI_API_KEY` | Configures the OpenAI provider |
| `OPENAI_MODEL` | Overrides the default `gpt-5.5` model |
| `OPENAI_REASONING_EFFORT` | Overrides the default `medium` reasoning effort |
| `PORT` | Overrides the default HTTP port of `3000` |

Numbered PostgreSQL migrations under [`db/migrations`](db/migrations) run with
checksums and an advisory lock before the server begins listening. Existing
local JSON demo data can be migrated with:

```bash
NODE_ENV=production DATABASE_URL="your-postgres-url" npm run migrate:json-to-db
```

## Deploy To Render

[`render.yaml`](render.yaml) defines the Node web service, PostgreSQL database,
frontend build, and `DATABASE_URL` connection. The committed blueprint keeps
`AI_FEATURE_ENABLED=false` and `AI_PROVIDER=fake` so hosted rollout starts in a
safe AI-disabled state. After deploy, confirm `/api/health` reports PostgreSQL
storage and the expected runtime AI settings, then set the real AI provider
variables and an explicit beta allowlist only after the hosted empty-account
flow passes smoke testing.

## Project Structure

```text
data/           Versioned template content and ignored local runtime data
db/migrations/  Forward-only PostgreSQL migrations
public/         Legacy static assets retained during rollout
scripts/        Demo seeding, migration, testing, and safety checks
src/            React and TypeScript client
server.js       Express application and established API routes
phase1-*.js     Guided-workflow API and persistence modules
storage.js      Core PostgreSQL and local-development persistence
```

## Current Limitations

ArtifactHub is an active demo and does not provide production security,
availability, backup, recovery, or support guarantees. Local JSON storage is
for development only, account ownership and approval are single-user, password
reset is demo-oriented, and PDF/share-link workflows are not included.
