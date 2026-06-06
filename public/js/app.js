document.addEventListener("DOMContentLoaded", () => {
  const authView = document.getElementById("auth-view");
  const appView = document.getElementById("app-view");
  const authForm = document.getElementById("auth-form");
  const authName = document.getElementById("auth-name");
  const authEmail = document.getElementById("auth-email");
  const authPassword = document.getElementById("auth-password");
  const authSubmitButton = document.getElementById("auth-submit-button");
  const authModeButton = document.getElementById("auth-mode-button");
  const authResetRequestButton = document.getElementById(
    "auth-reset-request-button",
  );
  const authMessage = document.getElementById("auth-message");
  const homeButton = document.getElementById("home-button");
  const currentUserButton = document.getElementById("current-user-button");
  const currentUserLabel = document.getElementById("current-user-label");
  const logoutButton = document.getElementById("logout-button");
  const accountModal = document.getElementById("account-modal");
  const closeAccountModalButton = document.getElementById(
    "close-account-modal-button",
  );
  const cancelAccountModalButton = document.getElementById(
    "cancel-account-modal-button",
  );
  const changePasswordForm = document.getElementById("change-password-form");
  const currentPasswordInput = document.getElementById("current-password");
  const newPasswordInput = document.getElementById("new-password");
  const confirmPasswordInput = document.getElementById("confirm-password");
  const changePasswordMessage = document.getElementById(
    "change-password-message",
  );
  const adminPanel = document.getElementById("admin-panel");
  const adminUsersMessage = document.getElementById("admin-users-message");
  const adminUserList = document.getElementById("admin-user-list");
  const confirmModal = document.getElementById("confirm-modal");
  const confirmModalTitle = document.getElementById("confirm-modal-title");
  const confirmModalMessage = document.getElementById("confirm-modal-message");
  const closeConfirmModalButton = document.getElementById(
    "close-confirm-modal-button",
  );
  const cancelConfirmModalButton = document.getElementById(
    "cancel-confirm-modal-button",
  );
  const confirmModalSubmitButton = document.getElementById(
    "confirm-modal-submit-button",
  );
  const passwordToggleButtons = document.querySelectorAll(".password-toggle");
  const projectList = document.getElementById("project-list");
  const showProjectFormButton = document.getElementById(
    "show-project-form-button",
  );
  const projectForm = document.getElementById("project-form");
  const projectName = document.getElementById("project-name");
  const projectSponsor = document.getElementById("project-sponsor");
  const projectObjective = document.getElementById("project-objective");
  const projectMessage = document.getElementById("project-message");
  const dashboardView = document.getElementById("dashboard-view");
  const projectSummaryGrid = document.getElementById("project-summary-grid");
  const projectWorkspaceView = document.getElementById(
    "project-workspace-view",
  );
  const activeProjectName = document.getElementById("active-project-name");
  const activeProjectMeta = document.getElementById("active-project-meta");
  const artifactList = document.getElementById("artifact-list");
  const menuList = document.getElementById("template-menu-list");
  const activeContainer = document.getElementById("active-template-container");
  const templateTitle = document.getElementById("template-title");
  const templateDescription = document.getElementById("template-description");
  const fieldsBucket = document.getElementById("form-fields-bucket");
  const artifactForm = document.getElementById("artifact-form");
  const artifactSaveStatus = document.getElementById("artifact-save-status");
  const artifactExportButton = document.getElementById(
    "artifact-export-button",
  );

  let currentUser = null;
  let authMode = "login";
  let passwordResetToken = new URLSearchParams(window.location.search).get(
    "resetToken",
  );
  let projects = [];
  let templateSummaries = [];
  let activeProject = null;
  let activeTemplate = null;
  let activeArtifact = null;
  let saveTimer = null;
  let isSavingArtifact = false;
  let pendingSave = false;
  let hasUnsavedChanges = false;
  let isChangingPassword = false;
  let confirmResolver = null;
  let adminUsers = [];
  const newArtifactIds = new Set();

  fetch("/api/templates")
    .then((res) => res.json())
    .then((templates) => {
      templateSummaries = templates;
      menuList.innerHTML = "";
      templates.forEach((tpl) => {
        const li = document.createElement("li");
        li.className = "template-list-item";
        li.textContent = tpl.title;
        li.addEventListener("click", () => loadTemplateWorkspace(tpl.id, li));
        menuList.appendChild(li);
      });
    })
    .catch(() => {
      menuList.innerHTML =
        '<li style="color:red;">Error fetching template directory metadata payloads.</li>';
    });

  function showAuthView() {
    authView.classList.remove("hidden");
    appView.classList.add("hidden");
    homeButton.classList.add("hidden");
    currentUserButton.classList.add("hidden");
    logoutButton.classList.add("hidden");
    currentUserLabel.textContent = "Signed out";
    closeAccountModal();
  }

  function showAppView(user) {
    currentUser = user;
    authView.classList.add("hidden");
    appView.classList.remove("hidden");
    homeButton.classList.remove("hidden");
    currentUserButton.classList.remove("hidden");
    logoutButton.classList.remove("hidden");
    currentUserLabel.textContent = user.name;
    currentUserButton.setAttribute("aria-expanded", "false");
    loadProjects();
  }

  function updateAuthMode() {
    const isSignup = authMode === "signup";
    const isForgot = authMode === "forgot";
    const isReset = authMode === "reset";

    setAuthFieldVisibility(authName, isSignup);
    setAuthFieldVisibility(authEmail, !isReset);
    setAuthFieldVisibility(authPassword, !isForgot);

    authName.required = isSignup;
    authEmail.required = !isReset;
    authPassword.required = !isForgot;
    authPassword.placeholder = isReset
      ? "New password, at least 8 characters"
      : "At least 8 characters";
    resetPasswordField(authPassword);
    resetPasswordVisibility();

    if (isSignup) {
      authSubmitButton.textContent = "Create account";
      authModeButton.textContent = "Already have an account? Sign in";
    } else if (isForgot) {
      authSubmitButton.textContent = "Create reset link";
      authModeButton.textContent = "Back to sign in";
    } else if (isReset) {
      authSubmitButton.textContent = "Update password";
      authModeButton.textContent = "Back to sign in";
    } else {
      authSubmitButton.textContent = "Sign in";
      authModeButton.textContent = "Create an account";
    }

    authResetRequestButton.classList.toggle("hidden", authMode !== "login");
    setAuthMessage("");
  }

  function setAuthFieldVisibility(input, isVisible) {
    input.parentElement.classList.toggle("hidden", !isVisible);
    input.disabled = !isVisible;
  }

  function setAuthMessage(message, tone = "") {
    authMessage.textContent = message;
    authMessage.dataset.tone = tone;
  }

  function setAuthResetLink(resetUrl) {
    authMessage.dataset.tone = "success";
    authMessage.replaceChildren(
      document.createTextNode("Demo reset link: "),
      Object.assign(document.createElement("a"), {
        href: resetUrl,
        textContent: "set a new password",
      }),
    );
  }

  function updatePasswordToggle(button, input) {
    const isVisible = input.type === "text";
    button.textContent = isVisible ? "Hide" : "Show";
    button.setAttribute(
      "aria-label",
      `${isVisible ? "Hide" : "Show"} password`,
    );
  }

  function togglePasswordVisibility(button) {
    const input = document.getElementById(button.dataset.passwordTarget);

    if (!input) {
      return;
    }

    input.type = input.type === "password" ? "text" : "password";
    updatePasswordToggle(button, input);
  }

  function resetPasswordField(input) {
    if (!input) {
      return;
    }

    input.value = "";
    input.type = "password";
  }

  function resetPasswordVisibility() {
    passwordToggleButtons.forEach((button) => {
      const input = document.getElementById(button.dataset.passwordTarget);

      if (!input) {
        return;
      }

      input.type = "password";
      updatePasswordToggle(button, input);
    });
  }

  async function loadCurrentUser() {
    try {
      const response = await fetch("/api/auth/me");
      const data = await response.json();

      if (!response.ok || !data.user) {
        showAuthView();
        return;
      }

      showAppView(data.user);
    } catch (error) {
      showAuthView();
    }
  }

  async function loadProjects() {
    try {
      projectList.innerHTML = '<li class="loading">Loading projects...</li>';
      projectSummaryGrid.innerHTML = "";

      const response = await fetch("/api/projects");
      const data = await response.json();

      if (!response.ok) {
        const message =
          data.error ||
          "Projects could not be loaded. Refresh the page or try signing in again.";
        renderProjectLoadError(message);
        return;
      }

      projects = data;
      renderProjects();
    } catch (error) {
      const message =
        "Projects could not be loaded because the server is unreachable. Check your connection and refresh.";
      renderProjectLoadError(message);
    }
  }

  function renderProjectLoadError(message) {
    const listItem = document.createElement("li");
    listItem.className = "loading";
    listItem.textContent = message;

    const summary = document.createElement("p");
    summary.className = "empty-state";
    summary.textContent = message;

    projectList.replaceChildren(listItem);
    projectSummaryGrid.replaceChildren(summary);
  }

  function renderProjects() {
    projectList.innerHTML = "";
    projectSummaryGrid.innerHTML = "";

    if (projects.length === 0) {
      projectList.innerHTML = '<li class="loading">No projects yet.</li>';
      projectSummaryGrid.innerHTML =
        '<p class="empty-state">Create your first project workspace to begin.</p>';
      return;
    }

    projects.forEach((project) => {
      projectList.appendChild(createProjectTreeItem(project));
      projectSummaryGrid.appendChild(createProjectCard(project));
    });
  }

  function createProjectTreeItem(project) {
    const item = document.createElement("li");
    item.className = "project-tree-item";
    item.classList.toggle("active", activeProject?.id === project.id);

    const row = document.createElement("div");
    row.className = "list-row";

    const openButton = document.createElement("button");
    openButton.className = "list-row-main";
    openButton.type = "button";
    openButton.textContent = project.name;
    openButton.addEventListener("click", () => selectProject(project.id));

    const deleteButton = createDeleteButton(`Delete ${project.name}`);
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteProject(project.id, project.name);
    });

    row.appendChild(openButton);
    row.appendChild(deleteButton);
    item.appendChild(row);

    if (project.artifacts.length > 0) {
      const childList = document.createElement("ul");
      childList.className = "artifact-tree";

      project.artifacts.forEach((artifact) => {
        childList.appendChild(createArtifactTreeItem(project, artifact));
      });

      item.appendChild(childList);
    }

    return item;
  }

  function createArtifactTreeItem(project, artifact) {
    const item = document.createElement("li");
    item.className = "artifact-tree-item";
    item.classList.toggle("active", activeArtifact?.id === artifact.id);

    const openButton = document.createElement("button");
    openButton.className = "artifact-tree-main";
    openButton.type = "button";
    openButton.addEventListener("click", () =>
      openSavedArtifactFromProject(project.id, artifact.id),
    );

    const title = document.createElement("span");
    title.textContent = artifact.title || getTemplateTitle(artifact.templateId);

    const timestamp = document.createElement("small");
    timestamp.textContent = formatDateTime(artifact.createdAt);

    openButton.appendChild(title);
    if (newArtifactIds.has(artifact.id)) {
      const newLabel = document.createElement("span");
      newLabel.className = "new-label";
      newLabel.textContent = "New";
      openButton.appendChild(newLabel);
    }
    openButton.appendChild(timestamp);

    const deleteButton = createDeleteButton(`Delete ${artifact.title}`);
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteArtifactFromProject(project.id, artifact.id, artifact.title);
    });

    item.appendChild(openButton);
    item.appendChild(deleteButton);
    return item;
  }

  function createProjectCard(project) {
    const card = document.createElement("div");
    card.className = "project-card";

    const openButton = document.createElement("button");
    openButton.className = "project-card-main";
    openButton.type = "button";
    openButton.addEventListener("click", () => selectProject(project.id));

    const title = document.createElement("strong");
    title.textContent = project.name;

    const meta = document.createElement("span");
    meta.textContent = `${project.artifacts.length} artifact draft${
      project.artifacts.length === 1 ? "" : "s"
    }`;

    openButton.appendChild(title);
    openButton.appendChild(meta);

    const deleteButton = createDeleteButton(`Delete ${project.name}`);
    deleteButton.addEventListener("click", () =>
      deleteProject(project.id, project.name),
    );

    card.appendChild(openButton);
    card.appendChild(deleteButton);
    return card;
  }

  function createDeleteButton(label) {
    const button = document.createElement("button");
    button.className = "icon-button delete-button";
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = "&#128465;";
    return button;
  }

  function showDashboard() {
    activeProject = null;
    clearActiveArtifactSession();
    clearTemplateSelection();
    renderProjects();
    dashboardView.classList.remove("hidden");
    projectWorkspaceView.classList.add("hidden");
    activeContainer.classList.add("hidden");
  }

  function showProjectForm() {
    showDashboard();
    setProjectMessage("");
    projectForm.classList.remove("hidden");
    projectName.focus();
  }

  async function selectProject(projectId) {
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      const project = await response.json();

      if (!response.ok) {
        return;
      }

      activeProject = project;
      clearActiveArtifactSession();
      clearTemplateSelection();
      dashboardView.classList.add("hidden");
      projectWorkspaceView.classList.remove("hidden");
      activeContainer.classList.add("hidden");
      activeProjectName.textContent = project.name;
      activeProjectMeta.textContent =
        project.objective || "Select an artifact template to begin.";

      replaceProject(project);
      renderProjects();
      renderArtifactSummary(project);
    } catch (error) {
      console.error("Unable to select project", error);
    }
  }

  function renderArtifactSummary(project) {
    artifactList.innerHTML = "";

    if (project.artifacts.length === 0) {
      artifactList.innerHTML =
        '<p class="empty-state">No artifact drafts yet. Choose a template from the library.</p>';
      return;
    }

    artifactList.innerHTML = `<p class="empty-state">${project.artifacts.length} artifact draft${
      project.artifacts.length === 1 ? "" : "s"
    } saved. Open artifacts from the project tree in the sidebar.</p>`;
  }

  async function loadTemplateWorkspace(templateId, clickedElement) {
    document
      .querySelectorAll("#template-menu-list li")
      .forEach((el) => el.classList.remove("active"));
    clickedElement.classList.add("active");

    try {
      const response = await fetch(`/api/templates/${templateId}`);
      const data = await response.json();

      if (!response.ok) {
        return;
      }

      activeTemplate = { ...data, id: templateId };
      clearSavedArtifactSelection();
      dashboardView.classList.add("hidden");
      projectWorkspaceView.classList.remove("hidden");
      activeContainer.classList.remove("hidden");

      renderTemplateFields(activeTemplate, {});
      updateArtifactExportButton();
      setArtifactSaveStatus(getTemplatePreviewStatus());
      if (activeProject) {
        renderArtifactSummary(activeProject);
      } else {
        activeProjectName.textContent = "No project selected";
        activeProjectMeta.textContent = getTemplatePreviewStatus();
        artifactList.innerHTML = "";
      }
    } catch (error) {
      setArtifactSaveStatus("Unable to load template.");
    }
  }

  async function openSavedArtifact(artifactId) {
    if (!activeProject) {
      return;
    }

    const artifact = activeProject.artifacts.find(
      (item) => item.id === artifactId,
    );

    if (!artifact) {
      return;
    }

    try {
      const response = await fetch(`/api/templates/${artifact.templateId}`);
      const template = await response.json();

      if (!response.ok) {
        return;
      }

      activeTemplate = { ...template, id: artifact.templateId };
      activeArtifact = artifact;
      clearTemplateSelection();
      dashboardView.classList.add("hidden");
      projectWorkspaceView.classList.remove("hidden");
      activeContainer.classList.remove("hidden");

      renderTemplateFields(activeTemplate, artifact.fieldValues || {});
      updateArtifactExportButton();
      setArtifactSaveStatus(
        `Last saved ${formatDateTime(artifact.updatedAt)}. Your changes are stored.`,
        "success",
      );
      renderProjects();
      renderArtifactSummary(activeProject);
    } catch (error) {
      setArtifactSaveStatus("Unable to open artifact.");
    }
  }

  async function openSavedArtifactFromProject(projectId, artifactId) {
    if (!activeProject || activeProject.id !== projectId) {
      await selectProject(projectId);
    }

    await openSavedArtifact(artifactId);
  }

  function renderTemplateFields(template, fieldValues) {
    templateTitle.textContent = template.title;
    templateDescription.textContent = template.description;
    fieldsBucket.innerHTML = "";
    hasUnsavedChanges = false;

    template.fields.forEach((field) => {
      const group = document.createElement("div");
      group.className = "form-group";

      const label = document.createElement("label");
      label.setAttribute("for", field.id);
      label.textContent = field.label;

      let input;
      if (field.type === "textarea") {
        input = document.createElement("textarea");
      } else {
        input = document.createElement("input");
        input.type = field.type;
      }

      input.id = field.id;
      input.className = "form-control";
      input.placeholder = field.placeholder;
      input.value = fieldValues[field.id] || "";
      input.addEventListener("input", scheduleArtifactAutoSave);

      group.appendChild(label);
      group.appendChild(input);
      fieldsBucket.appendChild(group);
    });
  }

  function scheduleArtifactAutoSave() {
    if (!activeProject) {
      setArtifactSaveStatus(getTemplatePreviewStatus());
      return;
    }

    hasUnsavedChanges = true;
    setArtifactSaveStatus("Unsaved changes", "warning");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveActiveArtifact, 500);
  }

  async function saveActiveArtifact() {
    if (!activeProject || !activeTemplate) {
      return;
    }

    saveTimer = null;
    const fieldValues = collectFieldValues();

    if (!activeArtifact && !hasAnyFieldValue(fieldValues)) {
      hasUnsavedChanges = false;
      setArtifactSaveStatus("Start typing to create this artifact.");
      return;
    }

    if (isSavingArtifact) {
      pendingSave = true;
      return;
    }

    isSavingArtifact = true;
    pendingSave = false;
    setArtifactSaveStatus("Saving...", "working");

    try {
      let response;
      let artifact;

      if (!activeArtifact) {
        response = await fetch(`/api/projects/${activeProject.id}/artifacts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            templateId: activeTemplate.id,
            title: activeTemplate.title,
            fieldValues,
          }),
        });
        artifact = await response.json();

        if (!response.ok) {
          throw new Error(artifact.error || "Unable to create artifact.");
        }

        activeArtifact = artifact;
        newArtifactIds.add(artifact.id);
        activeProject.artifacts.unshift(artifact);
        updateArtifactExportButton();
      } else {
        response = await fetch(
          `/api/projects/${activeProject.id}/artifacts/${activeArtifact.id}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: activeArtifact.title,
              status: activeArtifact.status,
              fieldValues,
            }),
          },
        );
        artifact = await response.json();

        if (!response.ok) {
          throw new Error(artifact.error || "Unable to update artifact.");
        }

        activeArtifact = artifact;
        updateArtifactExportButton();
        activeProject.artifacts = activeProject.artifacts.map((item) =>
          item.id === artifact.id ? artifact : item,
        );
      }

      replaceProject(activeProject);
      renderProjects();
      renderArtifactSummary(activeProject);
      hasUnsavedChanges = false;
      setArtifactSaveStatus(
        `Last saved ${formatDateTime(activeArtifact.updatedAt)}. Your changes are stored.`,
        "success",
      );
    } catch (error) {
      hasUnsavedChanges = true;
      setArtifactSaveStatus(
        "Unable to save changes. Your latest edits are still on screen.",
        "error",
      );
    } finally {
      isSavingArtifact = false;
      if (pendingSave) {
        saveActiveArtifact();
      }
    }
  }

  function collectFieldValues() {
    const values = {};
    fieldsBucket.querySelectorAll(".form-control").forEach((input) => {
      values[input.id] = input.value;
    });
    return values;
  }

  function hasAnyFieldValue(fieldValues) {
    return Object.values(fieldValues).some(
      (value) => String(value).trim() !== "",
    );
  }

  function setArtifactSaveStatus(message, tone = "") {
    artifactSaveStatus.textContent = message;
    artifactSaveStatus.dataset.tone = tone;
  }

  function setProjectMessage(message, tone = "") {
    projectMessage.textContent = message;
    projectMessage.dataset.tone = tone;
  }

  function setChangePasswordMessage(message, tone = "") {
    changePasswordMessage.textContent = message;
    changePasswordMessage.dataset.tone = tone;
  }

  function setAdminUsersMessage(message, tone = "") {
    adminUsersMessage.textContent = message;
    adminUsersMessage.dataset.tone = tone;
  }

  function renderAdminUsers() {
    adminUserList.innerHTML = "";

    if (adminUsers.length === 0) {
      adminUserList.innerHTML = '<li class="loading">No accounts found.</li>';
      return;
    }

    adminUsers.forEach((user) => {
      const item = document.createElement("li");
      item.className = "admin-user-item";

      const meta = document.createElement("div");
      meta.className = "admin-user-meta";

      const name = document.createElement("strong");
      name.textContent = user.name;

      const email = document.createElement("span");
      email.textContent = user.email;

      const counts = document.createElement("small");
      counts.textContent = `${user.projectCount} project${
        user.projectCount === 1 ? "" : "s"
      } • ${user.artifactCount} artifact${
        user.artifactCount === 1 ? "" : "s"
      }`;

      meta.appendChild(name);
      meta.appendChild(email);
      meta.appendChild(counts);

      if (user.id === currentUser?.id) {
        const badge = document.createElement("span");
        badge.className = "admin-user-badge";
        badge.textContent = "Current account";
        meta.appendChild(badge);
      }

      item.appendChild(meta);

      if (user.id !== currentUser?.id) {
        const deleteButton = document.createElement("button");
        deleteButton.className = "btn-save btn-danger";
        deleteButton.type = "button";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => deleteAdminUser(user));
        item.appendChild(deleteButton);
      }

      adminUserList.appendChild(item);
    });
  }

  async function loadAdminUsers() {
    if (!currentUser?.isAdmin) {
      adminUsers = [];
      adminPanel.classList.add("hidden");
      return;
    }

    adminPanel.classList.remove("hidden");
    adminUserList.innerHTML = '<li class="loading">Loading accounts...</li>';
    setAdminUsersMessage("");

    try {
      const response = await fetch("/api/admin/users");
      const data = await response.json();

      if (!response.ok) {
        setAdminUsersMessage(
          data.error || "Unable to load admin accounts.",
          "error",
        );
        adminUserList.innerHTML = "";
        return;
      }

      adminUsers = data.users || [];
      renderAdminUsers();
    } catch (error) {
      setAdminUsersMessage("Unable to reach the server.", "error");
      adminUserList.innerHTML = "";
    }
  }

  function openAccountModal() {
    if (!currentUser) {
      return;
    }

    changePasswordForm.reset();
    resetPasswordField(currentPasswordInput);
    resetPasswordField(newPasswordInput);
    resetPasswordField(confirmPasswordInput);
    resetPasswordVisibility();
    setChangePasswordMessage("");
    setAdminUsersMessage("");
    accountModal.classList.remove("hidden");
    currentUserButton.setAttribute("aria-expanded", "true");
    currentPasswordInput.focus();
    loadAdminUsers();
  }

  function closeAccountModal() {
    accountModal.classList.add("hidden");
    currentUserButton.setAttribute("aria-expanded", "false");
    changePasswordForm.reset();
    resetPasswordField(currentPasswordInput);
    resetPasswordField(newPasswordInput);
    resetPasswordField(confirmPasswordInput);
    resetPasswordVisibility();
    setChangePasswordMessage("");
    setAdminUsersMessage("");
    adminPanel.classList.add("hidden");
    adminUserList.innerHTML = "";
    isChangingPassword = false;
  }

  async function submitPasswordChange(event) {
    event.preventDefault();

    if (isChangingPassword) {
      return;
    }

    if (newPasswordInput.value !== confirmPasswordInput.value) {
      setChangePasswordMessage(
        "New password and confirmation must match.",
        "error",
      );
      return;
    }

    setChangePasswordMessage("Updating password...", "working");
    isChangingPassword = true;

    try {
      const response = await fetch("/api/auth/password-change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          currentPassword: currentPasswordInput.value,
          newPassword: newPasswordInput.value,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setChangePasswordMessage(
          data.error || "Unable to change password.",
          "error",
        );
        return;
      }

      currentUser = data.user || currentUser;
      setChangePasswordMessage(
        "Password updated. You're still signed in with the new password.",
        "success",
      );
      changePasswordForm.reset();
      setTimeout(() => {
        if (!accountModal.classList.contains("hidden")) {
          closeAccountModal();
        }
      }, 900);
    } catch (error) {
      setChangePasswordMessage("Unable to reach the server.", "error");
    } finally {
      isChangingPassword = false;
    }
  }

  function openConfirmModal({
    title = "Confirm Action",
    message = "Are you sure you want to continue?",
    confirmLabel = "Confirm",
  }) {
    confirmModalTitle.textContent = title;
    confirmModalMessage.textContent = message;
    confirmModalSubmitButton.textContent = confirmLabel;
    confirmModal.classList.remove("hidden");
    confirmModalSubmitButton.focus();
  }

  function closeConfirmModal(confirmed = false) {
    confirmModal.classList.add("hidden");
    if (confirmResolver) {
      const resolve = confirmResolver;
      confirmResolver = null;
      resolve(confirmed);
    }
  }

  function confirmWithModal(options) {
    if (confirmResolver) {
      return Promise.resolve(false);
    }

    openConfirmModal(options);
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  async function deleteAdminUser(user) {
    const confirmed = await confirmWithModal({
      title: "Delete Account",
      message: `Delete the account for "${user.email}" and all of its projects and artifacts? This cannot be undone.`,
      confirmLabel: "Delete Account",
    });

    if (!confirmed) {
      return;
    }

    setAdminUsersMessage(`Deleting ${user.email}...`, "working");

    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });
      const data = await response.json();

      if (!response.ok) {
        setAdminUsersMessage(
          data.error || "Unable to delete that account.",
          "error",
        );
        return;
      }

      adminUsers = adminUsers.filter((item) => item.id !== user.id);
      renderAdminUsers();
      setAdminUsersMessage("Account deleted.", "success");
    } catch (error) {
      setAdminUsersMessage("Unable to reach the server.", "error");
    }
  }

  function updateArtifactExportButton() {
    artifactExportButton.classList.toggle("hidden", !activeArtifact);
  }

  function exportActiveArtifact() {
    if (!activeProject || !activeArtifact) {
      return;
    }

    if (
      hasUnsavedChanges &&
      !confirm("Export the last saved version? Unsaved changes are not included.")
    ) {
      return;
    }

    const projectId = encodeURIComponent(activeProject.id);
    const artifactId = encodeURIComponent(activeArtifact.id);
    window.location.href = `/api/projects/${projectId}/artifacts/${artifactId}/export.md`;
  }

  function getTemplatePreviewStatus() {
    return projects.length === 0
      ? "Please create a project first to save this template as a draft."
      : "Please select a project to save this template as an artifact.";
  }

  function clearActiveArtifactSession() {
    clearTimeout(saveTimer);
    activeTemplate = null;
    activeArtifact = null;
    isSavingArtifact = false;
    pendingSave = false;
    hasUnsavedChanges = false;
    fieldsBucket.innerHTML = "";
    setArtifactSaveStatus("");
    updateArtifactExportButton();
  }

  function shouldConfirmRefresh() {
    return hasUnsavedChanges || isSavingArtifact || pendingSave || !!saveTimer;
  }

  function clearSavedArtifactSelection() {
    activeArtifact = null;
    renderProjects();
  }

  function clearTemplateSelection() {
    document
      .querySelectorAll("#template-menu-list li")
      .forEach((item) => item.classList.remove("active"));
  }

  function replaceProject(project) {
    projects = projects.map((item) => (item.id === project.id ? project : item));
  }

  function getTemplateTitle(templateId) {
    const template = templateSummaries.find((item) => item.id === templateId);
    return template?.title || "Artifact";
  }

  function formatDateTime(value) {
    if (!value) {
      return "Not saved";
    }

    return new Date(value).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  async function deleteProject(projectId, projectName) {
    const confirmed = await confirmWithModal({
      title: "Delete Project",
      message: `Delete "${projectName}" and all of its artifacts? This cannot be undone.`,
      confirmLabel: "Delete Project",
    });

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        alert("Unable to delete project.");
        return;
      }

      projects = projects.filter((project) => project.id !== projectId);

      if (activeProject?.id === projectId) {
        showDashboard();
      }

      renderProjects();
    } catch (error) {
      alert("Unable to delete project.");
    }
  }

  async function deleteArtifact(artifactId, artifactTitle) {
    if (!activeProject) {
      return;
    }

    const confirmed = await confirmWithModal({
      title: "Delete Artifact",
      message: `Delete "${artifactTitle}" from this project? This cannot be undone.`,
      confirmLabel: "Delete Artifact",
    });

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `/api/projects/${activeProject.id}/artifacts/${artifactId}`,
        { method: "DELETE" },
      );
      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Unable to delete artifact.");
        return;
      }

      activeProject = data.project;
      replaceProject(activeProject);

      if (activeArtifact?.id === artifactId) {
        clearActiveArtifactSession();
        clearTemplateSelection();
        activeContainer.classList.add("hidden");
      }

      renderProjects();
      renderArtifactSummary(activeProject);
    } catch (error) {
      alert("Unable to delete artifact.");
    }
  }

  async function deleteArtifactFromProject(projectId, artifactId, artifactTitle) {
    if (!activeProject || activeProject.id !== projectId) {
      await selectProject(projectId);
    }

    await deleteArtifact(artifactId, artifactTitle);
  }

  artifactForm.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  artifactExportButton.addEventListener("click", exportActiveArtifact);

  showProjectFormButton.addEventListener("click", showProjectForm);
  passwordToggleButtons.forEach((button) => {
    const input = document.getElementById(button.dataset.passwordTarget);
    if (input) {
      updatePasswordToggle(button, input);
    }

    button.addEventListener("click", () => togglePasswordVisibility(button));
  });

  projectForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setProjectMessage("Creating project...", "working");

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: projectName.value,
          sponsor: projectSponsor.value,
          objective: projectObjective.value,
        }),
      });

      const project = await response.json();

      if (!response.ok) {
        setProjectMessage(
          project.error ||
            "Project could not be created. Check the fields and try again.",
          "error",
        );
        return;
      }

      projectForm.reset();
      setProjectMessage("Project created.", "success");
      projectForm.classList.add("hidden");
      projects.unshift(project);
      renderProjects();
      selectProject(project.id);
    } catch (error) {
      setProjectMessage(
        "Project could not be created because the server is unreachable. Try again in a moment.",
        "error",
      );
    }
  });

  authModeButton.addEventListener("click", () => {
    passwordResetToken = null;
    authMode = authMode === "login" ? "signup" : "login";
    window.history.replaceState({}, "", window.location.pathname);
    updateAuthMode();
  });

  authResetRequestButton.addEventListener("click", () => {
    authMode = "forgot";
    updateAuthMode();
    authEmail.focus();
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    setAuthMessage("Working...", "working");

    const endpoint =
      authMode === "signup"
        ? "/api/auth/signup"
        : authMode === "forgot"
          ? "/api/auth/password-reset/request"
          : authMode === "reset"
            ? "/api/auth/password-reset/confirm"
            : "/api/auth/login";

    const payload = {};

    if (authMode === "signup") {
      payload.name = authName.value;
    }

    if (authMode !== "reset") {
      payload.email = authEmail.value;
    }

    if (authMode !== "forgot") {
      payload.password = authPassword.value;
    }

    if (authMode === "reset") {
      payload.token = passwordResetToken;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        setAuthMessage(data.error || "Authentication failed.", "error");
        return;
      }

      if (authMode === "forgot") {
        authForm.reset();
        if (data.resetUrl) {
          setAuthResetLink(data.resetUrl);
        } else {
          setAuthMessage(data.message, "success");
        }
        return;
      }

      if (authMode === "reset") {
        authForm.reset();
        passwordResetToken = null;
        authMode = "login";
        window.history.replaceState({}, "", window.location.pathname);
        updateAuthMode();
        setAuthMessage(
          "Password updated. Sign in with your new password.",
          "success",
        );
        return;
      }

      authForm.reset();
      showAppView(data.user);
    } catch (error) {
      setAuthMessage("Unable to reach the server.", "error");
    }
  });

  currentUserButton.addEventListener("click", openAccountModal);
  closeAccountModalButton.addEventListener("click", closeAccountModal);
  cancelAccountModalButton.addEventListener("click", closeAccountModal);
  changePasswordForm.addEventListener("submit", submitPasswordChange);
  accountModal.addEventListener("click", (event) => {
    if (event.target === accountModal) {
      closeAccountModal();
    }
  });
  closeConfirmModalButton.addEventListener("click", () => closeConfirmModal(false));
  cancelConfirmModalButton.addEventListener("click", () => closeConfirmModal(false));
  confirmModalSubmitButton.addEventListener("click", () => closeConfirmModal(true));
  confirmModal.addEventListener("click", (event) => {
    if (event.target === confirmModal) {
      closeConfirmModal(false);
    }
  });

  logoutButton.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });

      currentUser = null;
      projects = [];
      activeProject = null;
      clearActiveArtifactSession();
      clearTemplateSelection();
      showAuthView();
      updateAuthMode();
    } catch (error) {
      authMessage.textContent = "Unable to log out.";
    }
  });

  homeButton.addEventListener("click", () => {
    if (
      shouldConfirmRefresh() &&
      !confirm("Refresh and discard any unsaved changes?")
    ) {
      return;
    }

    window.location.reload();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (!confirmModal.classList.contains("hidden")) {
      closeConfirmModal(false);
      return;
    }

    if (!accountModal.classList.contains("hidden")) {
      closeAccountModal();
    }
  });

  updateAuthMode();
  if (passwordResetToken) {
    authMode = "reset";
    showAuthView();
    updateAuthMode();
  } else {
    loadCurrentUser();
  }
});
