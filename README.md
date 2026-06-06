# ArtifactHub

ArtifactHub is a project documentation workspace for project managers, business analysts, product owners, and delivery teams. It combines reusable artifact templates, private project workspaces, and a growing AI-ready foundation for producing stronger project documentation with less friction.

## What It Does Today

- Supports sign up, sign in, sign out, and a demo password reset flow
- Supports signed-in password changes and admin-only account cleanup
- Keeps project data private to the signed-in user
- Lets users create and delete project workspaces
- Provides a project management artifact library with template previews
- Creates and auto-saves artifact drafts inside project workspaces
- Exports saved artifacts as Markdown
- Persists users, sessions, projects, and artifacts in PostgreSQL when `DATABASE_URL` is configured

## Current Hosted Status

ArtifactHub is deployed publicly on Render as a live demo.

Current hosted facts:

- Hosting platform: Render
- Runtime: Node.js web service using `npm start`
- Durable persistence: Render Postgres via `DATABASE_URL`
- Deployment posture: demo milestone, not yet a production-ready release
- The live UI now includes an explicit `Active Demo` disclosure and a reminder not to use confidential or sensitive information

The application still supports local JSON fallback when `DATABASE_URL` is not set. That fallback is intended for local development convenience only.

## Tech Stack

- Node.js
- Express
- Vanilla HTML, CSS, and JavaScript
- PostgreSQL

## Run Locally

Install dependencies:

```bash
npm install
```

Optional local environment:

```bash
cp .env.example .env
```

Optional admin setup:

```bash
ADMIN_EMAILS=you@example.com
```

Start the app:

```bash
npm start
```

Run the smoke test:

```bash
npm test
```

Open:

```txt
http://localhost:3000
```

## Database Notes

- `DATABASE_URL` enables PostgreSQL persistence.
- `ADMIN_EMAILS` accepts a comma-separated list of admin account emails.
- Without `DATABASE_URL`, ArtifactHub falls back to local JSON files for runtime data.
- The checked-in `data/templates.json` file remains product content and is still tracked in git.
- Mutable local runtime files under `data/` are ignored so test/demo accounts and sessions do not get committed.

The database schema lives in [db/schema.sql](/Users/pv/bootcamp/projects/artifact-hub/db/schema.sql), and the migration script for older JSON-backed demo data is available at [scripts/migrate-json-to-postgres.js](/Users/pv/bootcamp/projects/artifact-hub/scripts/migrate-json-to-postgres.js).

## Deploy to Render

The included [render.yaml](/Users/pv/bootcamp/projects/artifact-hub/render.yaml) defines:

- The `artifact-hub` Node web service
- A Render Postgres database named `artifact-hub-db`
- `DATABASE_URL` wiring from the database to the web service

If you are migrating older demo data into Render Postgres, run:

```bash
NODE_ENV=production DATABASE_URL="your-render-external-postgres-url" npm run migrate:json-to-db
```

If you want in-app admin account management on Render, set:

```txt
ADMIN_EMAILS=admin1@example.com,admin2@example.com
```

Admins can open the account modal from the signed-in username and remove demo accounts without connecting to the database directly.

## Project Structure

```txt
data/       Template content plus ignored local fallback runtime data
db/         Database schema
docs/       Product planning and requirements
public/     Frontend HTML, CSS, and JavaScript
scripts/    Migration and smoke-test scripts
server.js   Express server and API routes
storage.js  Persistence layer
```

## Product Planning

The main requirements document is here:

- [docs/artifacthub-prd.md](/Users/pv/bootcamp/projects/artifact-hub/docs/artifacthub-prd.md)

## Status

ArtifactHub is under active development. The hosted product foundation is now in place for the live demo, including durable persistence, private user data, export, password management, smoke-test coverage, and basic admin account cleanup. The next focus is deeper Phase 1 product depth and then AI-assisted artifact workflows.
