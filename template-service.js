import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_PATH = path.join(__dirname, "data", "templates.json");

const categoryByTemplate = {
  "business-case": "Project Initiation",
  "project-charter": "Project Initiation",
  "stakeholder-register": "Stakeholder Management",
  "integrated-project-plan": "Planning",
  "scope-statement": "Planning",
  "requirements-package": "Requirements",
  "requirements-traceability": "Requirements",
  "raid-log": "Delivery and Tracking",
  "change-decision-log": "Governance",
  "architecture-vision": "Architecture",
  "architecture-requirements": "Architecture",
  "solution-architecture": "Architecture",
  "transition-migration-plan": "Delivery and Tracking",
  "test-acceptance-plan": "Validation",
  "closure-lessons-learned": "Closure",
  "communications-plan": "Stakeholder Management",
};

const roleByTemplate = {
  "business-case": "PMO/BA - Pre-Initiation",
  "project-charter": "PM - Initiation",
  "stakeholder-register": "PM/BA - Initiation",
  "integrated-project-plan": "PMO - Planning",
  "scope-statement": "PM/BA - Planning",
  "requirements-package": "BA - Elicitation and Analysis",
  "requirements-traceability": "BA/PM - Control",
  "raid-log": "PM - Delivery Control",
  "change-decision-log": "PMO - Governance",
  "architecture-vision": "Architecture - Initiation",
  "architecture-requirements": "Architecture/BA - Planning",
  "solution-architecture": "Architecture - Design",
  "transition-migration-plan": "PM/Architecture - Delivery",
  "test-acceptance-plan": "BA/QA/PM - Validation",
  "closure-lessons-learned": "PMO - Closeout",
  "communications-plan": "PM - Communications Planning",
};

const stageDefinitions = {
  define: {
    stageKey: "define",
    stageName: "Definition",
    stageOrder: 1,
    stageUseWhen:
      "Justify the work and shape the initial project idea before authorization.",
  },
  authorize: {
    stageKey: "authorize",
    stageName: "Initiation",
    stageOrder: 2,
    stageUseWhen: "Formally start the project and identify who matters.",
  },
  plan: {
    stageKey: "plan",
    stageName: "Planning",
    stageOrder: 3,
    stageUseWhen:
      "Establish scope, delivery approach, requirements, governance, and communications.",
  },
  design: {
    stageKey: "design",
    stageName: "Design",
    stageOrder: 4,
    stageUseWhen:
      "Translate requirements and architecture concerns into solution direction.",
  },
  "execute-control": {
    stageKey: "execute-control",
    stageName: "Execution Control",
    stageOrder: 5,
    stageUseWhen:
      "Manage active delivery movement, risks, issues, assumptions, and dependencies.",
  },
  governance: {
    stageKey: "governance",
    stageName: "Governance",
    stageOrder: 6,
    stageUseWhen:
      "Record decisions, manage change control, and preserve delivery accountability.",
  },
  "validate-transition": {
    stageKey: "validate-transition",
    stageName: "Validate And Transition",
    stageOrder: 7,
    stageUseWhen: "Prove readiness, acceptance, rollout, and operational transition.",
  },
  close: {
    stageKey: "close",
    stageName: "Closeout",
    stageOrder: 8,
    stageUseWhen: "Finish formally and preserve reusable learning.",
  },
};

const stageByTemplate = {
  "business-case": "define",
  "project-charter": "authorize",
  "stakeholder-register": "authorize",
  "architecture-vision": "authorize",
  "integrated-project-plan": "plan",
  "scope-statement": "plan",
  "requirements-package": "plan",
  "communications-plan": "plan",
  "architecture-requirements": "design",
  "solution-architecture": "design",
  "requirements-traceability": "design",
  "raid-log": "execute-control",
  "change-decision-log": "governance",
  "test-acceptance-plan": "validate-transition",
  "transition-migration-plan": "validate-transition",
  "closure-lessons-learned": "close",
};

const sourceByTemplate = {
  "business-case": {
    sourceStandard: "PMI / IIBA",
    sourceName: "Business case and strategy analysis practices",
  },
  "project-charter": {
    sourceStandard: "PMI",
    sourceName: "Project charter",
  },
  "stakeholder-register": {
    sourceStandard: "PMI / IIBA",
    sourceName: "Stakeholder register and engagement planning",
  },
  "integrated-project-plan": {
    sourceStandard: "PMI",
    sourceName: "Integrated project planning",
  },
  "scope-statement": {
    sourceStandard: "PMI / IIBA",
    sourceName: "Scope statement and deliverables baseline",
  },
  "requirements-package": {
    sourceStandard: "IIBA",
    sourceName: "Requirements analysis and design definition",
  },
  "requirements-traceability": {
    sourceStandard: "PMI / IIBA",
    sourceName: "Requirements traceability",
  },
  "raid-log": {
    sourceStandard: "PMI",
    sourceName: "Risk, assumption, issue, and dependency tracking",
  },
  "change-decision-log": {
    sourceStandard: "PMI",
    sourceName: "Change control and decision governance",
  },
  "architecture-vision": {
    sourceStandard: "TOGAF",
    sourceName: "Architecture Vision",
  },
  "architecture-requirements": {
    sourceStandard: "TOGAF",
    sourceName: "Architecture Requirements Specification",
  },
  "solution-architecture": {
    sourceStandard: "TOGAF",
    sourceName: "Solution architecture definition",
  },
  "transition-migration-plan": {
    sourceStandard: "TOGAF / PMI",
    sourceName: "Transition and migration planning",
  },
  "test-acceptance-plan": {
    sourceStandard: "PMI / IIBA",
    sourceName: "Validation and acceptance planning",
  },
  "closure-lessons-learned": {
    sourceStandard: "PMI",
    sourceName: "Project closure and lessons learned",
  },
  "communications-plan": {
    sourceStandard: "PMI",
    sourceName: "Communications management planning",
  },
};

function splitTemplateTitle(rawTitle = "") {
  const title = String(rawTitle).trim();
  const match = title.match(/^(.*?)\s+\(([^)]+)\)$/);

  if (!match) {
    return { title, role: "" };
  }

  return {
    title: match[1].trim(),
    role: match[2].trim(),
  };
}

function normalizeTemplate(id, template) {
  const normalizedFields = (template.fields || []).map((field) => ({
    ...field,
    required: field.required ?? true,
  }));
  const source = sourceByTemplate[id] || {
    sourceStandard: "Standardized practice",
    sourceName: "ArtifactHub template catalog",
  };
  const stageKey = template.stageKey || stageByTemplate[id] || "plan";
  const stage = {
    ...(stageDefinitions[stageKey] || stageDefinitions.plan),
    ...(template.stageName ? { stageName: template.stageName } : {}),
    ...(template.stageOrder ? { stageOrder: template.stageOrder } : {}),
    ...(template.stageUseWhen ? { stageUseWhen: template.stageUseWhen } : {}),
  };
  const titleParts = splitTemplateTitle(template.title);

  return {
    id,
    version: template.version || 1,
    title: titleParts.title,
    role: template.role || roleByTemplate[id] || titleParts.role,
    description: template.description,
    category: template.category || categoryByTemplate[id] || "Other",
    lifecycleStage: template.lifecycleStage || "Delivery",
    aiEnabled: Boolean(template.aiEnabled),
    recommended: Boolean(template.recommended),
    recommendationMetadata: template.recommendationMetadata || {},
    stageKey: stage.stageKey,
    stageName: stage.stageName,
    stageOrder: stage.stageOrder,
    stageUseWhen: stage.stageUseWhen,
    sourceStandard: template.sourceStandard || source.sourceStandard,
    sourceName: template.sourceName || source.sourceName,
    sourceUrl: template.sourceUrl || "",
    sourceNotes:
      template.sourceNotes ||
      "Template structure is based on common project delivery practice and should be adapted to the user's context.",
    fields: normalizedFields,
  };
}

async function readTemplateCatalog() {
  const content = await fs.readFile(TEMPLATE_PATH, "utf-8");
  const templates = JSON.parse(content);
  const catalog = Object.fromEntries(
    Object.entries(templates).map(([id, template]) => [
      id,
      normalizeTemplate(id, template),
    ]),
  );

  return catalog;
}

async function listTemplates() {
  return Object.values(await readTemplateCatalog());
}

async function getTemplate(templateId, version) {
  const raw = JSON.parse(await fs.readFile(TEMPLATE_PATH, "utf-8"));
  const rawTemplate = raw[templateId];

  if (!rawTemplate) {
    return null;
  }

  const template = normalizeTemplate(templateId, rawTemplate);
  const requestedVersion = Number(version);

  if (
    Number.isInteger(requestedVersion) &&
    requestedVersion !== template.version
  ) {
    const historical = rawTemplate.versions?.[String(requestedVersion)];
    return historical ? normalizeTemplate(templateId, historical) : null;
  }

  return template;
}

function hasValue(value) {
  if (Array.isArray(value)) {
    return value.some((item) =>
      typeof item === "object"
        ? Object.values(item).some(hasValue)
        : String(item || "").trim(),
    );
  }

  if (value && typeof value === "object") {
    return Object.values(value).some(hasValue);
  }

  return String(value || "").trim().length > 0;
}

function calculateCompleteness(template, fieldValues = {}) {
  const requiredFields = template.fields.filter((field) => field.required);
  const completed = requiredFields.filter((field) =>
    hasValue(fieldValues[field.id]),
  ).length;

  return {
    completed,
    total: requiredFields.length,
    percentage:
      requiredFields.length === 0
        ? 100
        : Math.round((completed / requiredFields.length) * 100),
    missingFieldIds: requiredFields
      .filter((field) => !hasValue(fieldValues[field.id]))
      .map((field) => field.id),
  };
}

export {
  calculateCompleteness,
  getTemplate,
  hasValue,
  listTemplates,
  readTemplateCatalog,
  stageDefinitions,
};
