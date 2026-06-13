import {
  getProvenance,
  listContextItems,
  listFindings,
} from "./phase1-storage.js";
import { calculateCompleteness, getTemplate } from "./template-service.js";

async function enrichArtifact(projectId, artifact, ownerId) {
  const template = await getTemplate(artifact.templateId, artifact.templateVersion);
  const [provenance, findings] = await Promise.all([
    getProvenance(artifact.id),
    projectId ? listFindings(projectId, artifact.id, ownerId) : [],
  ]);
  const completeness = template
    ? calculateCompleteness(template, artifact.fieldValues)
    : { completed: 0, total: 0, percentage: 0, missingFieldIds: [] };

  return {
    ...artifact,
    completeness,
    provenance: Object.fromEntries(
      (provenance || []).map((item) => [item.fieldId, item]),
    ),
    openFindings: (findings || []).filter((item) => item.status === "open"),
  };
}

async function enrichProject(project, ownerId) {
  return {
    ...project,
    artifacts: await Promise.all(
      project.artifacts.map((artifact) =>
        enrichArtifact(project.id, artifact, ownerId),
      ),
    ),
  };
}

function contextCompleteness(items) {
  const requiredKeys = [
    "project-name",
    "objective",
    "sponsor",
    "scope",
    "stakeholders",
    "constraints",
    "success-metrics",
  ];
  const confirmed = new Set(
    items
      .filter((item) => item.trustState === "confirmed")
      .map((item) => item.key),
  );
  const completed = requiredKeys.filter((key) => confirmed.has(key)).length;
  return {
    completed,
    total: requiredKeys.length,
    percentage: Math.round((completed / requiredKeys.length) * 100),
    missingKeys: requiredKeys.filter((key) => !confirmed.has(key)),
  };
}

async function buildProjectRecommendations(project, ownerId) {
  const context = (await listContextItems(project.id, ownerId)) || [];
  const enriched = await enrichProject(project, ownerId);
  const charter = enriched.artifacts.find(
    (artifact) => artifact.templateId === "project-charter",
  );
  const blockingFinding = charter?.openFindings.find(
    (finding) => finding.severity === "blocking",
  );

  if (blockingFinding) {
    return {
      type: "blocking-finding",
      title: blockingFinding.message,
      action: "Resolve next issue",
      href: `/projects/${project.id}/artifacts/${charter.id}/review`,
    };
  }

  if (charter?.completeness.missingFieldIds.length) {
    return {
      type: "missing-charter-content",
      title: "Complete the next required Project Charter section",
      action: "Continue drafting",
      href: `/projects/${project.id}/artifacts/${charter.id}`,
    };
  }

  const proposed = context.find((item) => item.trustState === "proposed");
  if (proposed || contextCompleteness(context).missingKeys.length) {
    return {
      type: "context-review",
      title: proposed
        ? `Confirm ${proposed.label}`
        : "Complete reusable project context",
      action: "Review context",
      href: `/projects/${project.id}/context`,
    };
  }

  if (charter && charter.status !== "approved") {
    return {
      type: "resume-charter",
      title: "Resume the Project Charter",
      action: "Open charter",
      href: `/projects/${project.id}/artifacts/${charter.id}`,
    };
  }

  if (!charter) {
    return {
      type: "start-charter",
      title: "Start the Project Charter",
      action: "Create charter",
      href: `/projects/${project.id}/artifacts/new/project-charter`,
    };
  }

  return {
    type: "next-template",
    title: "Add a Stakeholder Register",
    action: "Browse library",
    href: `/projects/${project.id}/library`,
  };
}

export {
  buildProjectRecommendations,
  contextCompleteness,
  enrichArtifact,
  enrichProject,
};
