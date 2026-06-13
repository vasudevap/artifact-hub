import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { FeatureAvailability, Project, User } from "./types";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const defaultFeatures: FeatureAvailability = {
  aiAssistant: true,
  reviewWorkflow: true,
  docxExport: true,
};

const demoUser: User = {
  id: "user-1",
  name: "Morgan North",
  email: "morgan@example.com",
  isAdmin: false,
  createdAt: "2026-06-12T22:00:00.000Z",
};

function buildProject(
  id: string,
  name: string,
  sponsor: string,
  artifactPercentages: number[],
): Project {
  return {
    id,
    ownerId: "user-1",
    name,
    sponsor,
    objective: `${name} objective`,
    status: "active",
    artifacts: artifactPercentages.map((percentage, index) => ({
      id: `${id}-artifact-${index + 1}`,
      ownerId: "user-1",
      projectId: id,
      projectName: name,
      templateVersionId: null,
      templateId: "project-charter",
      title: index === 0 ? "Project Charter" : `Artifact ${index + 1}`,
      status: "draft",
      fieldValues: {},
      revision: 1,
      templateVersion: 2,
      workflowStage: "drafting",
      completeness: {
        completed: 1,
        total: 6,
        percentage,
        missingFieldIds: [],
      },
      provenance: {},
      openFindings: [],
      createdAt: "2026-06-12T22:00:00.000Z",
      updatedAt: "2026-06-12T22:10:00.000Z",
    })),
    createdAt: "2026-06-12T22:00:00.000Z",
    updatedAt: "2026-06-12T22:10:00.000Z",
  };
}

function renderApp(initialEntry = "/projects") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("React application shell", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("retains the Active Demo disclosure on the authentication route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Authentication required." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    renderApp("/auth");

    expect(await screen.findByText("Active Demo")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sign in to ArtifactHub" }),
    ).toBeInTheDocument();
  });

  it("separates the current project block from other workspace projects in the sidebar", async () => {
    const selectedProject = buildProject(
      "project-1",
      "Regional Vendor Onboarding Refresh - ART-20",
      "Maya Chen, VP Operations",
      [0],
    );
    const otherProjectOne = buildProject(
      "project-2",
      "blake's coding",
      "prashant",
      [0],
    );
    const otherProjectTwo = buildProject(
      "project-3",
      "Vendor Onboarding Refresh",
      "PV",
      [17],
    );
    const projectIndex = [selectedProject, otherProjectOne, otherProjectTwo];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.endsWith("/api/auth/me")) {
          return jsonResponse({ user: demoUser, features: defaultFeatures });
        }
        if (url.endsWith("/api/projects")) {
          return jsonResponse(projectIndex);
        }
        if (url.endsWith("/api/projects/project-1")) {
          return jsonResponse(selectedProject);
        }
        if (url.endsWith("/api/projects/project-1/activity")) {
          return jsonResponse({ activity: [] });
        }
        if (url.endsWith("/api/projects/project-1/recommendation")) {
          return jsonResponse({
            recommendation: {
              type: "resume-charter",
              title: "Resume the Project Charter",
              action: "Open charter",
              href: `/projects/${selectedProject.id}/artifacts/${selectedProject.artifacts[0].id}`,
            },
          });
        }
        if (url.endsWith("/api/projects/project-1/context")) {
          return jsonResponse({
            items: [],
            completeness: {
              percentage: 0,
              completed: 0,
              total: 7,
              missingKeys: [],
            },
          });
        }

        return jsonResponse({ error: `Unhandled request: ${url}` }, 404);
      }),
    );

    renderApp("/projects/project-1");

    const currentProjectLabel = await screen.findByText("Current project");
    const sidebar = currentProjectLabel.closest("aside");
    expect(sidebar).not.toBeNull();
    const sidebarQueries = within(sidebar as HTMLElement);

    expect(sidebarQueries.getByText("Current project")).toBeInTheDocument();
    expect(
      sidebarQueries.getByRole("link", {
        name: /Regional Vendor Onboarding Refresh - ART-20/i,
      }),
    ).toBeInTheDocument();
    expect(sidebarQueries.getByText("Artifacts")).toBeInTheDocument();
    expect(
      sidebarQueries.getByRole("link", { name: /Project Charter/i }),
    ).toBeInTheDocument();

    expect(sidebarQueries.getByText("Other projects")).toBeInTheDocument();
    expect(
      sidebarQueries.getByRole("link", { name: /blake's coding/i }),
    ).toBeInTheDocument();
    expect(
      sidebarQueries.getByRole("link", { name: "Vendor Onboarding RefreshPV17%" }),
    ).toBeInTheDocument();
  });

  it("navigates to project context immediately after create even if the project list refetch fails", async () => {
    const user = userEvent.setup();
    const createdProject = buildProject(
      "project-new",
      "Created Project",
      "Maya Chen",
      [],
    );
    let projectListCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";

        if (url.endsWith("/api/auth/me")) {
          return jsonResponse({ user: demoUser, features: defaultFeatures });
        }
        if (url.endsWith("/api/projects") && method === "GET") {
          projectListCalls += 1;
          if (projectListCalls === 1) {
            return jsonResponse([]);
          }
          return jsonResponse({ error: "Refetch failed." }, 500);
        }
        if (url.endsWith("/api/projects") && method === "POST") {
          return jsonResponse(createdProject, 201);
        }
        if (url.endsWith("/api/projects/project-new")) {
          return jsonResponse(createdProject);
        }
        if (url.endsWith("/api/projects/project-new/context")) {
          return jsonResponse({
            items: [],
            completeness: {
              percentage: 0,
              completed: 0,
              total: 7,
            },
          });
        }

        return jsonResponse({ error: `Unhandled request: ${url}` }, 404);
      }),
    );

    renderApp("/projects");

    await user.click(await screen.findByRole("button", { name: "Create project" }));
    await user.type(screen.getByLabelText("Project name"), "Created Project");
    await user.type(screen.getByLabelText("Sponsor"), "Maya Chen");
    await user.type(screen.getByLabelText("Objective"), "Move straight into context.");
    await user.click(
      screen.getByRole("button", { name: "Create and set up context" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Project Context" }),
    ).toBeInTheDocument();
  });

  it("shows a visible error when project creation fails", async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";

        if (url.endsWith("/api/auth/me")) {
          return jsonResponse({ user: demoUser, features: defaultFeatures });
        }
        if (url.endsWith("/api/projects") && method === "GET") {
          return jsonResponse([]);
        }
        if (url.endsWith("/api/projects") && method === "POST") {
          return jsonResponse({ error: "Failed to create project." }, 500);
        }

        return jsonResponse({ error: `Unhandled request: ${url}` }, 404);
      }),
    );

    renderApp("/projects");

    await user.click(await screen.findByRole("button", { name: "Create project" }));
    await user.type(screen.getByLabelText("Project name"), "Broken Project");
    await user.click(
      screen.getByRole("button", { name: "Create and set up context" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to create project.",
    );
  });

  it("syncs the sidebar project name when Project Context saves a renamed project", async () => {
    const user = userEvent.setup();
    let currentProject = buildProject("project-1", "test 1 proj", "pv", []);
    let contextItems = [
      {
        id: "context-name",
        projectId: "project-1",
        category: "project-basics",
        key: "project-name",
        label: "Project name",
        value: "test 1 proj",
        trustState: "confirmed" as const,
        sourceType: "user",
        createdAt: "2026-06-12T22:00:00.000Z",
        updatedAt: "2026-06-12T22:10:00.000Z",
      },
      {
        id: "context-sponsor",
        projectId: "project-1",
        category: "project-basics",
        key: "sponsor",
        label: "Project sponsor",
        value: "pv",
        trustState: "confirmed" as const,
        sourceType: "user",
        createdAt: "2026-06-12T22:00:00.000Z",
        updatedAt: "2026-06-12T22:10:00.000Z",
      },
      {
        id: "context-objective",
        projectId: "project-1",
        category: "objectives-outcomes",
        key: "objective",
        label: "Primary business objective",
        value: "test 1 proj objective",
        trustState: "confirmed" as const,
        sourceType: "user",
        createdAt: "2026-06-12T22:00:00.000Z",
        updatedAt: "2026-06-12T22:10:00.000Z",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";

        if (url.endsWith("/api/auth/me")) {
          return jsonResponse({ user: demoUser, features: defaultFeatures });
        }
        if (url.endsWith("/api/projects") && method === "GET") {
          return jsonResponse([currentProject]);
        }
        if (url.endsWith("/api/projects/project-1") && method === "GET") {
          return jsonResponse(currentProject);
        }
        if (url.endsWith("/api/projects/project-1/context") && method === "GET") {
          return jsonResponse({
            items: contextItems,
            completeness: {
              percentage: 43,
              completed: 3,
              total: 7,
            },
          });
        }
        if (url.endsWith("/api/projects/project-1/context") && method === "PATCH") {
          const body = JSON.parse(String(init?.body || "{}"));
          contextItems = body.items.map(
            (item: {
              id?: string;
              category: string;
              key: string;
              label: string;
              value: string;
              trustState: "proposed" | "confirmed" | "rejected";
              sourceType: string;
            }) => ({
              id: item.id || `context-${item.key}`,
              projectId: "project-1",
              category: item.category,
              key: item.key,
              label: item.label,
              value: item.value,
              trustState: item.trustState,
              sourceType: item.sourceType,
              createdAt: "2026-06-12T22:00:00.000Z",
              updatedAt: "2026-06-12T22:20:00.000Z",
            }),
          );
          currentProject = {
            ...currentProject,
            name:
              String(
                contextItems.find((item) => item.key === "project-name")?.value ||
                  currentProject.name,
              ) || currentProject.name,
          };
          return jsonResponse({
            items: contextItems,
            completeness: {
              percentage: 43,
              completed: 3,
              total: 7,
            },
          });
        }

        return jsonResponse({ error: `Unhandled request: ${url}` }, 404);
      }),
    );

    renderApp("/projects/project-1/context");

    const projectNameField = await screen.findByDisplayValue("test 1 proj");
    expect(projectNameField).toBeInTheDocument();

    await user.clear(projectNameField);
    await user.type(projectNameField, "test 1 project now");
    await user.click(screen.getByRole("button", { name: "Save context" }));

    const sidebar = screen.getByText("Current project").closest("aside");
    expect(sidebar).not.toBeNull();
    expect(
      await within(sidebar as HTMLElement).findByRole("link", {
        name: /test 1 project now/i,
      }),
    ).toBeInTheDocument();
  });
});
