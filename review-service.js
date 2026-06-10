import { calculateCompleteness } from "./template-service.js";

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function buildRuleFindings(artifact, template) {
  const completeness = calculateCompleteness(template, artifact.fieldValues);
  const timestamp = new Date().toISOString();

  return completeness.missingFieldIds.map((fieldId) => {
    const field = template.fields.find((item) => item.id === fieldId);
    return {
      id: createId("finding"),
      artifactId: artifact.id,
      fieldId,
      sourceType: "rule",
      severity: "blocking",
      findingType: "required-content-missing",
      message: `${field?.label || fieldId} is required before approval.`,
      status: "open",
      createdAt: timestamp,
      resolvedAt: null,
    };
  });
}

function normalizeAiFindings(artifactId, findings) {
  const timestamp = new Date().toISOString();
  return findings.map((finding) => ({
    id: createId("finding"),
    artifactId,
    fieldId: finding.fieldId || null,
    sourceType: "ai",
    severity: finding.severity,
    findingType: finding.findingType,
    message: finding.message,
    status: "open",
    createdAt: timestamp,
    resolvedAt: null,
  }));
}

export { buildRuleFindings, normalizeAiFindings };
