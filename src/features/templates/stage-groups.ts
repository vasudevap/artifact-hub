import type { Template } from "../../types";

export type TemplateStageGroup = {
  key: string;
  name: string;
  order: number;
  useWhen: string;
  templates: Template[];
};

const workflowSequenceByTemplateId: Record<string, number> = {
  "business-case": 10,
  "project-charter": 20,
  "stakeholder-register": 30,
  "architecture-vision": 40,
  "integrated-project-plan": 50,
  "scope-statement": 60,
  "requirements-package": 70,
  "communications-plan": 80,
  "architecture-requirements": 90,
  "solution-architecture": 100,
  "requirements-traceability": 110,
  "raid-log": 120,
  "change-decision-log": 130,
  "test-acceptance-plan": 140,
  "transition-migration-plan": 150,
  "closure-lessons-learned": 160,
};

export function sortTemplatesForWorkflow(templates: Template[]): Template[] {
  return [...templates].sort((left, right) => {
    const leftSequence = workflowSequenceByTemplateId[left.id] ?? Number.MAX_SAFE_INTEGER;
    const rightSequence =
      workflowSequenceByTemplateId[right.id] ?? Number.MAX_SAFE_INTEGER;

    return (
      left.stageOrder - right.stageOrder ||
      leftSequence - rightSequence ||
      left.title.localeCompare(right.title)
    );
  });
}

export function buildTemplateStageGroups(
  templates: Template[],
): TemplateStageGroup[] {
  const orderedTemplates = sortTemplatesForWorkflow(templates);

  return Array.from(
    orderedTemplates
      .reduce((groups, template) => {
        const existing = groups.get(template.stageKey);
        const group =
          existing ||
          {
            key: template.stageKey,
            name: template.stageName,
            order: template.stageOrder,
            useWhen: template.stageUseWhen,
            templates: [],
          };
        group.templates.push(template);
        groups.set(template.stageKey, group);
        return groups;
      }, new Map<string, TemplateStageGroup>())
      .values(),
  ).sort((left, right) => left.order - right.order);
}
