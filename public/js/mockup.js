const articleContent = {
  briefing: {
    tag: "Briefing",
    status: "Ready for review",
    title: "Executive status update",
    intro:
      "Apollo is progressing well on design quality, but the approval path is slowing team throughput. This concept prioritizes the signal leaders actually need: what changed, what matters, and what decision is blocking flow.",
    leftTitle: "What changed",
    leftItems: [
      "Navigation simplification improved test success from 61% to 82%.",
      "Accessibility fixes are complete for the signed-in dashboard flow.",
      "Launch date confidence dropped because stakeholder review moved twice.",
    ],
    rightTitle: "Decision needed",
    rightItems: [
      "Approve reduced scope for phase one onboarding analytics.",
      "Confirm whether launch can proceed with deferred PDF export polish.",
    ],
  },
  risk: {
    tag: "Risk",
    status: "2 unresolved owners",
    title: "Risk register",
    intro:
      "The strongest experience is not a longer list of risks. It is a prioritized, owner-aware view that makes unclear accountability obvious and keeps mitigation steps close to the problem.",
    leftTitle: "Highest urgency",
    leftItems: [
      "Leadership review lag could push launch readiness past the planned announcement window.",
      "Design signoff dependency on legal copy is still unassigned.",
      "Analytics scope may expand unless phase one boundaries are confirmed.",
    ],
    rightTitle: "Helpful UX behavior",
    rightItems: [
      "Bubble risks with missing owners to the top automatically.",
      "Let AI draft mitigation options, but require an explicit human owner before marking a risk monitored.",
    ],
  },
  plan: {
    tag: "Plan",
    status: "Milestones aligned",
    title: "90-day delivery map",
    intro:
      "Teams move faster when the plan shows confidence, dependencies, and decision gates together. This mockup treats time as a story of momentum rather than a static list of dates.",
    leftTitle: "Core milestones",
    leftItems: [
      "Week 1: approve launch scope and finalize review packet.",
      "Week 3: complete QA on responsive dashboard and zero-state flows.",
      "Week 6: publish artifact exports and stakeholder reporting templates.",
    ],
    rightTitle: "Why it helps",
    rightItems: [
      "Separates tasks from true decision gates.",
      "Keeps the next milestone visible in every project workspace.",
      "Makes slipping confidence easy to spot before a milestone is missed.",
    ],
  },
};

const projectContent = {
  apollo: {
    title: "Weekly leadership briefing",
    summary:
      "Summarize the approval delay for leaders, then generate a sponsor follow-up note with two scope options.",
  },
  atlas: {
    title: "Dependency mapping workspace",
    summary:
      "Surface systems that are still undocumented, then draft a migration checkpoint artifact for the operations lead.",
  },
  lumen: {
    title: "Launch readiness control room",
    summary:
      "Create a launch narrative, highlight rising change requests, and prepare a short escalation note for Friday's checkpoint.",
  },
};

const overlayPanels = {
  briefing: {
    kicker: "Morning briefing",
    title: "A calmer start to the day",
    blocks: [
      {
        heading: "Intent",
        body:
          "Open the app and immediately understand what changed, what needs your judgment, and what can safely wait.",
      },
      {
        heading: "Why it matters",
        body:
          "People should not hunt through projects to discover urgency. The product should quietly assemble that context for them.",
      },
    ],
  },
  timeline: {
    kicker: "Timeline view",
    title: "A timeline that explains confidence",
    blocks: [
      {
        heading: "Design principle",
        body:
          "Tie milestones to confidence and dependencies so dates are never disconnected from the reasons they feel safe or risky.",
      },
      {
        heading: "Interaction idea",
        body:
          "Dragging a milestone reveals the decisions, owners, and downstream artifacts that need to move with it.",
      },
    ],
  },
  artifact: {
    kicker: "Artifact canvas",
    title: "Focused writing without losing context",
    blocks: [
      {
        heading: "Canvas layout",
        body:
          "Keep the artifact front and center, while preserving lightweight side context for project health, reviewers, and AI suggestions.",
      },
      {
        heading: "Safety guardrail",
        body:
          "Warn before leaving when there are unsaved changes or unresolved generated content that has not been accepted.",
      },
    ],
  },
  library: {
    kicker: "Library",
    title: "Artifact library by situation, not by template name",
    blocks: [
      {
        heading: "Better discovery",
        body:
          "Group artifacts around moments like executive review, launch readiness, weekly delivery, and risk escalation.",
      },
      {
        heading: "Expected outcome",
        body:
          "New users can choose the right artifact even when they do not know the formal project-management term yet.",
      },
    ],
  },
  copilot: {
    kicker: "AI copilot",
    title: "AI that proposes, but does not obscure",
    blocks: [
      {
        heading: "Suggested output",
        body:
          "Draft a sponsor note with a crisp summary, two scope options, and one recommended ask based on current risk signals.",
      },
      {
        heading: "Trust behavior",
        body:
          "Every AI suggestion should show its source artifacts so users can verify the reasoning without leaving the workflow.",
      },
    ],
  },
  share: {
    kicker: "Share flow",
    title: "Sharing designed for busy stakeholders",
    blocks: [
      {
        heading: "Recommended actions",
        body:
          "Share as a brief email, export as a polished PDF, or create a review link with the key decisions pre-highlighted.",
      },
      {
        heading: "UX principle",
        body:
          "Reduce formatting work. People should spend time deciding, not rebuilding the same status report in another tool.",
      },
    ],
  },
};

const stageTitle = document.getElementById("stage-title");
const copilotSummary = document.getElementById("copilot-summary");
const articleTag = document.getElementById("article-tag");
const articleStatus = document.getElementById("article-status");
const articleBody = document.getElementById("article-body");
const overlay = document.getElementById("overlay");
const overlayKicker = document.getElementById("overlay-kicker");
const overlayTitle = document.getElementById("overlay-title");
const overlayContent = document.getElementById("overlay-content");

function renderArticle(articleId) {
  const content = articleContent[articleId];

  if (!content) {
    return;
  }

  articleTag.textContent = content.tag;
  articleStatus.textContent = content.status;
  articleBody.innerHTML = `
    <h3>${content.title}</h3>
    <p>${content.intro}</p>
    <div class="article-highlights">
      <section>
        <h4>${content.leftTitle}</h4>
        <ul>${content.leftItems.map((item) => `<li>${item}</li>`).join("")}</ul>
      </section>
      <section>
        <h4>${content.rightTitle}</h4>
        <ul>${content.rightItems.map((item) => `<li>${item}</li>`).join("")}</ul>
      </section>
    </div>
  `;
}

function renderProject(projectId) {
  const project = projectContent[projectId];

  if (!project) {
    return;
  }

  stageTitle.textContent = project.title;
  copilotSummary.textContent = project.summary;
}

function openPanel(panelId) {
  const panel = overlayPanels[panelId];

  if (!panel) {
    return;
  }

  overlayKicker.textContent = panel.kicker;
  overlayTitle.textContent = panel.title;
  overlayContent.innerHTML = panel.blocks
    .map(
      (block) => `
        <section class="panel-block">
          <h3>${block.heading}</h3>
          <p>${block.body}</p>
        </section>
      `,
    )
    .join("");
  overlay.classList.remove("hidden");
}

function closePanel() {
  overlay.classList.add("hidden");
}

document.querySelectorAll("[data-article]").forEach((button) => {
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-article]")
      .forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    renderArticle(button.dataset.article);
  });
});

document.querySelectorAll("[data-project]").forEach((button) => {
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-project]")
      .forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    renderProject(button.dataset.project);
  });
});

document.querySelectorAll("[data-panel]").forEach((button) => {
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-panel]")
      .forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
  });
});

document.querySelectorAll("[data-open-panel]").forEach((button) => {
  button.addEventListener("click", () => openPanel(button.dataset.openPanel));
});

document.querySelectorAll("[data-close-panel]").forEach((element) => {
  element.addEventListener("click", closePanel);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closePanel();
  }
});

renderArticle("briefing");
renderProject("apollo");
