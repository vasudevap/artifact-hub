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
public landing experience and within the signed-in product.

## What The Demo Does Today

- Opens on a public product-overview landing page with section-jump navigation
  and top-level `Sign in` / `Create account` actions before workspace access
- Supports account creation, sign in, sign out, token-based password reset
  confirmation, and signed-in password changes
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
- Provides signed-in API Reference, Help Docs/FAQ, and Feedback pages from the
  global rail
- Sends password reset and signed-in feedback email through the configured
  Resend transactional email provider
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

The local Node server and Vite frontend both read `.env`, so AI flags and
other local runtime settings can be configured there for development.

Build and start the application:

```bash
npm run build
npm start
```

Open `http://localhost:3000`.

The default local entry is the public landing page at `/`. Use `/auth` for the
focused sign-in and account-creation screen.

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
| `PUBLIC_URL` | Sets the trusted public base URL used by generated links, including password-reset emails |
| `ADMIN_EMAILS` | Comma-separated account emails with demo administration access |
| `AI_FEATURE_ENABLED` | Enables the AI assistant feature gate |
| `AI_BETA_EMAILS` | Comma-separated emails allowed to use the AI assistant |
| `AI_PROVIDER` | Selects `fake` or `openai` |
| `OPENAI_API_KEY` | Configures the OpenAI provider |
| `OPENAI_MODEL` | Overrides the default `gpt-5.5` model |
| `OPENAI_REASONING_EFFORT` | Overrides the default `medium` reasoning effort |
| `EMAIL_PROVIDER` | Selects `disabled`, `console`, or `resend` for application email delivery |
| `EMAIL_FROM` | Sets the verified sender address for password-reset and feedback email delivery |
| `FEEDBACK_EMAIL_TO` | Overrides the feedback recipient; defaults to `contact@grafley.com` |
| `RESEND_API_KEY` | Configures Resend email delivery when `EMAIL_PROVIDER=resend` |
| `AUTH_RATE_LIMIT_WINDOW_MS` | Sets the auth rate-limit window; defaults to 15 minutes |
| `LOGIN_RATE_LIMIT_MAX` | Sets login attempts per auth rate-limit window |
| `SIGNUP_RATE_LIMIT_MAX` | Sets signup attempts per auth rate-limit window |
| `PASSWORD_RESET_REQUEST_RATE_LIMIT_MAX` | Sets password reset request attempts per auth rate-limit window |
| `PASSWORD_RESET_CONFIRM_RATE_LIMIT_MAX` | Sets password reset confirmation attempts per auth rate-limit window |
| `PORT` | Overrides the default HTTP port of `3000` |

## API Reference

ArtifactHub exposes a same-origin JSON API for the React client and hosted
demo. It is documented here for evaluation, testing, and integration planning;
it is not a production public API contract.

### API Concepts And Usage

The API centers on owner-scoped project work:

- Users authenticate with an `artifacthub_session` cookie set by signup,
  login, or password change.
- Projects are private to the signed-in account and contain assigned
  artifacts.
- Templates are a public read-only catalog of standardized project artifacts.
- Artifacts can begin as unassigned private drafts from the global Artifact
  Library, then be assigned to a project later.
- Project context stores reusable facts that can be proposed, confirmed, or
  rejected before they influence guided drafting.
- Review, approval, versions, and exports are project-scoped workflow actions.

Use `Content-Type: application/json` for JSON request bodies. Browser clients
should send requests with `credentials: "same-origin"` so the session cookie is
included. Successful JSON responses use `200 OK` unless the endpoint creates a
resource, in which case it uses `201 Created`.

Common error responses use this shape:

```json
{
  "error": "Human-readable message.",
  "code": "OPTIONAL_MACHINE_CODE"
}
```

Common status codes include `400` for validation errors, `401` when
authentication is required, `403` when a feature or administrator action is not
allowed, `404` when an owner-scoped resource cannot be found, `409` for stale
artifact revisions or blocked workflow transitions, `429` for auth or
assistant rate limits, `500` for server failures, `502` for AI provider
failures, and `503` when outbound AI/API calls or configured application email
delivery are unavailable.

### Common Objects

| Object | Key fields |
| --- | --- |
| `User` | `id`, `name`, `email`, `isAdmin`, `createdAt` |
| `FeatureAvailability` | `aiAssistant`, `reviewWorkflow`, `docxExport` |
| `Project` | `id`, `ownerId`, `name`, `sponsor`, `objective`, `status`, `artifacts`, `createdAt`, `updatedAt` |
| `Artifact` | `id`, `ownerId`, `projectId`, `templateId`, `title`, `status`, `fieldValues`, `revision`, `templateVersion`, `workflowStage`, `completeness`, `provenance`, `openFindings`, `createdAt`, `updatedAt` |
| `Template` | `id`, `version`, `title`, `role`, `description`, `category`, `lifecycleStage`, `aiEnabled`, `recommended`, `stageKey`, `stageName`, `stageOrder`, `stageUseWhen`, `sourceStandard`, `sourceName`, `fields` |
| `ContextItem` | `id`, `projectId`, `category`, `key`, `label`, `value`, `trustState`, `sourceType`, `sourceRecordId`, `createdAt`, `updatedAt` |
| `Finding` | `id`, `artifactId`, `fieldId`, `sourceType`, `severity`, `findingType`, `message`, `status`, `createdAt`, `resolvedAt` |
| `Version` | `id`, `artifactId`, `versionNumber`, `snapshot`, `approvedBy`, `approvedAt` |

### Health

| Method and path | Auth | Description | Success response |
| --- | --- | --- | --- |
| `GET /api/health` | No | Returns safe operational metadata for storage, migrations, runtime environment, and AI rollout state. | `{ "ok": true, "storage": { ... }, "runtime": { ... }, "timestamp": "..." }` |

### Authentication

| Method and path | Auth | Request body | Success response |
| --- | --- | --- | --- |
| `POST /api/auth/signup` | No | `{ "name": "...", "email": "...", "password": "..." }` | `201`, sets the session cookie, and returns `{ "user": User, "features": FeatureAvailability }` |
| `POST /api/auth/login` | No | `{ "email": "...", "password": "..." }` | Sets the session cookie and returns `{ "user": User, "features": FeatureAvailability }` |
| `GET /api/auth/me` | Optional session | None | Returns `{ "user": User, "features": FeatureAvailability }`, or `401` with `{ "user": null }` |
| `POST /api/auth/logout` | Optional session | None | Clears the session cookie and returns `{ "ok": true }` |
| `POST /api/auth/password-reset/request` | No | `{ "email": "..." }` | Sends reset instructions when email delivery is configured and returns a neutral message without exposing whether the account exists or returning reset tokens. |
| `POST /api/auth/password-reset/confirm` | No | `{ "token": "...", "password": "..." }` | Clears the session cookie and returns `{ "ok": true }` |
| `POST /api/auth/password-change` | Yes | `{ "currentPassword": "...", "newPassword": "..." }` | Rotates the session cookie and returns `{ "ok": true, "user": User }` |

### Templates

| Method and path | Auth | Description | Success response |
| --- | --- | --- | --- |
| `GET /api/templates` | No | Lists every standardized template in the global Artifact Library. | `Template[]` |
| `GET /api/templates/:id?version=:version` | No | Reads one template. Omit `version` for the current version. | `Template` |

Template responses include lifecycle stage metadata (`stageKey`, `stageName`,
`stageOrder`, and `stageUseWhen`) for library navigation.

### Projects

| Method and path | Auth | Request body or query | Success response |
| --- | --- | --- | --- |
| `GET /api/projects` | Yes | None | `Project[]`; a new account can correctly receive `[]` |
| `POST /api/projects` | Yes | `{ "name": "...", "sponsor": "...", "objective": "..." }` | `201 Project`; missing text fields default to empty strings except `name`, which defaults to `Untitled Project` |
| `GET /api/projects/:projectId` | Yes | None | Enriched `Project` with artifact completeness and open findings |
| `DELETE /api/projects/:projectId` | Yes | None | `{ "ok": true }` |

### Project Context And Activity

| Method and path | Auth | Request body or query | Success response |
| --- | --- | --- | --- |
| `GET /api/projects/:projectId/context` | Yes | None | `{ "items": ContextItem[], "completeness": { ... } }` |
| `PATCH /api/projects/:projectId/context` | Yes | `{ "items": ContextItemInput[] }` | Saves context items and returns `{ "items": ContextItem[], "completeness": { ... } }` |
| `POST /api/projects/:projectId/context/:itemId/confirm` | Yes | None | Confirmed `ContextItem` |
| `POST /api/projects/:projectId/context/:itemId/reject` | Yes | None | Rejected `ContextItem` |
| `GET /api/projects/:projectId/activity` | Yes | None | `{ "activity": Activity[] }` |
| `GET /api/activity?limit=50` | Yes | `limit` is clamped between `1` and `100` | `{ "activity": Activity[] }` |
| `POST /api/feedback` | Yes | `{ "category": "...", "subject": "...", "message": "..." }` | Sends signed-in user feedback to the configured feedback inbox and returns `{ "ok": true }` |
| `GET /api/projects/:projectId/recommendation` | Yes | None | `{ "recommendation": Recommendation }` |

Confirmed project context can synchronize canonical project fields such as
project name, objective, and sponsor.

### Owner-Scoped Artifacts

These routes work for any artifact owned by the signed-in user. They are the
preferred routes for the global Artifact Library and unassigned drafts.

| Method and path | Auth | Request body or query | Success response |
| --- | --- | --- | --- |
| `POST /api/artifacts` | Yes | `{ "templateId": "...", "title": "...", "fieldValues": { ... } }` | `201 Artifact`; creates a private unassigned draft |
| `GET /api/artifacts?scope=unassigned` | Yes | `scope` must be `unassigned` | `{ "artifacts": Artifact[] }` |
| `GET /api/artifacts/:artifactId` | Yes | None | `Artifact` |
| `PUT /api/artifacts/:artifactId` | Yes | `{ "title": "...", "status": "draft", "fieldValues": { ... }, "expectedRevision": 1, "workflowStage": "..." }` | Updated `Artifact` |
| `DELETE /api/artifacts/:artifactId` | Yes | None | `{ "ok": true }` |
| `POST /api/artifacts/:artifactId/assign` | Yes | `{ "projectId": "..." }` | `{ "artifact": Artifact }` |
| `GET /api/artifacts/:artifactId/export.md` | Yes | None | Markdown attachment for an owned assigned or unassigned artifact |

`PUT` requires `expectedRevision`. If another session saved the artifact first,
the API returns `409` with `code: "STALE_ARTIFACT_REVISION"` and
`latestArtifact`.

### Project-Scoped Artifacts

These routes are shortcuts for artifacts already assigned to a project.

| Method and path | Auth | Request body or query | Success response |
| --- | --- | --- | --- |
| `POST /api/projects/:projectId/artifacts` | Yes | `{ "templateId": "...", "title": "...", "fieldValues": { ... } }` | `201 Artifact`; creates an assigned artifact |
| `PUT /api/projects/:projectId/artifacts/:artifactId` | Yes | `{ "title": "...", "status": "draft", "fieldValues": { ... }, "expectedRevision": 1, "workflowStage": "..." }` | Updated `Artifact` |
| `DELETE /api/projects/:projectId/artifacts/:artifactId` | Yes | None | `{ "ok": true, "project": Project }` |
| `GET /api/projects/:projectId/artifacts/:artifactId/export.md?version=:number` | Yes | Optional `version` exports an approved snapshot; omit it for the latest approved version or current draft fallback. | Markdown attachment |

### Conversations And AI Assistance

AI assistance is feature-gated by environment configuration, account allowlist,
runtime admin settings, template support, idempotency key, message length, and
a per-user hourly turn limit.

| Method and path | Auth | Request body or headers | Success response |
| --- | --- | --- | --- |
| `POST /api/projects/:projectId/artifacts/:artifactId/conversations` | Yes | `{ "operation": "interview" }` | `201 Conversation` |
| `GET /api/projects/:projectId/artifacts/:artifactId/conversation` | Yes | None | Conversation with messages |
| `POST /api/projects/:projectId/artifacts/:artifactId/assistant/turns` | Yes | Header `Idempotency-Key` or body `idempotencyKey`; body `{ "message": "...", "operation": "interview", "expectedRevision": 1 }` | Structured assistant result with `assistantMessage`, `fieldUpdates`, `contextCandidates`, `autoUpdates`, `pendingUpdates`, `workflow`, and enriched `artifact` |
| `POST /api/projects/:projectId/artifacts/:artifactId/assistant/accept` | Yes | `{ "updates": [{ "fieldId": "...", "value": ... }], "expectedRevision": 1, "sourceRecordId": "..." }` | Updated `Artifact` |

Assistant turns are idempotent per artifact and idempotency key. The current
message limit is `8000` characters and the current per-user rate limit is `30`
assistant turns per hour.

### Review, Approval, Versions, And Export

| Method and path | Auth | Request body or query | Success response |
| --- | --- | --- | --- |
| `POST /api/projects/:projectId/artifacts/:artifactId/review` | Yes | None | `{ "findings": Finding[] }` |
| `PATCH /api/projects/:projectId/artifacts/:artifactId/findings/:findingId` | Yes | `{ "status": "open" }`, `{ "status": "resolved" }`, or `{ "status": "dismissed" }` | Updated `Finding` |
| `POST /api/projects/:projectId/artifacts/:artifactId/approve` | Yes | None | `{ "version": Version }`; returns `409` with `code: "APPROVAL_BLOCKED"` until required fields and blocking findings are resolved |
| `POST /api/projects/:projectId/artifacts/:artifactId/reopen` | Yes | None | `{ "artifact": Artifact }` |
| `GET /api/projects/:projectId/artifacts/:artifactId/versions` | Yes | None | `{ "versions": Version[] }` |
| `GET /api/projects/:projectId/artifacts/:artifactId/export-preview?version=:number` | Yes | Optional `version` | `{ "project": Project, "artifact": Artifact, "template": Template, "version": Version or null, "isDraft": boolean }` |
| `GET /api/projects/:projectId/artifacts/:artifactId/export.docx?version=:number` | Yes | Optional `version` | DOCX attachment |
| `GET /api/projects/:projectId/artifacts/:artifactId/export-phase1.md?version=:number` | Yes | Optional `version` | Markdown response body |

Approval creates immutable snapshots. Export routes can render an approved
snapshot by version number or fall back to the current draft when no approved
snapshot exists.

### Administration

Administrator APIs require an authenticated administrator account. They back
the hidden demo administration console and should be treated as operational
tools, not end-user product APIs.

| Route family | Auth | Public summary |
| --- | --- | --- |
| `/api/admin/*` | Admin | Administrator-only operational APIs for demo user management, usage review, library endpoint inspection, and runtime system controls. These routes are intentionally summarized in the public demo reference; implementation details belong in private engineering and operations docs. |

### Examples

Create an account and keep the returned session cookie in a local cookie jar:

```bash
curl -i -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo User","email":"demo@example.com","password":"DemoPass123!"}' \
  http://localhost:3000/api/auth/signup
```

Create a project:

```bash
curl -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"Northstar Intake","sponsor":"Jordan Lee","objective":"Create one governed intake workflow."}' \
  http://localhost:3000/api/projects
```

Start an unassigned Project Charter draft from the global Artifact Library:

```bash
curl -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"templateId":"project-charter","title":"Northstar Project Charter","fieldValues":{}}' \
  http://localhost:3000/api/artifacts
```

Save an artifact draft with stale-edit protection:

```bash
curl -X PUT -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"title":"Northstar Project Charter","status":"draft","fieldValues":{"project_overview":"Create one governed intake workflow."},"expectedRevision":1,"workflowStage":"drafting"}' \
  http://localhost:3000/api/artifacts/artifact-id
```

### Implementation Notes

The API is implemented in [`server.js`](server.js) and
[`phase1-routes.js`](phase1-routes.js). Shared client-side object types live in
[`src/types.ts`](src/types.ts). The same API is exercised by
[`scripts/smoke-test.js`](scripts/smoke-test.js). `npm run check:public`
checks both the public/private repository boundary and API Reference drift
against the implemented Express routes.

Numbered PostgreSQL migrations under [`db/migrations`](db/migrations) run with
checksums and an advisory lock before the server begins listening. Existing
local JSON demo data can be migrated with:

```bash
NODE_ENV=production DATABASE_URL="your-postgres-url" npm run migrate:json-to-db
```

## Deploy To Render

[`render.yaml`](render.yaml) defines the Node web service, PostgreSQL database,
frontend build, `DATABASE_URL` connection, trusted `PUBLIC_URL`, Resend email
provider, and feedback recipient. The current hosted demo uses Render Postgres,
`AI_FEATURE_ENABLED=true`, `AI_PROVIDER=openai`, and Resend-backed application
email. After deploy, confirm `/api/health` reports PostgreSQL storage and the
expected runtime AI settings, then verify signup, login, password reset,
feedback delivery, and empty-account project behavior.

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
for development only, account ownership and approval are single-user,
application email delivery requires a configured provider, and PDF/share-link
workflows are not included.
