import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

function displayValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        item && typeof item === "object"
          ? Object.entries(item)
              .filter(([, entry]) => String(entry || "").trim())
              .map(([key, entry]) => `${key}: ${entry}`)
              .join(" | ")
          : String(item || ""),
      )
      .filter(Boolean)
      .join("\n");
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${displayValue(entry)}`)
      .join("\n");
  }

  return String(value || "").trim();
}

function renderArtifactMarkdown({ artifact, project, template, version }) {
  const draftLabel = version ? `Approved version ${version.versionNumber}` : "Draft";
  const lines = [
    `# ${artifact.title || template.title}`,
    "",
    `Project: ${project.name}`,
    `Template: ${template.title}`,
    `Status: ${draftLabel}`,
    "",
  ];

  for (const field of template.fields) {
    const value = displayValue(artifact.fieldValues?.[field.id]);
    lines.push(`## ${field.label}`, "", value || "_Not provided._", "");
  }

  return `${lines.join("\n").trim()}\n`;
}

async function renderArtifactDocx({ artifact, project, template, version }) {
  const status = version
    ? `Approved version ${version.versionNumber}`
    : "Draft - not approved";
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun(artifact.title || template.title)],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: project.name, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun(status)],
    }),
  ];

  for (const field of template.fields) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun(field.label)],
      }),
    );
    const value = displayValue(artifact.fieldValues?.[field.id]);
    for (const line of (value || "Not provided.").split("\n")) {
      children.push(new Paragraph(line));
    }
  }

  const document = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(document);
}

function slugifyFilename(value) {
  return (
    String(value || "artifact")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "artifact"
  );
}

export {
  displayValue,
  renderArtifactDocx,
  renderArtifactMarkdown,
  slugifyFilename,
};
