import {
  PHASE1_FILE,
  PROJECTS_FILE,
  USE_DATABASE,
  getProjectByIdAndOwnerId,
  mapArtifact,
  pool,
  readJsonFile,
  writeJsonFile,
} from "./storage.js";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyState() {
  return {
    contextItems: [],
    conversations: [],
    messages: [],
    aiRuns: [],
    provenance: [],
    findings: [],
    versions: [],
    exports: [],
    activity: [],
  };
}

async function readState() {
  return { ...emptyState(), ...(await readJsonFile(PHASE1_FILE, emptyState())) };
}

async function writeState(state) {
  await writeJsonFile(PHASE1_FILE, state);
}

async function assertProjectOwner(projectId, ownerId) {
  return Boolean(await getProjectByIdAndOwnerId(projectId, ownerId));
}

async function getArtifactForOwner(projectId, artifactId, ownerId) {
  const project = await getProjectByIdAndOwnerId(projectId, ownerId);
  const artifact = project?.artifacts.find((item) => item.id === artifactId);
  return project && artifact ? { project, artifact } : null;
}

function mapContextRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    category: row.category,
    key: row.item_key,
    label: row.label,
    value: row.value,
    trustState: row.trust_state,
    sourceType: row.source_type,
    sourceRecordId: row.source_record_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFindingRow(row) {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    fieldId: row.field_id,
    sourceType: row.source_type,
    severity: row.severity,
    findingType: row.finding_type,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

async function listContextItems(projectId, ownerId) {
  if (!(await assertProjectOwner(projectId, ownerId))) {
    return null;
  }

  if (!USE_DATABASE) {
    const state = await readState();
    return state.contextItems.filter((item) => item.projectId === projectId);
  }

  const result = await pool.query(
    `SELECT c.*
     FROM project_context_items c
     INNER JOIN projects p ON p.id = c.project_id
     WHERE c.project_id = $1 AND p.owner_id = $2
     ORDER BY c.category, c.created_at`,
    [projectId, ownerId],
  );
  return result.rows.map(mapContextRow);
}

function shouldPreserveConfirmedContextItem(existing, incoming) {
  return (
    existing?.trustState === "confirmed" &&
    incoming?.trustState === "proposed" &&
    incoming?.sourceType === "ai"
  );
}

async function upsertContextItems(projectId, ownerId, items) {
  if (!(await assertProjectOwner(projectId, ownerId))) {
    return null;
  }

  const timestamp = nowIso();
  const normalized = items.map((item) => ({
    id: item.id || createId("context"),
    projectId,
    category: String(item.category || "project-basics"),
    key: String(item.key || "").trim(),
    label: String(item.label || item.key || "").trim(),
    value: item.value ?? null,
    trustState: ["proposed", "confirmed", "rejected"].includes(item.trustState)
      ? item.trustState
      : "proposed",
    sourceType: String(item.sourceType || "user"),
    sourceRecordId: item.sourceRecordId || null,
    createdAt: item.createdAt || timestamp,
    updatedAt: timestamp,
  }));

  if (!USE_DATABASE) {
    const state = await readState();
    for (const item of normalized) {
      const index = state.contextItems.findIndex(
        (candidate) =>
          candidate.projectId === projectId &&
          candidate.category === item.category &&
          candidate.key === item.key,
      );
      if (index >= 0) {
        const existing = state.contextItems[index];
        if (shouldPreserveConfirmedContextItem(existing, item)) {
          continue;
        }
        state.contextItems[index] = {
          ...existing,
          ...item,
          id: existing.id,
          createdAt: existing.createdAt,
        };
      } else {
        state.contextItems.push(item);
      }
    }
    await writeState(state);
    return state.contextItems.filter((item) => item.projectId === projectId);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of normalized) {
      await client.query(
        `INSERT INTO project_context_items (
           id, project_id, category, item_key, label, value, trust_state,
           source_type, source_record_id, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
         ON CONFLICT (project_id, category, item_key) DO UPDATE
         SET label = CASE
               WHEN project_context_items.trust_state = 'confirmed'
                 AND EXCLUDED.trust_state = 'proposed'
                 AND EXCLUDED.source_type = 'ai'
               THEN project_context_items.label
               ELSE EXCLUDED.label
             END,
             value = CASE
               WHEN project_context_items.trust_state = 'confirmed'
                 AND EXCLUDED.trust_state = 'proposed'
                 AND EXCLUDED.source_type = 'ai'
               THEN project_context_items.value
               ELSE EXCLUDED.value
             END,
             trust_state = CASE
               WHEN project_context_items.trust_state = 'confirmed'
                 AND EXCLUDED.trust_state = 'proposed'
                 AND EXCLUDED.source_type = 'ai'
               THEN project_context_items.trust_state
               ELSE EXCLUDED.trust_state
             END,
             source_type = CASE
               WHEN project_context_items.trust_state = 'confirmed'
                 AND EXCLUDED.trust_state = 'proposed'
                 AND EXCLUDED.source_type = 'ai'
               THEN project_context_items.source_type
               ELSE EXCLUDED.source_type
             END,
             source_record_id = CASE
               WHEN project_context_items.trust_state = 'confirmed'
                 AND EXCLUDED.trust_state = 'proposed'
                 AND EXCLUDED.source_type = 'ai'
               THEN project_context_items.source_record_id
               ELSE EXCLUDED.source_record_id
             END,
             updated_at = CASE
               WHEN project_context_items.trust_state = 'confirmed'
                 AND EXCLUDED.trust_state = 'proposed'
                 AND EXCLUDED.source_type = 'ai'
               THEN project_context_items.updated_at
               ELSE EXCLUDED.updated_at
             END`,
        [
          item.id,
          projectId,
          item.category,
          item.key,
          item.label,
          JSON.stringify(item.value),
          item.trustState,
          item.sourceType,
          item.sourceRecordId,
          item.createdAt,
          item.updatedAt,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return listContextItems(projectId, ownerId);
}

async function setContextTrustState(projectId, itemId, ownerId, trustState) {
  if (!(await assertProjectOwner(projectId, ownerId))) {
    return null;
  }

  if (!USE_DATABASE) {
    const state = await readState();
    const item = state.contextItems.find(
      (candidate) =>
        candidate.id === itemId && candidate.projectId === projectId,
    );
    if (!item) return false;
    item.trustState = trustState;
    item.updatedAt = nowIso();
    await writeState(state);
    return item;
  }

  const result = await pool.query(
    `UPDATE project_context_items c
     SET trust_state = $4, updated_at = NOW()
     FROM projects p
     WHERE c.id = $1
       AND c.project_id = $2
       AND p.id = c.project_id
       AND p.owner_id = $3
     RETURNING c.*`,
    [itemId, projectId, ownerId, trustState],
  );
  return result.rows[0] ? mapContextRow(result.rows[0]) : false;
}

async function recordActivity(projectId, actorId, eventType, summary, metadata = {}) {
  const artifactId =
    typeof metadata.artifactId === "string" ? metadata.artifactId : null;
  const event = {
    id: createId("activity"),
    projectId,
    artifactId,
    actorId,
    eventType,
    summary,
    metadata,
    createdAt: nowIso(),
  };

  if (!USE_DATABASE) {
    const state = await readState();
    state.activity.unshift(event);
    await writeState(state);
    return event;
  }

  await pool.query(
    `INSERT INTO activity_events (
       id, owner_id, project_id, artifact_id, actor_id, event_type, summary,
       metadata, created_at
     )
     SELECT $1, p.owner_id, p.id, a.id, $3, $4, $5, $6::jsonb, $7
     FROM projects p
     LEFT JOIN artifacts a ON a.id = $8 AND a.owner_id = p.owner_id
     WHERE p.id = $2`,
    [
      event.id,
      projectId,
      actorId,
      eventType,
      summary,
      JSON.stringify(metadata),
      event.createdAt,
      artifactId,
    ],
  );
  return event;
}

async function listActivity(projectId, ownerId, limit = 20) {
  if (!(await assertProjectOwner(projectId, ownerId))) return null;

  if (!USE_DATABASE) {
    const state = await readState();
    return state.activity
      .filter((item) => item.projectId === projectId)
      .slice(0, limit);
  }

  const result = await pool.query(
    `SELECT e.id,
            e.project_id AS "projectId",
            e.actor_id AS "actorId",
            e.event_type AS "eventType",
            e.summary,
            e.metadata,
            e.created_at AS "createdAt"
     FROM activity_events e
     WHERE e.project_id = $1 AND e.owner_id = $2
     ORDER BY e.created_at DESC
     LIMIT $3`,
    [projectId, ownerId, limit],
  );
  return result.rows;
}

function activityTargetFor(event) {
  const metadata = event.metadata || {};
  const artifactId =
    typeof metadata.artifactId === "string" ? metadata.artifactId : null;

  if (event.eventType === "project.created") {
    return {
      targetHref: `/projects/${event.projectId}`,
      targetLabel: "Open project",
    };
  }

  if (event.eventType.startsWith("context.")) {
    return {
      targetHref: `/projects/${event.projectId}/context`,
      targetLabel: "Review context",
    };
  }

  if (artifactId && event.eventType === "artifact.reviewed") {
    return {
      targetHref: `/projects/${event.projectId}/artifacts/${artifactId}/review`,
      targetLabel: "Open review",
    };
  }

  if (artifactId && event.eventType === "artifact.approved") {
    return {
      targetHref: `/projects/${event.projectId}/artifacts/${artifactId}/export`,
      targetLabel: "Open export",
    };
  }

  if (artifactId && event.eventType.startsWith("artifact.")) {
    return {
      targetHref: `/projects/${event.projectId}/artifacts/${artifactId}`,
      targetLabel: "Open artifact",
    };
  }

  return {
    targetHref: `/projects/${event.projectId}`,
    targetLabel: "Open project",
  };
}

function enrichActivityEvent(event) {
  return {
    ...event,
    ...activityTargetFor(event),
  };
}

async function listGlobalActivity(ownerId, limit = 50) {
  if (!USE_DATABASE) {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    const ownedProjects = new Map(
      projects
        .filter((project) => project.ownerId === ownerId)
        .map((project) => [project.id, project]),
    );
    const state = await readState();
    return state.activity
      .filter((event) => ownedProjects.has(event.projectId))
      .slice(0, limit)
      .map((event) =>
        enrichActivityEvent({
          ...event,
          projectName: ownedProjects.get(event.projectId)?.name || "Project",
        }),
      );
  }

  const result = await pool.query(
    `SELECT e.id,
            e.project_id AS "projectId",
            e.actor_id AS "actorId",
            e.event_type AS "eventType",
            e.summary,
            e.metadata,
            e.created_at AS "createdAt",
            p.name AS "projectName"
     FROM activity_events e
     LEFT JOIN projects p ON p.id = e.project_id
     WHERE e.owner_id = $1
     ORDER BY e.created_at DESC
     LIMIT $2`,
    [ownerId, limit],
  );
  return result.rows.map(enrichActivityEvent);
}

async function getProvenance(artifactId) {
  if (!USE_DATABASE) {
    const state = await readState();
    return state.provenance.filter((item) => item.artifactId === artifactId);
  }

  const result = await pool.query(
    `SELECT artifact_id AS "artifactId",
            field_id AS "fieldId",
            source_type AS "sourceType",
            source_record_id AS "sourceRecordId",
            updated_at AS "updatedAt"
     FROM artifact_field_provenance
     WHERE artifact_id = $1`,
    [artifactId],
  );
  return result.rows;
}

async function setProvenance(artifactId, entries) {
  const timestamp = nowIso();

  if (!USE_DATABASE) {
    const state = await readState();
    for (const entry of entries) {
      const index = state.provenance.findIndex(
        (item) =>
          item.artifactId === artifactId && item.fieldId === entry.fieldId,
      );
      const value = {
        artifactId,
        fieldId: entry.fieldId,
        sourceType: entry.sourceType,
        sourceRecordId: entry.sourceRecordId || null,
        updatedAt: timestamp,
      };
      if (index >= 0) state.provenance[index] = value;
      else state.provenance.push(value);
    }
    await writeState(state);
    return;
  }

  for (const entry of entries) {
    await pool.query(
      `INSERT INTO artifact_field_provenance (
         artifact_id, field_id, source_type, source_record_id, updated_at
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (artifact_id, field_id) DO UPDATE
       SET source_type = EXCLUDED.source_type,
           source_record_id = EXCLUDED.source_record_id,
           updated_at = EXCLUDED.updated_at`,
      [
        artifactId,
        entry.fieldId,
        entry.sourceType,
        entry.sourceRecordId || null,
        timestamp,
      ],
    );
  }
}

async function createOrGetConversation(projectId, artifactId, ownerId, operation) {
  if (!(await getArtifactForOwner(projectId, artifactId, ownerId))) return null;

  if (!USE_DATABASE) {
    const state = await readState();
    let conversation = state.conversations.find(
      (item) => item.artifactId === artifactId && item.status === "active",
    );
    if (!conversation) {
      const timestamp = nowIso();
      conversation = {
        id: createId("conversation"),
        projectId,
        artifactId,
        operation,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.conversations.push(conversation);
      await writeState(state);
    }
    return conversation;
  }

  const existing = await pool.query(
    `SELECT id,
            owner_id AS "ownerId",
            project_id AS "projectId",
            artifact_id AS "artifactId",
            operation,
            context_scope AS "contextScope",
            status,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM conversations
     WHERE artifact_id = $1 AND owner_id = $2 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [artifactId, ownerId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const timestamp = nowIso();
  const conversation = {
    id: createId("conversation"),
    ownerId,
    projectId,
    artifactId,
    operation,
    contextScope: "project_context",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await pool.query(
    `INSERT INTO conversations (
       id, owner_id, project_id, artifact_id, operation, context_scope, status,
       created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    Object.values(conversation),
  );
  return conversation;
}

async function getConversationWithMessages(projectId, artifactId, ownerId) {
  const conversation = await createOrGetConversation(
    projectId,
    artifactId,
    ownerId,
    "interview",
  );
  if (!conversation) return null;

  if (!USE_DATABASE) {
    const state = await readState();
    return {
      ...conversation,
      messages: state.messages.filter(
        (item) => item.conversationId === conversation.id,
      ),
    };
  }

  const result = await pool.query(
    `SELECT id,
            conversation_id AS "conversationId",
            role,
            content,
            metadata,
            created_at AS "createdAt"
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at`,
    [conversation.id],
  );
  return { ...conversation, messages: result.rows };
}

async function addConversationMessage(conversationId, role, content, metadata = {}) {
  const message = {
    id: createId("message"),
    conversationId,
    role,
    content,
    metadata,
    createdAt: nowIso(),
  };

  if (!USE_DATABASE) {
    const state = await readState();
    state.messages.push(message);
    const conversation = state.conversations.find(
      (item) => item.id === conversationId,
    );
    if (conversation) conversation.updatedAt = message.createdAt;
    await writeState(state);
    return message;
  }

  await pool.query(
    `INSERT INTO conversation_messages (
       id, conversation_id, role, content, metadata, created_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      message.id,
      conversationId,
      role,
      content,
      JSON.stringify(metadata),
      message.createdAt,
    ],
  );
  await pool.query(
    "UPDATE conversations SET updated_at = $2 WHERE id = $1",
    [conversationId, message.createdAt],
  );
  return message;
}

async function findAiRun(artifactId, idempotencyKey) {
  if (!USE_DATABASE) {
    const state = await readState();
    return (
      state.aiRuns.find(
        (item) =>
          item.artifactId === artifactId &&
          item.idempotencyKey === idempotencyKey,
      ) || null
    );
  }

  const result = await pool.query(
    `SELECT structured_result AS "structuredResult", status, error_code AS "errorCode"
     FROM ai_runs
     WHERE artifact_id = $1 AND idempotency_key = $2`,
    [artifactId, idempotencyKey],
  );
  return result.rows[0] || null;
}

async function saveAiRun(run) {
  const record = {
    id: run.id || createId("airun"),
    ...run,
    createdAt: run.createdAt || nowIso(),
  };

  if (!USE_DATABASE) {
    const state = await readState();
    state.aiRuns.push(record);
    await writeState(state);
    return record;
  }

  await pool.query(
    `INSERT INTO ai_runs (
       id, owner_id, conversation_id, artifact_id, idempotency_key, provider,
       model, operation, prompt_version, template_version, status,
       structured_result, usage, latency_ms, error_code, created_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12::jsonb, $13::jsonb, $14, $15, $16
     )`,
    [
      record.id,
      record.ownerId,
      record.conversationId,
      record.artifactId,
      record.idempotencyKey,
      record.provider,
      record.model,
      record.operation,
      record.promptVersion || 1,
      record.templateVersion || 1,
      record.status,
      JSON.stringify(record.structuredResult || null),
      JSON.stringify(record.usage || null),
      record.latencyMs || null,
      record.errorCode || null,
      record.createdAt,
    ],
  );
  return record;
}

async function replaceFindings(artifactId, findings) {
  if (!USE_DATABASE) {
    const state = await readState();
    state.findings = state.findings.filter(
      (item) =>
        item.artifactId !== artifactId ||
        item.status === "resolved" ||
        item.status === "dismissed",
    );
    state.findings.push(...findings);
    await writeState(state);
    return findings;
  }

  await pool.query(
    `DELETE FROM artifact_review_findings
     WHERE artifact_id = $1 AND status = 'open'`,
    [artifactId],
  );
  for (const finding of findings) {
    await pool.query(
      `INSERT INTO artifact_review_findings (
         id, artifact_id, field_id, source_type, severity, finding_type,
         message, status, created_at, resolved_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        finding.id,
        artifactId,
        finding.fieldId || null,
        finding.sourceType,
        finding.severity,
        finding.findingType,
        finding.message,
        finding.status,
        finding.createdAt,
        finding.resolvedAt || null,
      ],
    );
  }
  return findings;
}

async function listFindings(projectId, artifactId, ownerId) {
  if (!(await getArtifactForOwner(projectId, artifactId, ownerId))) return null;

  if (!USE_DATABASE) {
    const state = await readState();
    return state.findings.filter((item) => item.artifactId === artifactId);
  }

  const result = await pool.query(
    `SELECT id,
            artifact_id AS "artifactId",
            field_id AS "fieldId",
            source_type AS "sourceType",
            severity,
            finding_type AS "findingType",
            message,
            status,
            created_at AS "createdAt",
            resolved_at AS "resolvedAt"
     FROM artifact_review_findings
     WHERE artifact_id = $1
     ORDER BY
       CASE severity WHEN 'blocking' THEN 0 ELSE 1 END,
       created_at`,
    [artifactId],
  );
  return result.rows;
}

async function updateFinding(projectId, artifactId, findingId, ownerId, status) {
  if (!(await getArtifactForOwner(projectId, artifactId, ownerId))) return null;
  const resolvedAt = status === "open" ? null : nowIso();

  if (!USE_DATABASE) {
    const state = await readState();
    const finding = state.findings.find(
      (item) => item.id === findingId && item.artifactId === artifactId,
    );
    if (!finding) return false;
    finding.status = status;
    finding.resolvedAt = resolvedAt;
    await writeState(state);
    return finding;
  }

  const result = await pool.query(
    `UPDATE artifact_review_findings
     SET status = $4, resolved_at = $5
     FROM artifacts a
     INNER JOIN projects p ON p.id = a.project_id
     WHERE artifact_review_findings.id = $1
       AND artifact_review_findings.artifact_id = $2
       AND a.id = artifact_review_findings.artifact_id
       AND p.owner_id = $3
     RETURNING *`,
    [findingId, artifactId, ownerId, status, resolvedAt],
  );
  return result.rows[0] ? mapFindingRow(result.rows[0]) : false;
}

async function createVersion(projectId, artifactId, ownerId, snapshot) {
  if (!(await getArtifactForOwner(projectId, artifactId, ownerId))) return null;
  const timestamp = nowIso();

  if (!USE_DATABASE) {
    const state = await readState();
    const versions = state.versions.filter(
      (item) => item.artifactId === artifactId,
    );
    const approvedAt = timestamp;
    const approvedBy = ownerId;
    const versionNumber = versions.length + 1;
    const version = {
      id: createId("version"),
      artifactId,
      versionNumber,
      snapshot: {
        ...snapshot,
        approval: { approvedBy, approvedAt, versionNumber },
      },
      approvedBy,
      approvedAt,
    };
    state.versions.push(version);
    const projects = await readJsonFile(PROJECTS_FILE, []);
    const artifact = projects
      .find((project) => project.id === projectId)
      ?.artifacts.find((item) => item.id === artifactId);
    if (artifact) {
      artifact.status = "approved";
      artifact.workflowStage = "approved";
      artifact.revision = (Number(artifact.revision) || 1) + 1;
      artifact.updatedAt = timestamp;
      await writeJsonFile(PROJECTS_FILE, projects);
    }
    await writeState(state);
    return version;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM artifacts WHERE id = $1 FOR UPDATE", [
      artifactId,
    ]);
    const countResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM artifact_versions WHERE artifact_id = $1",
      [artifactId],
    );
    const approvedAt = timestamp;
    const approvedBy = ownerId;
    const versionNumber = Number(countResult.rows[0].count) + 1;
    const version = {
      id: createId("version"),
      artifactId,
      versionNumber,
      snapshot: {
        ...snapshot,
        approval: { approvedBy, approvedAt, versionNumber },
      },
      approvedBy,
      approvedAt,
    };
    await client.query(
      `INSERT INTO artifact_versions (
         id, artifact_id, version_number, snapshot, approved_by, approved_at
       )
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        version.id,
        artifactId,
        version.versionNumber,
        JSON.stringify(snapshot),
        ownerId,
        timestamp,
      ],
    );
    await client.query(
      `UPDATE artifacts
       SET status = 'approved',
           workflow_stage = 'approved',
           revision = revision + 1,
           updated_at = $2
       WHERE id = $1`,
      [artifactId, timestamp],
    );
    await client.query("COMMIT");
    return version;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listVersions(projectId, artifactId, ownerId) {
  if (!(await getArtifactForOwner(projectId, artifactId, ownerId))) return null;

  if (!USE_DATABASE) {
    const state = await readState();
    return state.versions
      .filter((item) => item.artifactId === artifactId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }

  const result = await pool.query(
    `SELECT id,
            artifact_id AS "artifactId",
            version_number AS "versionNumber",
            snapshot,
            approved_by AS "approvedBy",
            approved_at AS "approvedAt"
     FROM artifact_versions
     WHERE artifact_id = $1
     ORDER BY version_number DESC`,
    [artifactId],
  );
  return result.rows;
}

async function reopenArtifact(projectId, artifactId, ownerId) {
  if (!(await getArtifactForOwner(projectId, artifactId, ownerId))) return null;
  const timestamp = nowIso();

  if (!USE_DATABASE) {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    const artifact = projects
      .find((project) => project.id === projectId)
      ?.artifacts.find((item) => item.id === artifactId);
    if (!artifact) return false;
    artifact.status = "draft";
    artifact.workflowStage = "drafting";
    artifact.revision = (Number(artifact.revision) || 1) + 1;
    artifact.updatedAt = timestamp;
    await writeJsonFile(PROJECTS_FILE, projects);
    return artifact;
  }

  const result = await pool.query(
    `UPDATE artifacts
     SET status = 'draft',
         workflow_stage = 'drafting',
         revision = revision + 1,
         updated_at = $3
     WHERE id = $1 AND project_id = $2
     RETURNING *`,
    [artifactId, projectId, timestamp],
  );
  return result.rows[0] ? mapArtifact(result.rows[0]) : false;
}

async function recordExport(artifactId, versionId, format, requestedBy) {
  const record = {
    id: createId("export"),
    artifactId,
    artifactVersionId: versionId || null,
    format,
    requestedBy,
    createdAt: nowIso(),
  };

  if (!USE_DATABASE) {
    const state = await readState();
    state.exports.push(record);
    await writeState(state);
    return record;
  }

  await pool.query(
    `INSERT INTO artifact_exports (
       id, artifact_id, artifact_version_id, format, requested_by, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6)`,
    Object.values(record),
  );
  return record;
}

export {
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
};
