import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PORT = 3210;
const baseUrl = `http://127.0.0.1:${PORT}`;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

async function waitForServer(processHandle) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Test server exited with code ${processHandle.exitCode}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the browser test server.");
}

async function run() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "artifact-hub-e2e-"));
  await Promise.all([
    writeFile(path.join(dataDir, "users.json"), "[]"),
    writeFile(path.join(dataDir, "sessions.json"), "[]"),
    writeFile(path.join(dataDir, "projects.json"), "[]"),
    writeFile(path.join(dataDir, "password-resets.json"), "[]"),
  ]);

  const server = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(scriptDirectory, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      DATABASE_URL: "",
      NODE_ENV: "test",
      AI_FEATURE_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let browser;

  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().includes("401 (Unauthorized)")
      ) {
        consoleErrors.push(message.text());
      }
    });

    const testEmail = `browser-${Date.now()}@example.com`;

    await page.goto(`${baseUrl}/auth`);
    await page.getByRole("heading", { name: "Sign in to ArtifactHub" }).waitFor();

    await page.goto(baseUrl);
    await page.getByRole("link", { name: "Create account" }).first().click();
    await page.getByRole("heading", { name: "Start with a project" }).waitFor();
    await page.getByLabel("Name", { exact: true }).fill("Browser Test");
    await page.getByLabel("Email", { exact: true }).fill(testEmail);
    await page.getByLabel(/Password/).fill("browser-pass-123");
    await page.getByRole("button", { name: "Create account" }).click();

    const initialGlobalRail = page.getByRole("navigation", {
      name: "Global navigation",
    });
    const aboutRailLink = initialGlobalRail.getByRole("link", {
      name: "About ArtifactHub",
    });
    await page
      .getByRole("heading", {
        name: "Project Intelligence, Not Just Project Documents",
      })
      .waitFor();
    await page
      .getByRole("navigation", { name: "About page sections" })
      .getByRole("link", { name: /Product direction/ })
      .waitFor();
    assert.equal(await aboutRailLink.getAttribute("aria-current"), "page");
    await page
      .getByRole("heading", { name: "ArtifactHub is an active demo" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "artifacthub@grafley.com" })
        .getAttribute("href"),
      "mailto:artifacthub@grafley.com",
    );
    assert.equal(
      await page
        .getByRole("link", { name: "View Prashant Vasudeva on LinkedIn" })
        .getAttribute("href"),
      "https://www.linkedin.com/in/prashant-vasudeva-16513713",
    );
    assert.equal(await page.getByText("Chris Grafley").count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    const aboutDimensions = await page.evaluate(() => {
      const rail = document.querySelector(".global-rail");
      const mobileHeader = document.querySelector(".mobile-header");
      const railLinks = Array.from(
        document.querySelectorAll(".global-rail .rail-link"),
      ).filter((link) => getComputedStyle(link).display !== "none");

      return {
        clientWidth: document.body.clientWidth,
        scrollWidth: document.body.scrollWidth,
        railDisplay: getComputedStyle(rail).display,
        railRect: {
          right: Math.round(rail.getBoundingClientRect().right),
        },
        mobileHeaderDisplay: getComputedStyle(mobileHeader).display,
        profileRect: {
          right: Math.round(
            document.querySelector(".rail-profile").getBoundingClientRect().right,
          ),
        },
        logoutRect: {
          right: Math.round(
            document.querySelector(".rail-logout").getBoundingClientRect().right,
          ),
        },
        railLinkCount: railLinks.length,
        railLinks: railLinks.map((link) => {
          const rect = link.getBoundingClientRect();
          const label = link.querySelector("small");
          const labelRect = label.getBoundingClientRect();
          return {
            height: Math.round(rect.height),
            labelHeight: Math.round(labelRect.height),
            labelWidth: Math.round(labelRect.width),
            text: link.textContent.trim(),
            width: Math.round(rect.width),
          };
        }),
      };
    });
    assert.equal(aboutDimensions.scrollWidth, aboutDimensions.clientWidth);
    assert.equal(aboutDimensions.railDisplay, "flex");
    assert.equal(aboutDimensions.mobileHeaderDisplay, "none");
    assert.ok(aboutDimensions.profileRect.right <= aboutDimensions.railRect.right);
    assert.ok(aboutDimensions.logoutRect.right <= aboutDimensions.railRect.right);
    assert.equal(aboutDimensions.railLinkCount, 3);
    assert.deepEqual(
      aboutDimensions.railLinks.map((link) => link.text),
      ["▣Projects", "▤Artifact Library", "◷Activity"],
    );
    assert.ok(
      aboutDimensions.railLinks.every(
        (link) =>
          link.width === 40 &&
          link.height === 40 &&
          link.labelWidth === 1 &&
          link.labelHeight === 1,
      ),
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("link", { name: "Explore ArtifactHub" }).click();
    await page.getByRole("heading", { name: "No projects yet" }).waitFor();

    await initialGlobalRail.getByRole("link", { name: "◷ Activity" }).click();
    await page.getByRole("heading", { name: "Activity" }).waitFor();
    await page.getByRole("heading", { name: "Signed in as Browser Test" }).waitFor();
    const emptyActivityDimensions = await page.evaluate(() => ({
      clientWidth: document.body.clientWidth,
      scrollWidth: document.body.scrollWidth,
    }));
    assert.equal(
      emptyActivityDimensions.scrollWidth,
      emptyActivityDimensions.clientWidth,
    );
    assert.equal(
      await initialGlobalRail
        .getByRole("link", { name: "◷ Activity" })
        .getAttribute("aria-current"),
      "page",
    );
    assert.equal(
      await initialGlobalRail
        .getByRole("link", { name: "▣ Projects" })
        .getAttribute("aria-current"),
      null,
    );
    await page.getByRole("link", { name: "Create a project" }).click();
    await page.getByRole("heading", { name: "No projects yet" }).waitFor();
    await page.getByPlaceholder("Search projects...").waitFor();
    await page
      .getByRole("button", { name: "Projects, 0 projects" })
      .waitFor();

    await page.getByRole("button", { name: "Create first project" }).click();
    await page.getByLabel("Project name", { exact: true }).fill("E2E Project");
    await page.getByLabel("Sponsor", { exact: true }).fill("Delivery Sponsor");
    await page
      .getByLabel("Objective", { exact: true })
      .fill("Protect the complete Phase 1 browser journey.");
    await page
      .getByRole("button", { name: "Create and set up context" })
      .click();

    await page.getByRole("heading", { name: "Project Context" }).waitFor();
    await page.getByText("Current project").waitFor();
    await page
      .getByRole("navigation", { name: "E2E Project sections" })
      .getByRole("link", { name: "Project Context" })
      .waitFor();
    await page.getByRole("link", { name: "Start an artifact" }).click();
    await page.getByRole("heading", { name: "Artifact Library" }).waitFor();
    assert.equal(await page.locator(".project-sidebar").count(), 0);
    const templateSearch = page.getByPlaceholder("Search templates...");
    const artifactStagesNav = page.getByRole("navigation", {
      name: "Artifact stages",
    });
    await templateSearch.waitFor();
    const catalogButton = page.getByRole("button", {
      name: "Catalog, 16 templates",
    });
    await catalogButton.waitFor();
    assert.equal(await catalogButton.getAttribute("aria-expanded"), "true");
    const initiationStageButton = artifactStagesNav.getByRole("button", {
      name: "Initiation, 3 templates",
    });
    await initiationStageButton.waitFor();
    assert.equal(await initiationStageButton.getAttribute("aria-expanded"), "false");
    await initiationStageButton.click();
    assert.equal(await initiationStageButton.getAttribute("aria-expanded"), "true");
    await initiationStageButton.click();
    assert.equal(await initiationStageButton.getAttribute("aria-expanded"), "false");
    await initiationStageButton.click();
    assert.equal(await initiationStageButton.getAttribute("aria-expanded"), "true");
    await artifactStagesNav
      .getByRole("button", { name: /Project Charter/ })
      .waitFor();
    await templateSearch.fill("PMO");
    await page.getByRole("button", { name: "Catalog, 4 templates" }).waitFor();
    await artifactStagesNav
      .getByRole("button", { name: "Definition, 1 template" })
      .waitFor();
    await artifactStagesNav
      .getByRole("button", { name: /Business Case/ })
      .waitFor();
    await templateSearch.fill("definitely-not-a-template");
    await page
      .getByText("No templates found. Try a different search term.")
      .waitFor();
    await templateSearch.fill("");
    await page
      .getByRole("heading", { name: "All templates by stage" })
      .waitFor();

    const globalRail = page.getByRole("navigation", {
      name: "Global navigation",
    });
    const projectsRailLink = globalRail.getByRole("link", {
      name: "▣ Projects",
    });
    const libraryRailLink = globalRail.getByRole("link", {
      name: "▤ Artifact Library",
    });
    const activityRailLink = globalRail.getByRole("link", {
      name: "◷ Activity",
    });
    assert.equal(await libraryRailLink.getAttribute("aria-current"), "page");
    assert.equal(await projectsRailLink.getAttribute("aria-current"), null);
    assert.equal(await activityRailLink.getAttribute("aria-current"), null);
    assert.match(await libraryRailLink.getAttribute("class"), /\bactive\b/);
    assert.doesNotMatch(
      await projectsRailLink.getAttribute("class"),
      /\bactive\b/,
    );

    const profileButton = globalRail.getByRole("button", {
      name: "Open account settings",
    });
    const logoutButton = globalRail.getByRole("button", { name: "Log out" });
    const [projectsBox, profileBox] = await Promise.all([
      projectsRailLink.boundingBox(),
      profileButton.boundingBox(),
    ]);
    assert.ok(projectsBox);
    assert.ok(profileBox);
    assert.equal(profileBox.width, projectsBox.width);

    const idleLogoutBackground = await logoutButton.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    assert.equal(idleLogoutBackground, "rgba(0, 0, 0, 0)");

    await profileButton.hover();
    const profileHoverBackground = await profileButton.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await logoutButton.hover();
    const logoutHoverBackground = await logoutButton.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    assert.notEqual(profileHoverBackground, "rgba(0, 0, 0, 0)");
    assert.equal(logoutHoverBackground, profileHoverBackground);

    const charterCard = page.locator("article.template-card").filter({
      has: page.getByRole("heading", { name: "Project Charter" }),
    });
    await Promise.all([
      page.waitForURL(/\/library\/artifacts\/[^/]+$/),
      charterCard.getByRole("button", { name: "Start draft" }).click(),
    ]);
    await page.getByRole("heading", { name: "Project Charter" }).waitFor();
    await page
      .getByRole("navigation", { name: "Unassigned drafts" })
      .getByRole("link", { name: /Project Charter/ })
      .waitFor();
    assert.equal(await libraryRailLink.getAttribute("aria-current"), "page");
    assert.equal(await projectsRailLink.getAttribute("aria-current"), null);

    await page.getByRole("button", { name: "Assign to project" }).click();
    await page.waitForURL(/\/projects\/[^/]+\/artifacts\/[^/]+$/);
    await page.getByRole("heading", { name: "Project Charter" }).waitFor();
    assert.equal(
      await page
        .locator(".project-sidebar")
        .getByRole("link", { name: "Artifact Library" })
        .count(),
      0,
    );
    assert.equal(await projectsRailLink.getAttribute("aria-current"), "page");
    assert.equal(await libraryRailLink.getAttribute("aria-current"), null);

    await activityRailLink.click();
    await page.getByRole("heading", { name: "Activity" }).waitFor();
    assert.equal(await activityRailLink.getAttribute("aria-current"), "page");
    assert.equal(await projectsRailLink.getAttribute("aria-current"), null);
    assert.equal(await libraryRailLink.getAttribute("aria-current"), null);
    await page.getByText("Created E2E Project.").waitFor();
    await page.getByText("Assigned Project Charter.").waitFor();
    await page.getByRole("link", { name: "Open artifact" }).first().click();
    await page.getByRole("heading", { name: "Project Charter" }).waitFor();

    await page
      .getByPlaceholder(
        "Summarize the project purpose and intended business outcome.",
      )
      .fill("Create a dependable, governed project delivery workflow.");
    await page
      .locator(".save-state")
      .filter({ hasText: /^✓ Unsaved changes$/ })
      .waitFor();
    await page
      .locator(".save-state")
      .filter({ hasText: /^✓ Saved / })
      .waitFor();
    await page.getByRole("link", { name: "Review mode" }).click();

    await page.getByText("Review summary", { exact: true }).waitFor();
    await page.getByText("5 blockers", { exact: false }).waitFor();
    const approveButtons = page.getByRole("button", {
      name: "Approve version",
    });
    const exportPreviewButtons = page.getByRole("button", {
      name: "Export preview",
    });
    assert.equal(await approveButtons.count(), 2);
    assert.equal(await exportPreviewButtons.count(), 2);
    await approveButtons.first().click();
    await page
      .getByText("Approval is blocked until 5 blocking items are resolved.")
      .waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("link", { name: "Return to editing" }).click();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.body.clientWidth,
      scrollWidth: document.body.scrollWidth,
    }));
    assert.equal(dimensions.scrollWidth, dimensions.clientWidth);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/auth");
    const signInHeading = page.getByRole("heading", { name: "Sign in to ArtifactHub" });
    if (!(await signInHeading.isVisible())) {
      await page.goto(baseUrl);
      assert.equal(
        await page.getByRole("link", { name: "Sign in" }).first().getAttribute("href"),
        "/auth",
      );
      await page.getByRole("link", { name: "Sign in" }).first().click();
    }
    const backToSignIn = page.getByRole("button", { name: "Back to sign in" });
    if (await backToSignIn.isVisible()) {
      await backToSignIn.click();
    }
    await signInHeading.waitFor();
    assert.match(page.url(), /\/auth$/);
    await page.getByLabel("Email", { exact: true }).fill(testEmail);
    await page.getByLabel(/Password/).fill("browser-pass-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await initialGlobalRail.waitFor();
    await projectsRailLink.click();
    await page.getByRole("heading", { name: "Projects" }).waitFor();
    await page.getByPlaceholder("Search projects...").waitFor();
    assert.equal(await projectsRailLink.getAttribute("aria-current"), "page");
    assert.equal(await aboutRailLink.getAttribute("aria-current"), null);
    assert.deepEqual(consoleErrors, []);

    console.log("Browser end-to-end test passed.");
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    await rm(dataDir, { force: true, recursive: true });
  }
}

run().catch((error) => {
  console.error("Browser end-to-end test failed.");
  console.error(error);
  process.exit(1);
});
