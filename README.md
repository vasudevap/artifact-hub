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
- Keeps projects and artifacts private to the signed-in account
- Creates and deletes project workspaces
- Provides reusable project artifact templates with previews
- Creates, edits, and auto-saves artifact drafts
- Exports saved artifacts as Markdown
- Gives configured administrators basic demo-account cleanup controls
- Stores users, sessions, projects, and artifacts in PostgreSQL when
  `DATABASE_URL` is configured

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

Start the application:

```bash
npm start
```

Open `http://localhost:3000`.

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
npm run check:public
```

## Configuration

The supported environment variables are:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Enables PostgreSQL persistence instead of local JSON files |
| `PUBLIC_URL` | Sets the public base URL used by generated links |
| `ADMIN_EMAILS` | Comma-separated account emails with demo administration access |
| `PORT` | Overrides the default HTTP port of `3000` |

The PostgreSQL schema is in [`db/schema.sql`](db/schema.sql). Existing local
JSON demo data can be migrated with:

```bash
NODE_ENV=production DATABASE_URL="your-postgres-url" npm run migrate:json-to-db
```

## Deploy To Render

[`render.yaml`](render.yaml) defines the Node web service, PostgreSQL database,
and `DATABASE_URL` connection. A Render deployment uses `npm start` and should
set `PUBLIC_URL` and `ADMIN_EMAILS` for the deployed environment as needed.

## Project Structure

```text
data/       Public template content and ignored local runtime data
db/         PostgreSQL schema
public/     Browser UI assets
scripts/    Demo seeding, migration, testing, and repository checks
server.js   Express server and API routes
storage.js  PostgreSQL and local-development persistence layer
```

## Current Limitations

ArtifactHub is an active demo and does not provide production security,
availability, backup, recovery, or support guarantees. Local JSON storage is
for development only, account ownership is single-user, password reset is
demo-oriented, and Markdown is the currently supported export format.
