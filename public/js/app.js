document.addEventListener("DOMContentLoaded", () => {
  const menuList = document.getElementById("template-menu-list");
  const welcomeMessage = document.getElementById("welcome-message");
  const activeContainer = document.getElementById("active-template-container");
  const templateTitle = document.getElementById("template-title");
  const templateDescription = document.getElementById("template-description");
  const fieldsBucket = document.getElementById("form-fields-bucket");
  const artifactForm = document.getElementById("artifact-form");

  fetch("/api/templates")
    .then((res) => res.json())
    .then((templates) => {
      menuList.innerHTML = "";
      templates.forEach((tpl) => {
        const li = document.createElement("li");
        li.textContent = tpl.title;
        li.addEventListener("click", () => loadTemplateWorkspace(tpl.id, li));
        menuList.appendChild(li);
      });
    })
    .catch((err) => {
      menuList.innerHTML =
        '<li style="color:red;">Error fetching template directory metadata payloads.</li>';
    });

  function loadTemplateWorkspace(templateId, clickedElement) {
    document
      .querySelectorAll("#template-menu-list li")
      .forEach((el) => el.classList.remove("active"));
    clickedElement.classList.add("active");

    fetch(`/api/templates/${templateId}`)
      .then((res) => res.json())
      .then((data) => {
        welcomeMessage.classList.add("hidden");
        activeContainer.classList.remove("hidden");

        templateTitle.textContent = data.title;
        templateDescription.textContent = data.description;

        fieldsBucket.innerHTML = "";
        data.fields.forEach((field) => {
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

          // CRITICAL ATTRIBUTE SETUP FOR MICROSOFT COPILOT STUDIO AGENT INTEGRATION:
          // Unique HTML IDs guarantee your Phase 2 conversation agent topics
          // can target, map, and inject extracted slot values directly into the canvas.
          input.id = field.id;
          input.className = "form-control";
          input.placeholder = field.placeholder;

          group.appendChild(label);
          group.appendChild(input);
          fieldsBucket.appendChild(group);
        });
      });
  }

  artifactForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const outputs = {};
    const inputs = fieldsBucket.querySelectorAll(".form-control");
    inputs.forEach((input) => {
      outputs[input.id] = input.value;
    });
    console.log("Artifact Export Data Trace:", outputs);
    alert(
      "Form extraction verified! Check your web browser console to view JSON document schema structures.",
    );
  });
});
