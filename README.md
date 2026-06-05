# ArtifactHub

ArtifactHub is a project documentation workspace for project managers, business analysts, product owners, and delivery teams. The long-term goal is to make project documentation easier by combining reusable templates, private project workspaces, and eventually an AI agent that can guide users through creating high-quality project artifacts.

The current app is a Phase 1 foundation. It supports account-based access, private project workspaces, a template library, artifact drafts, auto-save behavior, and project/artifact deletion.

## What It Does Today

- Lets users sign up, log in, and log out
- Keeps project data private to the signed-in user
- Lets users create and delete projects
- Displays projects and saved artifacts as a sidebar tree
- Provides a project management artifact template library
- Lets users preview templates before selecting a project
- Creates an artifact only after the user enters content
- Auto-saves changes to existing artifacts
- Allows multiple artifacts from the same template, distinguished by timestamp

## Vision

ArtifactHub is intended to become an AI-assisted documentation copilot. In later phases, the app should help users complete artifacts through guided questioning, reuse project context across documents, suggest missing information, and eventually analyze uploaded project materials to recommend and generate suitable templates.

## Tech Stack

- Node.js
- Express
- Vanilla HTML, CSS, and JavaScript
- JSON file storage for the current prototype

## Run Locally

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

Open:

```txt
http://localhost:3000
```

## Deploy to Render

ArtifactHub can be deployed to Render as a free web service for demo use.

1. Push this repo to GitHub.
2. In Render, create a new Web Service from the repo.
3. Render can use the included [`render.yaml`](/Users/pv/bootcamp/projects/artifact-hub/render.yaml) settings automatically.
4. Deploy with:

```txt
Build Command: npm install
Start Command: npm start
```

Important: the current prototype stores users, sessions, and projects in local JSON files under `data/`. Render free web services use an ephemeral filesystem, so saved data will be lost on restart, redeploy, or idle spin-down. This deployment is suitable for sharing a demo, not for durable production usage.

## Current Hosted Status

ArtifactHub has been deployed successfully to Render as a live public demo.

This is a major milestone because the product is now reachable on the web and can be tested outside the local development environment. The current deployment should be treated as a demonstration environment, not a production-ready release, because persistence still depends on local JSON files in `data/`.

Current known hosting facts:

- Hosting platform: Render
- Deployment type: free web service
- Runtime model: Node.js web server using `npm start`
- Current persistence risk: local JSON data is ephemeral on Render free instances
- Next infrastructure milestone: move users, sessions, projects, and artifacts to durable hosted storage

## Project Structure

```txt
data/       JSON-backed prototype data
docs/       product planning and requirements
public/     frontend HTML, CSS, and JavaScript
server.js   Express server and API routes
```

## Product Planning

The main product requirements document is here:

- [docs/artifacthub-prd.md](docs/artifacthub-prd.md)

## Status

ArtifactHub is under active development. The current focus is completing the Phase 1 product foundation before adding AI-guided artifact completion.
