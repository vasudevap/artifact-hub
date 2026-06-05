import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import request from "supertest";

async function run() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "artifact-hub-smoke-"));

  await Promise.all([
    writeFile(path.join(dataDir, "users.json"), "[]"),
    writeFile(path.join(dataDir, "sessions.json"), "[]"),
    writeFile(path.join(dataDir, "projects.json"), "[]"),
    writeFile(path.join(dataDir, "password-resets.json"), "[]"),
  ]);

  process.env.DATA_DIR = dataDir;
  process.env.DATABASE_URL = "";
  process.env.NODE_ENV = "test";

  const { app } = await import("../server.js");
  const agent = request.agent(app);

  try {
    const email = `smoke-${Date.now()}@example.com`;

    await agent
      .post("/api/auth/signup")
      .send({
        name: "Smoke Test",
        email,
        password: "password123",
      })
      .expect(201);

    const resetRequest = await request(app)
      .post("/api/auth/password-reset/request")
      .send({ email })
      .expect(200);

    if (!resetRequest.body.resetUrl) {
      throw new Error("Expected password reset request to return a demo reset URL.");
    }

    const resetToken = new URL(resetRequest.body.resetUrl).searchParams.get(
      "resetToken",
    );

    if (!resetToken) {
      throw new Error("Expected demo reset URL to include a reset token.");
    }

    await request(app)
      .post("/api/auth/password-reset/confirm")
      .send({
        token: resetToken,
        password: "new-password123",
      })
      .expect(200);

    await request(app)
      .post("/api/auth/login")
      .send({
        email,
        password: "password123",
      })
      .expect(401);

    await agent
      .post("/api/auth/login")
      .send({
        email,
        password: "new-password123",
      })
      .expect(200);

    await agent.get("/api/projects").expect(200, []);

    const projectResponse = await agent
      .post("/api/projects")
      .send({
        name: "Smoke Project",
        sponsor: "QA",
        objective: "Verify the critical project flow.",
      })
      .expect(201);

    if (!projectResponse.body.id) {
      throw new Error("Expected created project to include an id.");
    }

    const projectsResponse = await agent.get("/api/projects").expect(200);

    if (projectsResponse.body.length !== 1) {
      throw new Error("Expected one project after creation.");
    }

    const artifactResponse = await agent
      .post(`/api/projects/${projectResponse.body.id}/artifacts`)
      .send({
        templateId: "project-charter",
        title: "Project Charter",
        fieldValues: {
          project_name: "Smoke Project",
          objective: "Verify export.",
        },
      })
      .expect(201);

    const exportResponse = await agent
      .get(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}/export.md`,
      )
      .expect(200);

    if (!exportResponse.text.includes("# Project Charter")) {
      throw new Error("Expected export to include artifact title.");
    }

    if (!exportResponse.text.includes("Verify export.")) {
      throw new Error("Expected export to include saved field values.");
    }

    const templatesResponse = await request(app).get("/api/templates").expect(200);

    if (templatesResponse.body.length === 0) {
      throw new Error("Expected template list to be populated.");
    }

    const templateResponse = await request(app)
      .get("/api/templates/project-charter")
      .expect(200);

    if (!Array.isArray(templateResponse.body.fields)) {
      throw new Error("Expected template detail to include fields.");
    }

    console.log("Smoke test passed.");
  } finally {
    await rm(dataDir, { force: true, recursive: true });
  }
}

run().catch((error) => {
  console.error("Smoke test failed.");
  console.error(error);
  process.exit(1);
});
