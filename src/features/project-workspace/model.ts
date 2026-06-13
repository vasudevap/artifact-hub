import type { Artifact, Recommendation, Template } from "../../types";
import {
  buildTemplateStageGroups,
  type TemplateStageGroup,
} from "../templates/stage-groups";

export type WorkspaceTemplateState =
  | "not-started"
  | "draft"
  | "review"
  | "approved";

export type WorkspaceStageState =
  | "not-started"
  | "active"
  | "attention"
  | "complete";

export type WorkspaceTemplateEntry = {
  template: Template;
  artifacts: Artifact[];
  latestArtifact: Artifact | null;
  state: WorkspaceTemplateState;
  actionType: "start" | "open";
  actionLabel: string;
  href: string;
  isRecommended: boolean;
};

export type WorkspaceStage = Omit<TemplateStageGroup, "templates"> & {
  state: WorkspaceStageState;
  totalTemplates: number;
  startedTemplates: number;
  approvedTemplates: number;
  attentionTemplates: number;
  nextTemplateTitle: string | null;
  isRecommended: boolean;
  templates: WorkspaceTemplateEntry[];
};

function byMostRecentlyUpdated(left: Artifact, right: Artifact) {
  return (
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

function getLatestArtifact(artifacts: Artifact[]) {
  return [...artifacts].sort(byMostRecentlyUpdated)[0] || null;
}

function getTemplateState(
  latestArtifact: Artifact | null,
): WorkspaceTemplateState {
  if (!latestArtifact) return "not-started";
  if (latestArtifact.status === "approved") return "approved";
  if (latestArtifact.openFindings.length) return "review";
  return "draft";
}

function buildTemplateHref(projectId: string, entry: WorkspaceTemplateEntry) {
  if (!entry.latestArtifact) {
    return `/projects/${projectId}/artifacts/new/${entry.template.id}`;
  }
  if (entry.state === "review") {
    return `/projects/${projectId}/artifacts/${entry.latestArtifact.id}/review`;
  }
  return `/projects/${projectId}/artifacts/${entry.latestArtifact.id}`;
}

function buildTemplateActionLabel(
  latestArtifact: Artifact | null,
  state: WorkspaceTemplateState,
) {
  if (!latestArtifact) return "Start draft";
  if (state === "approved") return "View approved";
  if (state === "review") return "Continue review";
  return "Continue drafting";
}

function isRecommendedTemplate(
  projectId: string,
  template: Template,
  latestArtifact: Artifact | null,
  recommendation?: Recommendation,
) {
  if (!recommendation) return false;
  if (recommendation.href === `/projects/${projectId}/artifacts/new/${template.id}`) {
    return true;
  }
  return Boolean(
    latestArtifact &&
      recommendation.href === `/projects/${projectId}/artifacts/${latestArtifact.id}`,
  );
}

function buildWorkspaceTemplateEntry(
  projectId: string,
  template: Template,
  artifacts: Artifact[],
  recommendation?: Recommendation,
): WorkspaceTemplateEntry {
  const latestArtifact = getLatestArtifact(artifacts);
  const state = getTemplateState(latestArtifact);
  const entry: WorkspaceTemplateEntry = {
    template,
    artifacts: [...artifacts].sort(byMostRecentlyUpdated),
    latestArtifact,
    state,
    actionType: latestArtifact ? "open" : "start",
    actionLabel: buildTemplateActionLabel(latestArtifact, state),
    href: "",
    isRecommended: isRecommendedTemplate(
      projectId,
      template,
      latestArtifact,
      recommendation,
    ),
  };
  entry.href = buildTemplateHref(projectId, entry);
  return entry;
}

function buildStageState(stage: {
  totalTemplates: number;
  startedTemplates: number;
  approvedTemplates: number;
  attentionTemplates: number;
}): WorkspaceStageState {
  if (stage.totalTemplates > 0 && stage.approvedTemplates === stage.totalTemplates) {
    return "complete";
  }
  if (stage.attentionTemplates > 0) return "attention";
  if (stage.startedTemplates > 0) return "active";
  return "not-started";
}

export function buildProjectWorkspaceStages(
  projectId: string,
  templates: Template[],
  artifacts: Artifact[],
  recommendation?: Recommendation,
): WorkspaceStage[] {
  const artifactsByTemplate = artifacts.reduce((index, artifact) => {
    const items = index.get(artifact.templateId) || [];
    items.push(artifact);
    index.set(artifact.templateId, items);
    return index;
  }, new Map<string, Artifact[]>());

  return buildTemplateStageGroups(templates).map((stage) => {
    const entries = stage.templates.map((template) =>
      buildWorkspaceTemplateEntry(
        projectId,
        template,
        artifactsByTemplate.get(template.id) || [],
        recommendation,
      ),
    );

    const startedTemplates = entries.filter((entry) => entry.latestArtifact).length;
    const approvedTemplates = entries.filter((entry) => entry.state === "approved").length;
    const attentionTemplates = entries.filter((entry) => entry.state === "review").length;
    const nextTemplate =
      entries.find((entry) => entry.isRecommended) ||
      entries.find((entry) => entry.state !== "approved") ||
      null;

    return {
      ...stage,
      templates: entries,
      totalTemplates: entries.length,
      startedTemplates,
      approvedTemplates,
      attentionTemplates,
      nextTemplateTitle: nextTemplate?.template.title || null,
      isRecommended: entries.some((entry) => entry.isRecommended),
      state: buildStageState({
        totalTemplates: entries.length,
        startedTemplates,
        approvedTemplates,
        attentionTemplates,
      }),
    };
  });
}

export function getDefaultExpandedWorkspaceStage(stages: WorkspaceStage[]) {
  return (
    stages.find((stage) => stage.isRecommended)?.key ||
    stages.find((stage) => stage.state !== "complete")?.key ||
    stages[0]?.key ||
    null
  );
}
