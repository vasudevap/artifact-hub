import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const stagedMode = process.argv.includes("--staged");
const allowedDataFiles = new Set(["data/.gitignore", "data/templates.json"]);
const allowedRootFiles = new Set([
  ".env.example",
  ".gitignore",
  "README.md",
  "ai-service.js",
  "artifact-service.js",
  "config.js",
  "export-service.js",
  "index.html",
  "migrations.js",
  "package-lock.json",
  "package.json",
  "phase1-routes.js",
  "phase1-storage.js",
  "render.yaml",
  "review-service.js",
  "server.js",
  "storage.js",
  "template-service.js",
  "tsconfig.json",
  "vite.config.ts",
]);
const allowedRootDirectories = new Set([
  ".github",
  ".githooks",
  "data",
  "db",
  "public",
  "scripts",
  "src",
  "tests",
]);
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function splitNullTerminated(output) {
  return output.split("\0").filter(Boolean);
}

function getCandidatePaths() {
  const tracked = splitNullTerminated(runGit(["ls-files", "-z", "--cached"]));

  if (stagedMode) {
    return tracked;
  }

  const untracked = splitNullTerminated(
    runGit(["ls-files", "-z", "--others", "--exclude-standard"]),
  );
  return [...new Set([...tracked, ...untracked])].filter((filePath) =>
    existsSync(path.join(repoRoot, filePath)),
  );
}

function readCandidate(filePath) {
  if (stagedMode) {
    return runGit(["show", `:${filePath}`]);
  }

  return readFileSync(path.join(repoRoot, filePath), "utf8");
}

function pathViolation(filePath) {
  const [rootEntry] = filePath.split("/");
  const isRootFile = !filePath.includes("/");

  if (
    (isRootFile && !allowedRootFiles.has(filePath)) ||
    (!isRootFile && !allowedRootDirectories.has(rootEntry))
  ) {
    return "path is outside the approved public repository structure";
  }

  if (filePath.startsWith("data/") && !allowedDataFiles.has(filePath)) {
    return "mutable runtime data";
  }

  if (
    filePath !== ".env.example" &&
    (filePath === ".env" || filePath.startsWith(".env."))
  ) {
    return "environment file";
  }

  if (/\.(docx?|pdf|pptx?|xlsx?)$/i.test(filePath)) {
    return "document artifact";
  }

  if (/capture.*screenshots?/i.test(filePath)) {
    return "private screenshot tooling";
  }

  if (filePath.endsWith(".md") && filePath !== "README.md") {
    return "public documentation is limited to README.md";
  }

  return null;
}

const documentationPatterns = [
  [/\bimplementation plan\b/i, "private planning reference"],
  [/\bdelivery roadmap\b/i, "private planning reference"],
  [/\bproduct planning\b/i, "private planning reference"],
  [/\bphase\s+[0-9]+\b/i, "private phase reference"],
  [/(^|[("'`])docs\//im, "private documentation link"],
  [/(^|[("'`])\.private\//im, "private workspace link"],
  [/\/Users\/[^/\s]+/i, "local absolute path"],
  [/file:\/\//i, "local file URL"],
];

const secretPatterns = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "GitHub token"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, "GitHub token"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/, "API key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/, "Slack token"],
  [
    /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@/i,
    "PostgreSQL URL containing credentials",
  ],
];

const errors = [];
const candidatePaths = getCandidatePaths();

for (const filePath of candidatePaths) {
  const violation = pathViolation(filePath);
  if (violation) {
    errors.push(`${filePath}: ${violation}`);
    continue;
  }

  if (!textExtensions.has(path.extname(filePath).toLowerCase())) {
    continue;
  }

  let content;
  try {
    content = readCandidate(filePath);
  } catch (error) {
    errors.push(`${filePath}: could not inspect content (${error.message})`);
    continue;
  }

  if (filePath === "README.md") {
    for (const [pattern, label] of documentationPatterns) {
      if (pattern.test(content)) {
        errors.push(`${filePath}: ${label}`);
      }
    }
  }

  if (filePath !== "scripts/check-public-boundary.js") {
    for (const [pattern, label] of secretPatterns) {
      if (pattern.test(content)) {
        errors.push(`${filePath}: possible ${label}`);
      }
    }
  }

  if (
    filePath.endsWith(".json") &&
    /"(?:passwordHash|sessionToken|resetToken|token)"\s*:\s*"[^"]{20,}"/i.test(
      content,
    )
  ) {
    errors.push(`${filePath}: possible committed credential or session record`);
  }
}

if (errors.length > 0) {
  console.error(
    `Public repository boundary check failed (${stagedMode ? "index" : "working tree"}):`,
  );
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `Public repository boundary check passed (${stagedMode ? "index" : "working tree"}).`,
);
