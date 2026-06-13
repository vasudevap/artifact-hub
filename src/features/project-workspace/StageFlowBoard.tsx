import { formatDateTime } from "../../api";
import type { Template } from "../../types";
import type { WorkspaceStage, WorkspaceTemplateEntry } from "./model";
import { Link } from "react-router-dom";

type StageFlowBoardProps = {
  expandedStageKey: string | null;
  onStartTemplate: (template: Template) => void;
  onToggleStage: (stageKey: string) => void;
  stages: WorkspaceStage[];
  startingTemplateId: string | null;
};

function getStageStatusLabel(stage: WorkspaceStage) {
  switch (stage.state) {
    case "complete":
      return "Complete";
    case "attention":
      return "Needs attention";
    case "active":
      return "In progress";
    default:
      return "Ready";
  }
}

function getTemplateStatusLabel(template: WorkspaceTemplateEntry) {
  switch (template.state) {
    case "approved":
      return "Approved";
    case "review":
      return "Needs review";
    case "draft":
      return "Draft";
    default:
      return "Not started";
  }
}

function getTemplateMeta(template: WorkspaceTemplateEntry) {
  const source =
    template.template.sourceStandard ||
    template.template.sourceName ||
    template.template.category;
  const fieldCountLabel = `${template.template.fields.length} structured section${
    template.template.fields.length === 1 ? "" : "s"
  }`;

  if (!template.latestArtifact) {
    return `${fieldCountLabel} · ${source}`;
  }

  const artifactCountLabel =
    template.artifacts.length > 1
      ? `${template.artifacts.length} artifacts · `
      : "";

  return `${artifactCountLabel}Updated ${formatDateTime(template.latestArtifact.updatedAt)}`;
}

function getTemplateSequenceCue(
  stage: WorkspaceStage,
  template: WorkspaceTemplateEntry,
) {
  if (template.state === "approved") return null;

  const remainingTemplates = stage.templates.filter(
    (entry) => entry.state !== "approved",
  );
  const remainingIndex = remainingTemplates.findIndex(
    (entry) => entry.template.id === template.template.id,
  );

  if (remainingIndex === 0) {
    return stage.startedTemplates > 0 ? "Current" : "Start here";
  }
  if (remainingIndex === 1) return "Next";
  return "Later";
}

export function StageFlowBoard({
  expandedStageKey,
  onStartTemplate,
  onToggleStage,
  stages,
  startingTemplateId,
}: StageFlowBoardProps) {
  return (
    <div className="stage-flow-grid">
      {stages.map((stage) => {
        const expanded = stage.key === expandedStageKey;

        return (
          <article
            className={`stage-flow-card stage-flow-card--${stage.state} ${
              expanded ? "is-expanded" : ""
            }`}
            key={stage.key}
          >
            <button
              aria-expanded={expanded}
              className="stage-flow-card-toggle"
              type="button"
              onClick={() => onToggleStage(stage.key)}
            >
              <div className="stage-flow-card-topline">
                <span className="eyebrow">
                  {stage.order}. {stage.name}
                </span>
                <span className={`stage-flow-state stage-flow-state--${stage.state}`}>
                  {getStageStatusLabel(stage)}
                </span>
              </div>
              <h3>{stage.name}</h3>
              <p>{stage.useWhen}</p>
              <div className="stage-flow-card-metrics" aria-label={`${stage.name} progress`}>
                <span>{stage.totalTemplates} templates</span>
                <span>{stage.startedTemplates} started</span>
                <span>{stage.approvedTemplates} approved</span>
                {stage.attentionTemplates > 0 && (
                  <span>{stage.attentionTemplates} need review</span>
                )}
              </div>
              <div className="stage-flow-card-next">
                <div className="stage-flow-card-action">
                  <strong>{expanded ? "Hide stage templates" : "View stage templates"}</strong>
                  <span aria-hidden="true" className="stage-flow-card-action-icon">
                    {expanded ? "↑" : "→"}
                  </span>
                </div>
                <span className="stage-flow-card-next-detail">
                  {stage.nextTemplateTitle
                    ? `Next: ${stage.nextTemplateTitle}`
                    : "Everything in this stage is complete."}
                </span>
              </div>
            </button>
            {expanded && (
              <div className="stage-flow-card-body">
                {stage.templates.map((template) => {
                  const startPending = startingTemplateId === template.template.id;
                  const sequenceCue = getTemplateSequenceCue(stage, template);

                  return (
                    <div className="stage-flow-template-row" key={template.template.id}>
                      <div className="stage-flow-template-copy">
                        <div className="stage-flow-template-heading">
                          <h4>{template.template.title}</h4>
                          <div className="stage-flow-template-badges">
                            {sequenceCue && (
                              <span className="stage-flow-status stage-flow-status--sequence">
                                {sequenceCue}
                              </span>
                            )}
                            <span
                              className={`stage-flow-status stage-flow-status--${template.state}`}
                            >
                              {getTemplateStatusLabel(template)}
                            </span>
                            {template.isRecommended && (
                              <span className="stage-flow-status stage-flow-status--recommended">
                                Recommended
                              </span>
                            )}
                          </div>
                        </div>
                        <p>{template.template.description}</p>
                        <small>{getTemplateMeta(template)}</small>
                      </div>
                      <div className="stage-flow-template-actions">
                        {template.actionType === "start" ? (
                          <button
                            className="primary-button"
                            disabled={startPending}
                            type="button"
                            onClick={() => onStartTemplate(template.template)}
                          >
                            {startPending ? "Starting..." : template.actionLabel}
                          </button>
                        ) : (
                          <Link
                            className={
                              template.state === "approved"
                                ? "secondary-button"
                                : "primary-button"
                            }
                            to={template.href}
                          >
                            {template.actionLabel}
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
