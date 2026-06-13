import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  ArtifactTurnSchema,
  generateArtifactTurn,
  isTransientAiError,
} from "../ai-service.js";
import {
  renderArtifactDocx,
  renderArtifactMarkdown,
} from "../export-service.js";
import { buildRuleFindings } from "../review-service.js";
import { loadMigrations } from "../migrations.js";
import {
  calculateCompleteness,
  getTemplate,
  listTemplates,
  stageDefinitions,
} from "../template-service.js";
import { readJsonFile, writeJsonFile } from "../storage.js";

const completeCharter = {
  project_overview: "Replace fragmented intake with one governed workflow.",
  objectives: ["Reduce intake cycle time by 30%."],
  scope: {
    inScope: ["Request intake and triage"],
    outOfScope: ["Downstream delivery tooling"],
  },
  stakeholders: [
    {
      role: "Sponsor",
      name: "Jordan Lee",
      responsibility: "Approve scope and funding",
    },
  ],
  risks: [
    {
      description: "Low adoption",
      impact: "Benefits are delayed",
      mitigation: "Pilot with two teams",
      owner: "Change lead",
    },
  ],
  success_criteria: ["80% of requests use the new workflow by launch + 30 days."],
};

describe("Phase 1 domain services", () => {
  it("preserves Charter v1 while making the richer v2 current", async () => {
    const [legacy, current, templates] = await Promise.all([
      getTemplate("project-charter", 1),
      getTemplate("project-charter"),
      listTemplates(),
    ]);

    expect(legacy.version).toBe(1);
    expect(current.version).toBe(2);
    expect(current.fields.map((field) => field.id)).toEqual([
      "project_overview",
      "objectives",
      "scope",
      "stakeholders",
      "risks",
      "success_criteria",
    ]);
    expect(
      templates.some((template) => template.id === "communications-plan"),
    ).toBe(true);
    expect(current).toMatchObject({
      title: "Project Charter",
      role: "PM - Initiation",
      stageKey: "authorize",
      stageName: "Initiation",
      stageOrder: 2,
    });
    expect(templates.find((template) => template.id === "business-case")).toMatchObject({
      title: "Business Case",
      role: "PMO/BA - Pre-Initiation",
    });
  });

  it("assigns every template to one project lifecycle stage", async () => {
    const templates = await listTemplates();
    const stageKeys = new Set(Object.keys(stageDefinitions));

    expect(templates).toHaveLength(16);
    expect(templates.every((template) => stageKeys.has(template.stageKey))).toBe(
      true,
    );
    expect(templates.map((template) => template.stageKey).sort()).toEqual([
      "authorize",
      "authorize",
      "authorize",
      "close",
      "define",
      "design",
      "design",
      "design",
      "execute-control",
      "governance",
      "plan",
      "plan",
      "plan",
      "plan",
      "validate-transition",
      "validate-transition",
    ]);
  });

  it("loads ordered, checksummed forward-only migrations", async () => {
    const migrations = await loadMigrations();

    expect(migrations.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(migrations.map((migration) => migration.checksum)).size).toBe(
      migrations.length,
    );
    expect(
      migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum)),
    ).toBe(true);
  });

  it("calculates required-field completeness from rich values", async () => {
    const template = await getTemplate("project-charter");

    expect(calculateCompleteness(template, completeCharter)).toEqual({
      completed: 6,
      total: 6,
      percentage: 100,
      missingFieldIds: [],
    });

    const incomplete = {
      ...completeCharter,
      scope: { inScope: [], outOfScope: [] },
    };
    expect(calculateCompleteness(template, incomplete).missingFieldIds).toEqual([
      "scope",
    ]);
  });

  it("creates blocking rule findings only for missing required content", async () => {
    const template = await getTemplate("project-charter");
    const findings = buildRuleFindings(
      {
        id: "artifact-1",
        fieldValues: { project_overview: "A clear overview." },
      },
      template,
    );

    expect(findings).toHaveLength(5);
    expect(findings.every((finding) => finding.severity === "blocking")).toBe(
      true,
    );
  });

  it("uses deterministic fake AI output for the next empty section", async () => {
    const template = await getTemplate("project-charter");
    const result = await generateArtifactTurn({
      operation: "interview",
      template,
      projectContext: [],
      artifact: { fieldValues: {} },
      conversation: [],
      userMessage: "Create a single governed intake workflow.",
    });

    expect(result.provider).toBe("fake");
    expect(result.result.fieldUpdates[0]).toMatchObject({
      fieldId: "project_overview",
      value: "Create a single governed intake workflow.",
    });
  });

  it("rejects malformed structured AI output and retries only transient failures", () => {
    expect(() =>
      ArtifactTurnSchema.parse({
        assistantMessage: "Incomplete result",
        fieldUpdates: [{ fieldId: "scope", value: { unexpected: true } }],
      }),
    ).toThrow();

    expect(isTransientAiError({ status: 429 })).toBe(true);
    expect(isTransientAiError({ status: 503 })).toBe(true);
    expect(isTransientAiError({ status: 400 })).toBe(false);
    expect(isTransientAiError({ code: "AI_INVALID_OUTPUT" })).toBe(false);
  });

  it("keeps Markdown and DOCX exports aligned to the selected snapshot", async () => {
    const template = await getTemplate("project-charter");
    const input = {
      artifact: {
        title: "Delivery Charter",
        fieldValues: completeCharter,
      },
      project: { name: "Northstar" },
      template,
      version: { versionNumber: 3 },
    };

    const markdown = renderArtifactMarkdown(input);
    const docx = await renderArtifactDocx(input);

    expect(markdown).toContain("Status: Approved version 3");
    expect(markdown).toContain("## Success Criteria");
    expect(markdown).toContain(completeCharter.success_criteria[0]);
    expect(Buffer.isBuffer(docx)).toBe(true);
    expect(docx.subarray(0, 2).toString()).toBe("PK");
    expect(docx.byteLength).toBeGreaterThan(1_000);
  });

  it("serializes local JSON writes so concurrent saves do not corrupt runtime files", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "artifacthub-storage-"));
    const filePath = path.join(tempDir, "usage-events.json");
    const first = [{ id: "one", eventName: "first" }];
    const second = [{ id: "two", eventName: "second" }];
    const third = [{ id: "three", eventName: "third" }];

    await Promise.all([
      writeJsonFile(filePath, first),
      writeJsonFile(filePath, second),
      writeJsonFile(filePath, third),
    ]);

    const stored = await readJsonFile(filePath, []);
    expect([first, second, third]).toContainEqual(stored);
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
