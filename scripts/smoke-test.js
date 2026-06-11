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
  const testDatabaseUrl =
    process.env.TEST_DATABASE_URL ||
    (process.env.TEST_POSTGRES === "true"
      ? [
          "postgresql://",
          encodeURIComponent(process.env.PGUSER || ""),
          ":",
          encodeURIComponent(process.env.PGPASSWORD || ""),
          "@",
          process.env.PGHOST || "localhost",
          ":",
          process.env.PGPORT || "5432",
          "/",
          process.env.PGDATABASE || "",
        ].join("")
      : "");
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  process.env.AI_FEATURE_ENABLED = "true";
  process.env.AI_BETA_EMAILS = "admin@example.com,prashant@grafley.com";
  process.env.AI_PROVIDER = "fake";

  const { app } = await import("../server.js");
  const { initDatabase, pool } = await import("../storage.js");
  await initDatabase();
  await initDatabase();
  const agent = request.agent(app);
  const memberAgent = request.agent(app);
  const bootstrapAdminAgent = request.agent(app);

  try {
    const email = "admin@example.com";
    const bootstrapAdminEmail = "prashant@grafley.com";
    const memberEmail = `smoke-${Date.now()}@example.com`;

    await agent
      .post("/api/auth/signup")
      .send({
        name: "Smoke Admin",
        email,
        password: "password123",
      })
      .expect(201);

    await memberAgent
      .post("/api/auth/signup")
      .send({
        name: "Smoke Member",
        email: memberEmail,
        password: "memberpass123",
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

    await bootstrapAdminAgent
      .post("/api/auth/login")
      .send({
        email: bootstrapAdminEmail,
        password: "admin4Artifacthub!",
      })
      .expect(200);

    await bootstrapAdminAgent.get("/api/admin/overview").expect(200);

    const adminUsersResponse = await agent.get("/api/admin/users").expect(200);

    if (!Array.isArray(adminUsersResponse.body.users)) {
      throw new Error("Expected admin users response to include a users array.");
    }

    const memberUser = adminUsersResponse.body.users.find(
      (user) => user.email === memberEmail,
    );

    if (!memberUser) {
      throw new Error("Expected admin user list to include the member account.");
    }

    const adminUser = adminUsersResponse.body.users.find(
      (user) => user.email === email,
    );

    if (!adminUser) {
      throw new Error("Expected admin user list to include the admin account.");
    }

    const bootstrapAdminUser = adminUsersResponse.body.users.find(
      (user) => user.email === bootstrapAdminEmail,
    );

    if (!bootstrapAdminUser) {
      throw new Error("Expected admin user list to include the bootstrap admin.");
    }

    const adminOverviewResponse = await agent
      .get("/api/admin/overview?range=7d")
      .expect(200);

    if (!adminOverviewResponse.body.metrics) {
      throw new Error("Expected admin overview to return metrics.");
    }

    const adminSystemResponse = await agent.get("/api/admin/system").expect(200);
    if (
      adminSystemResponse.body.settings.outboundApiCallsEnabled !== true ||
      !adminSystemResponse.body.aiStatus
    ) {
      throw new Error("Expected admin system response to include settings and AI status.");
    }

    const resetLinkResponse = await agent
      .post(`/api/admin/users/${memberUser.id}/password-reset-link`)
      .expect(200);
    if (!resetLinkResponse.body.resetUrl) {
      throw new Error("Expected admin reset-link action to return a reset URL.");
    }

    await agent
      .post(`/api/admin/users/${memberUser.id}/temporary-password`)
      .send({ temporaryPassword: "membertemp123" })
      .expect(200);

    await request(app)
      .post("/api/auth/login")
      .send({
        email: memberEmail,
        password: "memberpass123",
      })
      .expect(401);

    await memberAgent
      .post("/api/auth/login")
      .send({
        email: memberEmail,
        password: "membertemp123",
      })
      .expect(200);

    await agent
      .post(`/api/admin/users/${memberUser.id}/invalidate-sessions`)
      .expect(200);

    await memberAgent.get("/api/auth/me").expect(401);

    await agent.delete(`/api/admin/users/${adminUser.id}`).expect(400);

    await agent
      .post("/api/auth/password-change")
      .send({
        currentPassword: "new-password123",
        newPassword: "changed-password123",
      })
      .expect(200);

    await request(app)
      .post("/api/auth/login")
      .send({
        email,
        password: "new-password123",
      })
      .expect(401);

    await agent
      .post("/api/auth/login")
      .send({
        email,
        password: "changed-password123",
      })
      .expect(200);

    const sessionResponse = await agent.get("/api/auth/me").expect(200);
    if (
      !sessionResponse.body.features.aiAssistant ||
      !sessionResponse.body.features.reviewWorkflow ||
      !sessionResponse.body.features.docxExport
    ) {
      throw new Error("Expected allowlisted account to receive Phase 1 features.");
    }

    await agent.get("/api/projects").expect(200, []);

    const initialGlobalActivityResponse = await agent
      .get("/api/activity")
      .expect(200);
    if (initialGlobalActivityResponse.body.activity.length !== 0) {
      throw new Error("Expected a new account to have empty global activity.");
    }

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

    const contextResponse = await agent
      .get(`/api/projects/${projectResponse.body.id}/context`)
      .expect(200);

    if (contextResponse.body.items.length !== 3) {
      throw new Error("Expected project creation to seed reusable context.");
    }

    const updatedContextResponse = await agent
      .patch(`/api/projects/${projectResponse.body.id}/context`)
      .send({
        items: [
          {
            category: "delivery",
            key: "scope",
            label: "Scope",
            value: {
              inScope: ["Request intake and triage"],
              outOfScope: ["Downstream delivery tooling"],
            },
            trustState: "proposed",
            sourceType: "user",
          },
        ],
      })
      .expect(200);

    const scopeItem = updatedContextResponse.body.items.find(
      (item) => item.key === "scope",
    );
    if (!scopeItem) {
      throw new Error("Expected context update to create a scope item.");
    }

    await agent
      .post(
        `/api/projects/${projectResponse.body.id}/context/${scopeItem.id}/confirm`,
      )
      .expect(200);

    const artifactResponse = await agent
      .post(`/api/projects/${projectResponse.body.id}/artifacts`)
      .send({
        templateId: "project-charter",
        title: "Project Charter",
        fieldValues: {},
      })
      .expect(201);

    if (
      artifactResponse.body.templateVersion !== 2 ||
      artifactResponse.body.revision !== 1
    ) {
      throw new Error("Expected a revisioned Project Charter v2 draft.");
    }

    const conversationResponse = await agent
      .post(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}/conversations`,
      )
      .send({ operation: "interview" })
      .expect(201);

    if (!conversationResponse.body.id) {
      throw new Error("Expected assistant conversation to be persisted.");
    }

    const aiTurnPath = `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}/assistant/turns`;

    await agent
      .put("/api/admin/system")
      .send({
        aiEnabledOverride: true,
        outboundApiCallsEnabled: false,
      })
      .expect(200);

    await agent
      .post(aiTurnPath)
      .set("Idempotency-Key", "smoke-ai-turn-blocked")
      .send({
        operation: "interview",
        message: "This should be blocked by admin runtime settings.",
        expectedRevision: artifactResponse.body.revision,
      })
      .expect(503);

    await agent
      .put("/api/admin/system")
      .send({
        aiEnabledOverride: true,
        outboundApiCallsEnabled: true,
      })
      .expect(200);

    const aiTurnResponse = await agent
      .post(aiTurnPath)
      .set("Idempotency-Key", "smoke-ai-turn-1")
      .send({
        operation: "interview",
        message: "Create a single governed intake workflow.",
        expectedRevision: artifactResponse.body.revision,
      })
      .expect(200);

    if (
      aiTurnResponse.body.autoUpdates[0]?.fieldId !== "project_overview" ||
      aiTurnResponse.body.artifact.revision !== 2
    ) {
      throw new Error("Expected fake AI to populate the first empty field.");
    }

    const duplicateTurnResponse = await agent
      .post(aiTurnPath)
      .set("Idempotency-Key", "smoke-ai-turn-1")
      .send({
        operation: "interview",
        message: "This duplicate must not create another update.",
        expectedRevision: aiTurnResponse.body.artifact.revision,
      })
      .expect(200);

    if (
      duplicateTurnResponse.body.artifact.revision !==
      aiTurnResponse.body.artifact.revision
    ) {
      throw new Error("Expected duplicate idempotency key to reuse the AI run.");
    }

    await agent
      .put(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}`,
      )
      .send({
        title: "Project Charter",
        status: "draft",
        fieldValues: {},
      })
      .expect(400)
      .expect((response) => {
        if (response.body.code !== "EXPECTED_REVISION_REQUIRED") {
          throw new Error("Expected updates to require optimistic revision.");
        }
      });

    await agent
      .put(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}`,
      )
      .send({
        title: "Project Charter",
        status: "draft",
        fieldValues: {},
        expectedRevision: 1,
      })
      .expect(409)
      .expect((response) => {
        if (response.body.code !== "STALE_ARTIFACT_REVISION") {
          throw new Error("Expected stale update error code.");
        }
      });

    const completeFieldValues = {
      project_overview: "Create a single governed intake workflow.",
      objectives: ["Reduce intake cycle time by 30%."],
      scope: {
        inScope: ["Request intake and triage"],
        outOfScope: ["Downstream delivery tooling"],
      },
      stakeholders: [
        {
          role: "Sponsor",
          name: "Smoke Sponsor",
          responsibility: "Approve scope and funding",
        },
      ],
      risks: [
        {
          description: "Low adoption",
          impact: "Benefits are delayed",
          mitigation: "Pilot with two delivery teams",
          owner: "Change lead",
        },
      ],
      success_criteria: [
        "80% of requests use the new workflow within 30 days.",
      ],
    };

    const savedArtifactResponse = await agent
      .put(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}`,
      )
      .send({
        title: "Project Charter",
        status: "draft",
        fieldValues: completeFieldValues,
        expectedRevision: aiTurnResponse.body.artifact.revision,
        workflowStage: "refining",
      })
      .expect(200);

    if (savedArtifactResponse.body.completeness.percentage !== 100) {
      throw new Error("Expected completed Charter to report 100% completeness.");
    }

    const reviewResponse = await agent
      .post(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}/review`,
      )
      .expect(200);

    if (reviewResponse.body.findings.length !== 0) {
      throw new Error("Expected complete deterministic Charter review to pass.");
    }

    const approvalResponse = await agent
      .post(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}/approve`,
      )
      .expect(200);

    if (approvalResponse.body.version.versionNumber !== 1) {
      throw new Error("Expected approval to create immutable version 1.");
    }

    const versionsResponse = await agent
      .get(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}/versions`,
      )
      .expect(200);

    if (
      versionsResponse.body.versions.length !== 1 ||
      versionsResponse.body.versions[0].snapshot.artifact.fieldValues
        .project_overview !== completeFieldValues.project_overview ||
      versionsResponse.body.versions[0].snapshot.approval.versionNumber !== 1
    ) {
      throw new Error(
        "Expected approved version to retain field and approval metadata.",
      );
    }

    const exportResponse = await agent
      .get(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}/export.md`,
      )
      .expect(200);

    if (!exportResponse.text.includes("# Project Charter")) {
      throw new Error("Expected export to include artifact title.");
    }

    if (
      !exportResponse.text.includes("Approved version 1") ||
      !exportResponse.text.includes(completeFieldValues.success_criteria[0])
    ) {
      throw new Error("Expected Markdown export to use the approved snapshot.");
    }

    const docxResponse = await agent
      .get(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}/export.docx`,
      )
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    if (
      !Buffer.isBuffer(docxResponse.body) ||
      docxResponse.body.subarray(0, 2).toString() !== "PK"
    ) {
      throw new Error("Expected DOCX export to return a valid ZIP package.");
    }

    await agent
      .post(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}/reopen`,
      )
      .expect(200);

    const versionsAfterReopen = await agent
      .get(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}/versions`,
      )
      .expect(200);

    if (versionsAfterReopen.body.versions.length !== 1) {
      throw new Error("Expected reopening to preserve approved snapshots.");
    }

    const recommendationResponse = await agent
      .get(`/api/projects/${projectResponse.body.id}/recommendation`)
      .expect(200);

    if (!recommendationResponse.body.recommendation?.type) {
      throw new Error("Expected deterministic project recommendation.");
    }

    const activityResponse = await agent
      .get(`/api/projects/${projectResponse.body.id}/activity`)
      .expect(200);

    if (activityResponse.body.activity.length < 4) {
      throw new Error("Expected project activity to record key Phase 1 events.");
    }

    const globalActivityResponse = await agent.get("/api/activity").expect(200);
    const globalActivity = globalActivityResponse.body.activity;
    if (globalActivity.length < activityResponse.body.activity.length) {
      throw new Error("Expected global activity to include project activity.");
    }
    if (!globalActivity.every((item) => item.projectName === "Smoke Project")) {
      throw new Error("Expected global activity to include project names.");
    }
    if (
      !globalActivity.some(
        (item) =>
          item.eventType === "project.created" &&
          item.targetHref === `/projects/${projectResponse.body.id}`,
      )
    ) {
      throw new Error("Expected global activity to link project events.");
    }
    if (
      !globalActivity.some(
        (item) =>
          item.eventType === "artifact.created" &&
          item.targetHref ===
            `/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}`,
      )
    ) {
      throw new Error("Expected global activity to link artifact events.");
    }

    const outsiderAgent = request.agent(app);
    await outsiderAgent
      .post("/api/auth/signup")
      .send({
        name: "Outside Owner",
        email: `outside-${Date.now()}@example.com`,
        password: "outsidepass123",
      })
      .expect(201);
    await outsiderAgent
      .get(`/api/projects/${projectResponse.body.id}/context`)
      .expect(404);
    await outsiderAgent
      .get(
        `/api/projects/${projectResponse.body.id}/artifacts/${artifactResponse.body.id}/versions`,
      )
      .expect(404);
    const outsiderActivityResponse = await outsiderAgent.get("/api/activity");
    if (outsiderActivityResponse.status !== 200) {
      throw new Error(
        `Expected outsider global activity to load, got ${outsiderActivityResponse.status}: ${JSON.stringify(outsiderActivityResponse.body)}`,
      );
    }
    if (outsiderActivityResponse.body.activity.length !== 0) {
      throw new Error("Expected global activity to stay owner-scoped.");
    }

    const templatesResponse = await request(app).get("/api/templates").expect(200);

    if (
      !templatesResponse.body.some(
        (template) => template.id === "communications-plan",
      )
    ) {
      throw new Error("Expected versioned catalog to include Communications Plan.");
    }

    const templateResponse = await request(app)
      .get("/api/templates/project-charter")
      .expect(200);

    if (
      templateResponse.body.version !== 2 ||
      !Array.isArray(templateResponse.body.fields)
    ) {
      throw new Error("Expected current Project Charter v2 template detail.");
    }

    const adminAnalyticsResponse = await agent
      .get("/api/admin/analytics?range=7d")
      .expect(200);
    if (
      !Array.isArray(adminAnalyticsResponse.body.topSources) ||
      !Array.isArray(adminAnalyticsResponse.body.funnel)
    ) {
      throw new Error("Expected admin analytics to include sources and funnel data.");
    }

    const libraryEndpointResponse = await agent
      .get("/api/admin/library-endpoints")
      .expect(200);
    if (
      !libraryEndpointResponse.body.endpoints.some(
        (endpoint) => endpoint.path === "/api/templates",
      )
    ) {
      throw new Error("Expected admin library endpoint registry to include /api/templates.");
    }

    await agent.delete(`/api/admin/users/${memberUser.id}`).expect(200);

    console.log("Smoke test passed.");
  } finally {
    if (pool) {
      await pool.end();
    }
    await rm(dataDir, { force: true, recursive: true });
  }
}

run().catch((error) => {
  console.error("Smoke test failed.");
  console.error(error);
  process.exit(1);
});
