import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  DATA_DIR,
  PASSWORD_RESETS_FILE,
  PROJECTS_FILE,
  SESSIONS_FILE,
  USERS_FILE,
} from "../storage.js";

const DEMO_EMAIL = "demo@artifacthub.local";
const DEMO_PASSWORD = "DemoPass123!";
const DEMO_NAME = "ArtifactHub Demo";
const ADMIN_EMAIL = "admin@artifacthub.local";
const ADMIN_PASSWORD = "AdminPass123!";
const ADMIN_NAME = "ArtifactHub Admin";

if (process.env.DATABASE_URL) {
  console.error(
    "seed:demo only supports the local JSON fallback. Unset DATABASE_URL before running it.",
  );
  process.exit(1);
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function createUser({ name, email, password }) {
  const timestamp = new Date().toISOString();
  return {
    id: createId("user"),
    name,
    email,
    passwordHash: hashPassword(password),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createArtifact(templateId, title, fieldValues) {
  const timestamp = new Date().toISOString();
  return {
    id: createId("artifact"),
    templateId,
    title,
    status: "draft",
    fieldValues,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createProject(ownerId, { name, sponsor, objective, artifacts }) {
  const timestamp = new Date().toISOString();
  return {
    id: createId("project"),
    ownerId,
    name,
    sponsor,
    objective,
    status: "active",
    artifacts,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function run() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const demoUser = createUser({
    name: DEMO_NAME,
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  const adminUser = createUser({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });

  const projects = [
    createProject(demoUser.id, {
      name: "Customer Onboarding Modernization",
      sponsor: "Maya Chen, VP Customer Experience",
      objective:
        "Reduce onboarding completion time by simplifying intake, approvals, and handoff coordination.",
      artifacts: [
        createArtifact("project-charter", "Project Charter", {
          project_name: "Customer Onboarding Modernization",
          objective:
            "Cut average onboarding time from 12 days to 5 days for mid-market customers by the end of Q4.",
          high_level_scope:
            "In scope: intake workflow redesign, approval routing, customer checklist visibility, and handoff reporting. Out of scope: CRM replacement and billing policy changes.",
          sponsor: "Maya Chen",
          success_criteria:
            "Onboarding cycle time reduced by 58 percent, manual status updates reduced by 70 percent, and CSAT improves by at least 10 points.",
        }),
        createArtifact(
          "stakeholder-register",
          "Stakeholder Register and Engagement Plan",
          {
            stakeholder_groups:
              "Customer Success leadership, Sales Operations, Implementation Managers, InfoSec, and Support.",
            needs_and_concerns:
              "Leadership needs visibility, implementation managers need less rework, and InfoSec needs earlier control reviews.",
            influence_and_impact:
              "Sales Ops and Customer Success leadership have high influence; implementation managers experience the highest day-to-day impact.",
            engagement_strategy:
              "Weekly working session, biweekly steering review, and decision log updates after every scope or policy change.",
            cadence:
              "Working team meets Tuesdays, steering committee meets every second Thursday, and stakeholder digest goes out each Friday.",
          },
        ),
        createArtifact("requirements-package", "Requirements Package", {
          business_requirements:
            "Provide a single onboarding workspace, automate intake completeness checks, and reduce hidden handoffs.",
          stakeholder_requirements:
            "Implementation managers need editable task owners, customers need milestone transparency, and leaders need status reporting.",
          functional_requirements:
            "Workflow must support request intake, approval routing, artifact storage, comment history, and exportable summaries.",
          non_functional_requirements:
            "Application must support audit history, role-based access, 99.5 percent monthly availability, and page loads under two seconds for standard workflows.",
          business_rules:
            "Only approved requests can move into delivery, sensitive customer data must not be stored in free-text notes, and escalations must be acknowledged within one business day.",
        }),
        createArtifact("raid-log", "RAID Log", {
          risks:
            "Approval routing may expand scope if sales exception handling is included. Reporting data quality depends on CRM owner alignment.",
          assumptions:
            "Customer Success leadership will provide a dedicated product owner and existing intake forms remain available during transition.",
          issues:
            "The current implementation checklist is maintained in two different spreadsheets with inconsistent field names.",
          dependencies:
            "CRM admin support, SSO configuration, and UX review capacity are required before pilot launch.",
          next_actions:
            "Finalize intake fields, confirm pilot customer cohort, and align on steering committee decision thresholds.",
        }),
      ],
    }),
    createProject(demoUser.id, {
      name: "Field Service Scheduling Refresh",
      sponsor: "Daniel Brooks, Director of Operations",
      objective:
        "Improve technician utilization and reduce last-minute rescheduling for regional service visits.",
      artifacts: [
        createArtifact("business-case", "Business Case", {
          initiative_name: "Field Service Scheduling Refresh",
          business_problem:
            "Dispatch teams rely on manual spreadsheet balancing, creating avoidable overtime and missed customer windows.",
          expected_value:
            "Increase technician utilization, reduce overtime spend, and improve first-visit success through better scheduling logic.",
          options_considered:
            "Optimize the existing spreadsheet model, purchase a new scheduling platform, or extend the current operations tool with improved dispatch workflows.",
          investment_summary:
            "Sixteen-week delivery effort with shared product, operations, and engineering capacity. Budget focus is workflow delivery rather than platform replacement.",
        }),
        createArtifact("integrated-project-plan", "Integrated Project Plan", {
          delivery_approach:
            "Discovery and process mapping in phase one, workflow configuration in phase two, and one-region pilot before broader rollout.",
          major_milestones:
            "Process baseline complete by July 12, pilot ready by August 30, and regional rollout recommendation by September 20.",
          governance_model:
            "Operations director sponsors the initiative, with weekly delivery reviews and monthly steering checkpoints.",
          controls_and_baselines:
            "Scope baseline locked after pilot definition, weekly risk review, and change log required for all dispatch rule updates.",
          delivery_team:
            "Operations product owner, dispatch supervisor, engineering lead, analytics partner, and field technician advisor group.",
        }),
      ],
    }),
  ];

  await Promise.all([
    writeJson(USERS_FILE, [demoUser, adminUser]),
    writeJson(SESSIONS_FILE, []),
    writeJson(PROJECTS_FILE, projects),
    writeJson(PASSWORD_RESETS_FILE, []),
  ]);

  console.log("ArtifactHub demo data written to local JSON storage.");
  console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log("Start the app with: npm start");
}

run().catch((error) => {
  console.error("Failed to seed local demo data.");
  console.error(error);
  process.exit(1);
});
