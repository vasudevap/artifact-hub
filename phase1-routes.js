import express from "express";
import { generateArtifactTurn } from "./ai-service.js";
import { recordUsageEvent } from "./src/server/admin-store.js";
import {
  buildProjectRecommendations,
  contextCompleteness,
  enrichArtifact,
} from "./artifact-service.js";
import { config } from "./config.js";
import {
  renderArtifactDocx,
  renderArtifactMarkdown,
  slugifyFilename,
} from "./export-service.js";
import {
  addConversationMessage,
  createOrGetConversation,
  createVersion,
  findAiRun,
  getArtifactForOwner,
  getConversationWithMessages,
  getProvenance,
  listActivity,
  listGlobalActivity,
  listContextItems,
  listFindings,
  listVersions,
  recordActivity,
  recordExport,
  reopenArtifact,
  replaceFindings,
  saveAiRun,
  setContextTrustState,
  setProvenance,
  updateFinding,
  upsertContextItems,
} from "./phase1-storage.js";
import { buildRuleFindings, normalizeAiFindings } from "./review-service.js";
import { getEffectiveAiStatus, getEffectiveFeatureAvailability } from "./src/server/runtime-settings.js";
import { updateArtifact } from "./storage.js";
import { getProjectByIdAndOwnerId } from "./storage.js";
import { calculateCompleteness, getTemplate } from "./template-service.js";

const turnHistory = new Map();

function createPhase1Router(requireAuth) {
  const router = express.Router();
  router.use(requireAuth);

  function requestClientContext(req) {
    const localHour = Number.parseInt(
      String(req.get("x-artifacthub-local-hour") || ""),
      10,
    );
    return {
      timezone: String(req.get("x-artifacthub-timezone") || "").trim() || null,
      locale: String(req.get("x-artifacthub-locale") || "").trim() || null,
      landingPath:
        String(req.get("x-artifacthub-landing-path") || "").trim() || null,
      referrer:
        String(req.get("x-artifacthub-referrer") || req.get("referer") || "").trim() ||
        null,
      referrerDomain: String(req.get("x-artifacthub-referrer-domain") || "").trim() || null,
      utmSource: String(req.get("x-artifacthub-utm-source") || "").trim() || null,
      utmMedium: String(req.get("x-artifacthub-utm-medium") || "").trim() || null,
      utmCampaign: String(req.get("x-artifacthub-utm-campaign") || "").trim() || null,
      localHour:
        Number.isInteger(localHour) && localHour >= 0 && localHour <= 23
          ? localHour
          : null,
    };
  }

  async function recordRouteUsage(req, eventName, options = {}) {
    await recordUsageEvent({
      eventName,
      userId: req.user?.id || null,
      requestPath: req.path,
      projectId: options.projectId || null,
      artifactId: options.artifactId || null,
      templateId: options.templateId || null,
      context: requestClientContext(req),
      metadata: options.metadata || {},
    });
  }

  function isRateLimited(userId) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const timestamps = (turnHistory.get(userId) || []).filter(
      (timestamp) => timestamp > cutoff,
    );
    if (timestamps.length >= config.ai.turnsPerHour) return true;
    timestamps.push(Date.now());
    turnHistory.set(userId, timestamps);
    return false;
  }

  router.get("/projects/:projectId/context", async (req, res) => {
    const items = await listContextItems(req.params.projectId, req.user.id);
    if (!items) return res.status(404).json({ error: "Project not found." });
    res.json({ items, completeness: contextCompleteness(items) });
  });

  router.patch("/projects/:projectId/context", async (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const saved = await upsertContextItems(
      req.params.projectId,
      req.user.id,
      items,
    );
    if (!saved) return res.status(404).json({ error: "Project not found." });
    await recordActivity(
      req.params.projectId,
      req.user.id,
      "context.updated",
      "Updated reusable project context.",
      { itemCount: items.length },
    );
    res.json({ items: saved, completeness: contextCompleteness(saved) });
  });

  for (const [path, trustState] of [
    ["confirm", "confirmed"],
    ["reject", "rejected"],
  ]) {
    router.post(
      `/projects/:projectId/context/:itemId/${path}`,
      async (req, res) => {
        const item = await setContextTrustState(
          req.params.projectId,
          req.params.itemId,
          req.user.id,
          trustState,
        );
        if (item === null) {
          return res.status(404).json({ error: "Project not found." });
        }
        if (!item) return res.status(404).json({ error: "Context item not found." });
        await recordActivity(
          req.params.projectId,
          req.user.id,
          `context.${trustState}`,
          `${trustState === "confirmed" ? "Confirmed" : "Rejected"} ${item.label || "a context item"}.`,
          { contextItemId: req.params.itemId },
        );
        res.json(item);
      },
    );
  }

  router.get("/projects/:projectId/activity", async (req, res) => {
    const activity = await listActivity(req.params.projectId, req.user.id, 30);
    if (!activity) return res.status(404).json({ error: "Project not found." });
    await recordRouteUsage(req, "project.activity_viewed", {
      projectId: req.params.projectId,
    });
    res.json({ activity });
  });

  router.get("/activity", async (req, res) => {
    const requestedLimit = Number.parseInt(String(req.query.limit || "50"), 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 50;
    await recordRouteUsage(req, "activity.feed_viewed");
    res.json({ activity: await listGlobalActivity(req.user.id, limit) });
  });

  router.get("/projects/:projectId/recommendation", async (req, res) => {
    const project = await getProjectByIdAndOwnerId(
      req.params.projectId,
      req.user.id,
    );
    if (!project) return res.status(404).json({ error: "Project not found." });
    res.json({
      recommendation: await buildProjectRecommendations(project, req.user.id),
    });
  });

  router.post(
    "/projects/:projectId/artifacts/:artifactId/conversations",
    async (req, res) => {
      const conversation = await createOrGetConversation(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
        String(req.body.operation || "interview"),
      );
      if (!conversation) {
        return res.status(404).json({ error: "Artifact not found." });
      }
      res.status(201).json(conversation);
    },
  );

  router.get(
    "/projects/:projectId/artifacts/:artifactId/conversation",
    async (req, res) => {
      const conversation = await getConversationWithMessages(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      if (!conversation) {
        return res.status(404).json({ error: "Artifact not found." });
      }
      res.json(conversation);
    },
  );

  router.post(
    "/projects/:projectId/artifacts/:artifactId/assistant/turns",
    async (req, res) => {
      const features = await getEffectiveFeatureAvailability(req.user);
      const aiStatus = await getEffectiveAiStatus(req.user);
      if (!features.aiAssistant) {
        return res.status(403).json({ error: "AI assistance is not enabled." });
      }
      if (!aiStatus.outboundApiCallsEnabled) {
        return res.status(503).json({
          error: "AI outbound API access is currently disabled by an administrator.",
          code: "AI_OUTBOUND_DISABLED",
        });
      }
      if (isRateLimited(req.user.id)) {
        return res.status(429).json({
          error: "Assistant turn limit reached. Try again later.",
          code: "AI_RATE_LIMITED",
        });
      }

      const userMessage = String(req.body.message || "").trim();
      if (userMessage.length > config.ai.maxMessageCharacters) {
        return res.status(400).json({
          error: `Messages must be ${config.ai.maxMessageCharacters} characters or fewer.`,
        });
      }

      const idempotencyKey = String(
        req.get("Idempotency-Key") || req.body.idempotencyKey || "",
      ).trim();
      if (!idempotencyKey) {
        return res.status(400).json({ error: "Idempotency key is required." });
      }

      const owned = await getArtifactForOwner(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      if (!owned) return res.status(404).json({ error: "Artifact not found." });
      if (
        req.body.expectedRevision !== undefined &&
        Number(req.body.expectedRevision) !== owned.artifact.revision
      ) {
        return res.status(409).json({
          error: "The artifact changed in another session.",
          code: "STALE_ARTIFACT_REVISION",
          latestArtifact: owned.artifact,
        });
      }

      const existingRun = await findAiRun(owned.artifact.id, idempotencyKey);
      if (existingRun) {
        return res.json(existingRun.structuredResult);
      }

      const template = await getTemplate(
        owned.artifact.templateId,
        owned.artifact.templateVersion,
      );
      if (!template?.aiEnabled) {
        return res.status(400).json({
          error: "AI guidance is only available for the Project Charter.",
        });
      }

      const conversation = await getConversationWithMessages(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );

      const confirmedContext = (
        (await listContextItems(req.params.projectId, req.user.id)) || []
      ).filter((item) => item.trustState === "confirmed");
      const operation = String(req.body.operation || "interview");
      await recordRouteUsage(req, "assistant.turn_requested", {
        projectId: req.params.projectId,
        artifactId: owned.artifact.id,
        templateId: owned.artifact.templateId,
        metadata: { operation },
      });

      try {
        const output = await generateArtifactTurn({
          operation,
          template,
          projectContext: confirmedContext,
          artifact: owned.artifact,
          conversation: conversation.messages,
          userMessage,
        });
        const provenance = await getProvenance(owned.artifact.id);
        const provenanceByField = new Map(
          provenance.map((item) => [item.fieldId, item.sourceType]),
        );
        const autoUpdates = [];
        const pendingUpdates = [];

        for (const update of output.result.fieldUpdates) {
          if (!template.fields.some((field) => field.id === update.fieldId)) {
            continue;
          }
          const current = owned.artifact.fieldValues[update.fieldId];
          const source = provenanceByField.get(update.fieldId);
          const isEmpty =
            current === undefined ||
            current === null ||
            current === "" ||
            (Array.isArray(current) && current.length === 0);
          if (isEmpty || source === "ai-populated" || source === "context-derived") {
            autoUpdates.push(update);
          } else {
            pendingUpdates.push(update);
          }
        }

        let savedArtifact = owned.artifact;
        if (autoUpdates.length) {
          const fieldValues = { ...owned.artifact.fieldValues };
          autoUpdates.forEach((update) => {
            fieldValues[update.fieldId] = update.value;
          });
          const updated = await updateArtifact({
            projectId: req.params.projectId,
            artifactId: req.params.artifactId,
            ownerId: req.user.id,
            title: owned.artifact.title,
            status: owned.artifact.status,
            fieldValues,
            expectedRevision: owned.artifact.revision,
            workflowStage: output.result.workflow.stage,
          });
          if (updated.stale) {
            return res.status(409).json({
              error: "The artifact changed before AI updates could be applied.",
              code: "STALE_ARTIFACT_REVISION",
              latestArtifact: updated.latestArtifact,
            });
          }
          savedArtifact = updated.artifact;
          await setProvenance(
            owned.artifact.id,
            autoUpdates.map((update) => ({
              fieldId: update.fieldId,
              sourceType: "ai-populated",
              sourceRecordId: idempotencyKey,
            })),
          );
        }

        if (output.result.contextCandidates.length) {
          await upsertContextItems(
            req.params.projectId,
            req.user.id,
            output.result.contextCandidates.map((candidate) => ({
              ...candidate,
              trustState: "proposed",
              sourceType: "ai",
              sourceRecordId: idempotencyKey,
            })),
          );
        }

        const responseBody = {
          ...output.result,
          autoUpdates,
          pendingUpdates,
          artifact: await enrichArtifact(
            req.params.projectId,
            savedArtifact,
            req.user.id,
          ),
        };
        if (userMessage) {
          await addConversationMessage(
            conversation.id,
            "user",
            userMessage,
          );
        }
        await addConversationMessage(
          conversation.id,
          "assistant",
          output.result.assistantMessage,
          { autoUpdates, pendingUpdates, workflow: output.result.workflow },
        );
        await saveAiRun({
          ownerId: req.user.id,
          conversationId: conversation.id,
          artifactId: owned.artifact.id,
          idempotencyKey,
          provider: output.provider,
          model: output.model,
          operation,
          promptVersion: 1,
          templateVersion: template.version,
          status: "completed",
          structuredResult: responseBody,
          usage: output.usage,
          latencyMs: output.latencyMs,
        });
        await recordRouteUsage(req, "assistant.turn_completed", {
          projectId: req.params.projectId,
          artifactId: owned.artifact.id,
          templateId: owned.artifact.templateId,
          metadata: { operation, model: output.model, provider: output.provider },
        });
        res.json(responseBody);
      } catch (error) {
        await saveAiRun({
          ownerId: req.user.id,
          conversationId: conversation.id,
          artifactId: owned.artifact.id,
          idempotencyKey,
          provider: config.ai.provider,
          model: config.ai.model,
          operation,
          templateVersion: template.version,
          status: "failed",
          errorCode: error.code || "AI_REQUEST_FAILED",
        });
        await recordRouteUsage(req, "assistant.turn_failed", {
          projectId: req.params.projectId,
          artifactId: owned.artifact.id,
          templateId: owned.artifact.templateId,
          metadata: { operation, errorCode: error.code || "AI_REQUEST_FAILED" },
        });
        console.error("Assistant turn failed.", error);
        res.status(502).json({
          error: "ArtifactHub Guide could not complete that turn.",
          code: error.code || "AI_REQUEST_FAILED",
        });
      }
    },
  );

  router.post(
    "/projects/:projectId/artifacts/:artifactId/assistant/accept",
    async (req, res) => {
      const owned = await getArtifactForOwner(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      if (!owned) return res.status(404).json({ error: "Artifact not found." });
      const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
      const fieldValues = { ...owned.artifact.fieldValues };
      updates.forEach((update) => {
        fieldValues[update.fieldId] = update.value;
      });
      const result = await updateArtifact({
        projectId: req.params.projectId,
        artifactId: req.params.artifactId,
        ownerId: req.user.id,
        title: owned.artifact.title,
        status: owned.artifact.status,
        fieldValues,
        expectedRevision: req.body.expectedRevision,
        workflowStage: owned.artifact.workflowStage,
      });
      if (result.stale) {
        return res.status(409).json({
          error: "The artifact changed in another session.",
          code: "STALE_ARTIFACT_REVISION",
          latestArtifact: result.latestArtifact,
        });
      }
      await setProvenance(
        owned.artifact.id,
        updates.map((update) => ({
          fieldId: update.fieldId,
          sourceType: "ai-populated",
          sourceRecordId: req.body.sourceRecordId || null,
        })),
      );
      await recordRouteUsage(req, "assistant.suggestion_accepted", {
        projectId: req.params.projectId,
        artifactId: owned.artifact.id,
        templateId: owned.artifact.templateId,
        metadata: { updateCount: updates.length },
      });
      res.json(
        await enrichArtifact(req.params.projectId, result.artifact, req.user.id),
      );
    },
  );

  router.post(
    "/projects/:projectId/artifacts/:artifactId/review",
    async (req, res) => {
      const owned = await getArtifactForOwner(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      if (!owned) return res.status(404).json({ error: "Artifact not found." });
      const template = await getTemplate(
        owned.artifact.templateId,
        owned.artifact.templateVersion,
      );
      const findings = buildRuleFindings(owned.artifact, template);

      const features = await getEffectiveFeatureAvailability(req.user);
      const aiStatus = await getEffectiveAiStatus(req.user);
      if (
        features.aiAssistant &&
        aiStatus.outboundApiCallsEnabled &&
        template.aiEnabled
      ) {
        const confirmedContext = (
          (await listContextItems(req.params.projectId, req.user.id)) || []
        ).filter((item) => item.trustState === "confirmed");
        const conversation = await getConversationWithMessages(
          req.params.projectId,
          req.params.artifactId,
          req.user.id,
        );
        const output = await generateArtifactTurn({
          operation: "review",
          template,
          projectContext: confirmedContext,
          artifact: owned.artifact,
          conversation: conversation.messages,
          userMessage: "",
        });
        findings.push(
          ...normalizeAiFindings(
            owned.artifact.id,
            output.result.reviewFindings,
          ),
        );
      }

      await replaceFindings(owned.artifact.id, findings);
      await recordActivity(
        req.params.projectId,
        req.user.id,
        "artifact.reviewed",
        `Reviewed ${owned.artifact.title}.`,
        { artifactId: owned.artifact.id, findingCount: findings.length },
      );
      await recordRouteUsage(req, "artifact.review_opened", {
        projectId: req.params.projectId,
        artifactId: owned.artifact.id,
        templateId: owned.artifact.templateId,
        metadata: { findingCount: findings.length },
      });
      res.json({ findings });
    },
  );

  router.patch(
    "/projects/:projectId/artifacts/:artifactId/findings/:findingId",
    async (req, res) => {
      const status = String(req.body.status || "");
      if (!["open", "resolved", "dismissed"].includes(status)) {
        return res.status(400).json({ error: "Invalid finding status." });
      }
      const finding = await updateFinding(
        req.params.projectId,
        req.params.artifactId,
        req.params.findingId,
        req.user.id,
        status,
      );
      if (!finding) return res.status(404).json({ error: "Finding not found." });
      res.json(finding);
    },
  );

  router.post(
    "/projects/:projectId/artifacts/:artifactId/approve",
    async (req, res) => {
      const owned = await getArtifactForOwner(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      if (!owned) return res.status(404).json({ error: "Artifact not found." });
      const template = await getTemplate(
        owned.artifact.templateId,
        owned.artifact.templateVersion,
      );
      const completeness = calculateCompleteness(template, owned.artifact.fieldValues);
      const findings = await listFindings(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      const blockers = findings.filter(
        (finding) =>
          finding.status === "open" && finding.severity === "blocking",
      );
      if (completeness.missingFieldIds.length || blockers.length) {
        return res.status(409).json({
          error: "Resolve required content and blocking findings before approval.",
          code: "APPROVAL_BLOCKED",
          completeness,
          blockers,
        });
      }

      const [provenance, context] = await Promise.all([
        getProvenance(owned.artifact.id),
        listContextItems(req.params.projectId, req.user.id),
      ]);
      const snapshot = {
        artifact: owned.artifact,
        template,
        provenance,
        confirmedContextIds: context
          .filter((item) => item.trustState === "confirmed")
          .map((item) => item.id),
      };
      const version = await createVersion(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
        snapshot,
      );
      await recordActivity(
        req.params.projectId,
        req.user.id,
        "artifact.approved",
        `Approved ${owned.artifact.title} version ${version.versionNumber}.`,
        { artifactId: owned.artifact.id, versionId: version.id },
      );
      await recordRouteUsage(req, "artifact.approved", {
        projectId: req.params.projectId,
        artifactId: owned.artifact.id,
        templateId: owned.artifact.templateId,
        metadata: { versionNumber: version.versionNumber },
      });
      res.json({ version });
    },
  );

  router.post(
    "/projects/:projectId/artifacts/:artifactId/reopen",
    async (req, res) => {
      const artifact = await reopenArtifact(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      if (!artifact) return res.status(404).json({ error: "Artifact not found." });
      res.json({ artifact });
    },
  );

  router.get(
    "/projects/:projectId/artifacts/:artifactId/versions",
    async (req, res) => {
      const versions = await listVersions(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      if (!versions) return res.status(404).json({ error: "Artifact not found." });
      res.json({ versions });
    },
  );

  router.get(
    "/projects/:projectId/artifacts/:artifactId/export-preview",
    async (req, res) => {
      const owned = await getArtifactForOwner(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      if (!owned) return res.status(404).json({ error: "Artifact not found." });
      const versions = await listVersions(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      const requestedVersion = Number(req.query.version);
      const version = Number.isInteger(requestedVersion)
        ? versions.find((item) => item.versionNumber === requestedVersion) || null
        : versions[0] || null;
      if (Number.isInteger(requestedVersion) && !version) {
        return res.status(404).json({ error: "Artifact version not found." });
      }
      const artifact = version?.snapshot?.artifact || owned.artifact;
      const template =
        version?.snapshot?.template ||
        (await getTemplate(artifact.templateId, artifact.templateVersion));
      res.json({
        project: owned.project,
        artifact,
        template,
        version,
        isDraft: !version,
      });
    },
  );

  router.get(
    "/projects/:projectId/artifacts/:artifactId/export.docx",
    async (req, res) => {
      const owned = await getArtifactForOwner(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      if (!owned) return res.status(404).json({ error: "Artifact not found." });
      const versions = await listVersions(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      const requestedVersion = Number(req.query.version);
      const version = Number.isInteger(requestedVersion)
        ? versions.find((item) => item.versionNumber === requestedVersion) || null
        : versions[0] || null;
      if (Number.isInteger(requestedVersion) && !version) {
        return res.status(404).json({ error: "Artifact version not found." });
      }
      const artifact = version?.snapshot?.artifact || owned.artifact;
      const template =
        version?.snapshot?.template ||
        (await getTemplate(artifact.templateId, artifact.templateVersion));
      const buffer = await renderArtifactDocx({
        artifact,
        project: owned.project,
        template,
        version,
      });
      await recordExport(artifact.id, version?.id, "docx", req.user.id);
      await recordRouteUsage(req, "artifact.exported", {
        projectId: req.params.projectId,
        artifactId: artifact.id,
        templateId: artifact.templateId,
        metadata: { format: "docx", version: version?.versionNumber || null },
      });
      const suffix = version ? `-v${version.versionNumber}` : "-draft";
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${slugifyFilename(owned.project.name)}-${slugifyFilename(artifact.title)}${suffix}.docx"`,
      );
      res.send(buffer);
    },
  );

  router.get(
    "/projects/:projectId/artifacts/:artifactId/export-phase1.md",
    async (req, res) => {
      const owned = await getArtifactForOwner(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      if (!owned) return res.status(404).json({ error: "Artifact not found." });
      const versions = await listVersions(
        req.params.projectId,
        req.params.artifactId,
        req.user.id,
      );
      const requestedVersion = Number(req.query.version);
      const version = Number.isInteger(requestedVersion)
        ? versions.find((item) => item.versionNumber === requestedVersion) || null
        : versions[0] || null;
      if (Number.isInteger(requestedVersion) && !version) {
        return res.status(404).json({ error: "Artifact version not found." });
      }
      const artifact = version?.snapshot?.artifact || owned.artifact;
      const template =
        version?.snapshot?.template ||
        (await getTemplate(artifact.templateId, artifact.templateVersion));
      const markdown = renderArtifactMarkdown({
        artifact,
        project: owned.project,
        template,
        version,
      });
      await recordExport(artifact.id, version?.id, "markdown", req.user.id);
      await recordRouteUsage(req, "artifact.exported", {
        projectId: req.params.projectId,
        artifactId: artifact.id,
        templateId: artifact.templateId,
        metadata: { format: "markdown-phase1", version: version?.versionNumber || null },
      });
      res.type("text/markdown").send(markdown);
    },
  );

  return router;
}

export { createPhase1Router };
