import path from "path";
import {
  DATA_DIR,
  USE_DATABASE,
  getUserById,
  listUsersForAdmin,
  pool,
  readJsonFile,
  writeJsonFile,
} from "../../storage.js";

const SYSTEM_SETTINGS_FILE = path.join(DATA_DIR, "system-settings.json");
const USAGE_EVENTS_FILE = path.join(DATA_DIR, "usage-events.json");
const ADMIN_AUDIT_EVENTS_FILE = path.join(DATA_DIR, "admin-audit-events.json");

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultSystemSettings() {
  return {
    aiEnabledOverride: null,
    outboundApiCallsEnabled: true,
    updatedAt: null,
    updatedBy: null,
  };
}

function normalizeSystemSettings(settings) {
  return {
    ...defaultSystemSettings(),
    ...(settings || {}),
    aiEnabledOverride:
      settings?.aiEnabledOverride === true || settings?.aiEnabledOverride === false
        ? settings.aiEnabledOverride
        : null,
    outboundApiCallsEnabled:
      settings?.outboundApiCallsEnabled === false ? false : true,
  };
}

async function getSystemSettings() {
  if (!USE_DATABASE) {
    return normalizeSystemSettings(
      await readJsonFile(SYSTEM_SETTINGS_FILE, defaultSystemSettings()),
    );
  }

  const result = await pool.query(
    `SELECT setting_key AS "key", setting_value AS "value", updated_at AS "updatedAt", updated_by AS "updatedBy"
     FROM system_settings`,
  );

  const mapped = defaultSystemSettings();
  for (const row of result.rows) {
    if (row.key === "aiEnabledOverride") {
      mapped.aiEnabledOverride =
        row.value === true || row.value === false ? row.value : null;
      mapped.updatedAt = row.updatedAt;
      mapped.updatedBy = row.updatedBy;
    }
    if (row.key === "outboundApiCallsEnabled") {
      mapped.outboundApiCallsEnabled = row.value === false ? false : true;
      mapped.updatedAt = row.updatedAt;
      mapped.updatedBy = row.updatedBy;
    }
  }
  return mapped;
}

async function updateSystemSettings(patch, updatedBy) {
  const next = normalizeSystemSettings({
    ...(await getSystemSettings()),
    ...patch,
    updatedAt: nowIso(),
    updatedBy,
  });

  if (!USE_DATABASE) {
    await writeJsonFile(SYSTEM_SETTINGS_FILE, next);
    return next;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of [
      ["aiEnabledOverride", next.aiEnabledOverride],
      ["outboundApiCallsEnabled", next.outboundApiCallsEnabled],
    ]) {
      await client.query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (setting_key) DO UPDATE
         SET setting_value = EXCLUDED.setting_value,
             updated_at = EXCLUDED.updated_at,
             updated_by = EXCLUDED.updated_by`,
        [key, JSON.stringify(value), next.updatedAt, updatedBy],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return next;
}

async function recordUsageEvent(event) {
  const record = {
    id: event.id || createId("usage"),
    eventName: event.eventName,
    userId: event.userId || null,
    sessionId: event.sessionId || null,
    requestPath: event.requestPath || null,
    projectId: event.projectId || null,
    artifactId: event.artifactId || null,
    templateId: event.templateId || null,
    occurredAt: event.occurredAt || nowIso(),
    context: event.context || {},
    metadata: event.metadata || {},
  };

  if (!USE_DATABASE) {
    const events = await readJsonFile(USAGE_EVENTS_FILE, []);
    events.unshift(record);
    await writeJsonFile(USAGE_EVENTS_FILE, events);
    return record;
  }

  await pool.query(
    `INSERT INTO usage_events (
       id, event_name, user_id, session_id, request_path, project_id,
       artifact_id, template_id, event_context, metadata, occurred_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11
     )`,
    [
      record.id,
      record.eventName,
      record.userId,
      record.sessionId,
      record.requestPath,
      record.projectId,
      record.artifactId,
      record.templateId,
      JSON.stringify(record.context),
      JSON.stringify(record.metadata),
      record.occurredAt,
    ],
  );
  return record;
}

async function listUsageEvents({ since, limit = 1000, userId, eventName } = {}) {
  const normalizedEventName =
    typeof eventName === "string" && eventName.trim() ? eventName.trim() : null;

  if (!USE_DATABASE) {
    const events = await readJsonFile(USAGE_EVENTS_FILE, []);
    return events
      .filter(
        (event) =>
          (!since || event.occurredAt >= since) &&
          (!userId || event.userId === userId) &&
          (!normalizedEventName || event.eventName === normalizedEventName),
      )
      .slice(0, limit);
  }

  const values = [];
  const where = [];
  if (normalizedEventName) {
    values.push(normalizedEventName);
    where.push(`event_name = $${values.length}`);
  }
  if (since) {
    values.push(since);
    where.push(`occurred_at >= $${values.length}`);
  }
  if (userId) {
    values.push(userId);
    where.push(`user_id = $${values.length}`);
  }
  values.push(limit);

  const result = await pool.query(
    `SELECT id,
            event_name AS "eventName",
            user_id AS "userId",
            session_id AS "sessionId",
            request_path AS "requestPath",
            project_id AS "projectId",
            artifact_id AS "artifactId",
            template_id AS "templateId",
            event_context AS context,
            metadata,
            occurred_at AS "occurredAt"
     FROM usage_events
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY occurred_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows;
}

async function recordAdminAuditEvent(event) {
  const record = {
    id: event.id || createId("audit"),
    adminUserId: event.adminUserId,
    action: event.action,
    targetUserId: event.targetUserId || null,
    targetType: event.targetType || null,
    targetId: event.targetId || null,
    metadata: event.metadata || {},
    createdAt: event.createdAt || nowIso(),
  };

  if (!USE_DATABASE) {
    const events = await readJsonFile(ADMIN_AUDIT_EVENTS_FILE, []);
    events.unshift(record);
    await writeJsonFile(ADMIN_AUDIT_EVENTS_FILE, events);
    return record;
  }

  await pool.query(
    `INSERT INTO admin_audit_events (
       id, admin_user_id, action, target_user_id, target_type, target_id, metadata, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      record.id,
      record.adminUserId,
      record.action,
      record.targetUserId,
      record.targetType,
      record.targetId,
      JSON.stringify(record.metadata),
      record.createdAt,
    ],
  );
  return record;
}

async function listAdminAuditEvents(limit = 20) {
  if (!USE_DATABASE) {
    const events = await readJsonFile(ADMIN_AUDIT_EVENTS_FILE, []);
    return events.slice(0, limit);
  }

  const result = await pool.query(
    `SELECT id,
            admin_user_id AS "adminUserId",
            action,
            target_user_id AS "targetUserId",
            target_type AS "targetType",
            target_id AS "targetId",
            metadata,
            created_at AS "createdAt"
     FROM admin_audit_events
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

function parseTimeRange(range) {
  if (range === "24h") return Date.now() - 24 * 60 * 60 * 1000;
  if (range === "7d") return Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (range === "30d") return Date.now() - 30 * 24 * 60 * 60 * 1000;
  return null;
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function userLocalHour(event) {
  const hour = Number(event.context?.localHour);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

async function getAdminAnalytics(range = "7d") {
  const cutoff = parseTimeRange(range);
  const since = cutoff ? new Date(cutoff).toISOString() : undefined;
  const [events, users] = await Promise.all([
    listUsageEvents({ since, limit: 5000 }),
    listUsersForAdmin(),
  ]);

  const metrics = {
    signups: 0,
    logins: 0,
    activeUsers: new Set(),
    projectsCreated: 0,
    artifactsCreated: 0,
    approvals: 0,
    exports: 0,
    aiTurns: 0,
  };
  const sourceCounts = new Map();
  const campaignCounts = new Map();
  const templateCounts = new Map();
  const loginHourCounts = new Map();
  const activityHourCounts = new Map();
  const funnelUsers = {
    landed: new Set(),
    authed: new Set(),
    viewedWork: new Set(),
    startedDraft: new Set(),
    exported: new Set(),
  };

  for (const event of events) {
    if (event.userId) metrics.activeUsers.add(event.userId);
    const source =
      event.context?.utmSource ||
      event.context?.referrerDomain ||
      event.context?.referrer ||
      "Direct";
    const campaign = event.context?.utmCampaign || "Unspecified";
    const localHour = userLocalHour(event);
    if (localHour !== null) {
      increment(activityHourCounts, String(localHour));
    }
    increment(sourceCounts, source);
    increment(campaignCounts, campaign);

    if (event.userId) {
      funnelUsers.landed.add(event.userId);
    }

    switch (event.eventName) {
      case "auth.signup_completed":
        metrics.signups += 1;
        if (event.userId) funnelUsers.authed.add(event.userId);
        break;
      case "auth.login_completed":
        metrics.logins += 1;
        if (localHour !== null) {
          increment(loginHourCounts, String(localHour));
        }
        if (event.userId) funnelUsers.authed.add(event.userId);
        break;
      case "project.created":
        metrics.projectsCreated += 1;
        if (event.userId) funnelUsers.viewedWork.add(event.userId);
        break;
      case "artifact.created":
      case "artifact.unassigned_started":
        metrics.artifactsCreated += 1;
        if (event.templateId) increment(templateCounts, event.templateId);
        if (event.userId) funnelUsers.startedDraft.add(event.userId);
        break;
      case "artifact.approved":
        metrics.approvals += 1;
        break;
      case "artifact.exported":
        metrics.exports += 1;
        if (event.userId) funnelUsers.exported.add(event.userId);
        break;
      case "assistant.turn_completed":
        metrics.aiTurns += 1;
        break;
      case "library.template_opened":
        if (event.templateId) increment(templateCounts, event.templateId);
        if (event.userId) funnelUsers.viewedWork.add(event.userId);
        break;
      case "library.viewed":
      case "projects.list_viewed":
      case "project.opened":
        if (event.userId) funnelUsers.viewedWork.add(event.userId);
        break;
      default:
        break;
    }
  }

  const topUsers = users.slice(0, 20).map((user) => {
    const userEvents = events.filter((event) => event.userId === user.id);
    const loginEvent = userEvents.find((event) => event.eventName === "auth.login_completed");
    const lastEvent = userEvents[0];
    return {
      ...user,
      lastLoginAt: loginEvent?.occurredAt || null,
      lastSeenAt: lastEvent?.occurredAt || null,
      timezone:
        loginEvent?.context?.timezone ||
        lastEvent?.context?.timezone ||
        null,
      source:
        loginEvent?.context?.utmSource ||
        lastEvent?.context?.utmSource ||
        loginEvent?.context?.referrerDomain ||
        lastEvent?.context?.referrerDomain ||
        null,
    };
  });

  return {
    range,
    metrics: {
      ...metrics,
      activeUsers: metrics.activeUsers.size,
    },
    topSources: [...sourceCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([label, count]) => ({ label, count })),
    topCampaigns: [...campaignCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([label, count]) => ({ label, count })),
    templateUsage: [...templateCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([templateId, count]) => ({ templateId, count })),
    loginByLocalHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: loginHourCounts.get(String(hour)) || 0,
    })),
    activityByLocalHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: activityHourCounts.get(String(hour)) || 0,
    })),
    funnel: [
      { label: "Landed", count: funnelUsers.landed.size },
      { label: "Authenticated", count: funnelUsers.authed.size },
      { label: "Viewed work", count: funnelUsers.viewedWork.size },
      { label: "Started draft", count: funnelUsers.startedDraft.size },
      { label: "Exported", count: funnelUsers.exported.size },
    ],
    topUsers,
  };
}

async function getAdminUserDetail(userId) {
  const [user, events] = await Promise.all([
    getUserById(userId),
    listUsageEvents({ userId, limit: 200 }),
  ]);
  if (!user) return null;

  const lastLogin = events.find((event) => event.eventName === "auth.login_completed");
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    timezone:
      lastLogin?.context?.timezone ||
      events[0]?.context?.timezone ||
      null,
    lastLoginAt: lastLogin?.occurredAt || null,
    lastSeenAt: events[0]?.occurredAt || null,
    sourceSummary: {
      utmSource:
        lastLogin?.context?.utmSource || events[0]?.context?.utmSource || null,
      referrerDomain:
        lastLogin?.context?.referrerDomain ||
        events[0]?.context?.referrerDomain ||
        null,
      landingPath:
        lastLogin?.context?.landingPath ||
        events[0]?.context?.landingPath ||
        null,
      country:
        lastLogin?.context?.country ||
        events[0]?.context?.country ||
        null,
      region:
        lastLogin?.context?.region ||
        events[0]?.context?.region ||
        null,
    },
    timeline: events.slice(0, 50),
  };
}

export {
  ADMIN_AUDIT_EVENTS_FILE,
  SYSTEM_SETTINGS_FILE,
  USAGE_EVENTS_FILE,
  getAdminAnalytics,
  getAdminUserDetail,
  getSystemSettings,
  listAdminAuditEvents,
  listUsageEvents,
  recordAdminAuditEvent,
  recordUsageEvent,
  updateSystemSettings,
};
