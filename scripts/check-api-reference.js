import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const stagedMode = process.argv.includes("--staged");
const routeFiles = [
  { filePath: "server.js", receiver: "app", prefix: "" },
  { filePath: "phase1-routes.js", receiver: "router", prefix: "/api" },
];

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readCandidate(filePath) {
  if (stagedMode) {
    return runGit(["show", `:${filePath}`]);
  }

  return readFileSync(path.join(repoRoot, filePath), "utf8");
}

function normalizeRoutePath(routePath) {
  return routePath.replace(/\?.*$/, "").replace(/\/+$/, "") || "/";
}

function expandDynamicRoute(pathTemplate) {
  if (pathTemplate.includes("${path}")) {
    return ["confirm", "reject"].map((value) =>
      pathTemplate.replace("${path}", value),
    );
  }

  return [pathTemplate];
}

function routeAccess(source, receiver, routePath, argsBeforeHandler) {
  if (receiver === "router") {
    return "authenticated";
  }

  if (argsBeforeHandler.includes("requireAdmin")) {
    return "admin";
  }

  if (argsBeforeHandler.includes("requireAuth")) {
    return "authenticated";
  }

  if (["/api/auth/me", "/api/auth/logout"].includes(routePath)) {
    return "optional-session";
  }

  return "public";
}

function extractRoutes({ filePath, receiver, prefix }) {
  const source = readCandidate(filePath);
  const quotePattern = "[`'\\\"]";
  const routePattern = new RegExp(
    "\\b" +
      receiver +
      "\\.(get|post|put|patch|delete)\\s*\\(\\s*(" +
      quotePattern +
      ")([^`'\\\"]+)\\2([\\s\\S]*?)(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{",
    "g",
  );
  const routes = [];
  let match;

  while ((match = routePattern.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const rawPath = match[3];

    if (receiver === "app" && !rawPath.startsWith("/api/")) {
      continue;
    }

    for (const expandedPath of expandDynamicRoute(rawPath)) {
      const routePath = normalizeRoutePath(`${prefix}${expandedPath}`);
      routes.push({
        method,
        path: routePath,
        access: routeAccess(source, receiver, routePath, match[4]),
        source: filePath,
      });
    }
  }

  return routes;
}

function documentedMethodRoutes(readmeContent) {
  const prepared = readmeContent.replace(/`\s*\+\s*`/g, "");
  const routePattern =
    /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[A-Za-z0-9_~:/.-]+(?:\?[A-Za-z0-9_~:=&|.-]+)?)/g;
  const documented = new Set();
  let match;

  while ((match = routePattern.exec(prepared)) !== null) {
    documented.add(`${match[1]} ${normalizeRoutePath(match[2])}`);
  }

  return documented;
}

function documentedRouteRows(readmeContent) {
  const prepared = readmeContent.replace(/`\s*\+\s*`/g, "");
  const routePattern =
    /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[A-Za-z0-9_~:/.-]+(?:\?[A-Za-z0-9_~:=&|.-]+)?)/g;
  const rows = new Map();

  for (const line of prepared.split("\n")) {
    if (!line.includes("|") || !line.includes("/api/")) {
      continue;
    }

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) {
      continue;
    }

    let match;
    while ((match = routePattern.exec(cells[0])) !== null) {
      rows.set(`${match[1]} ${normalizeRoutePath(match[2])}`, {
        auth: cells[1],
        line: line.trim(),
      });
    }
    routePattern.lastIndex = 0;
  }

  return rows;
}

function hasAdminSummary(readmeContent) {
  return readmeContent
    .replace(/\s+/g, " ")
    .includes("| `/api/admin/*` | Admin |");
}

function routeLabel(route) {
  return `${route.method} ${route.path}`;
}

function expectedAuthLabel(access) {
  if (access === "public") return "No";
  if (access === "optional-session") return "Optional session";
  if (access === "admin") return "Admin";
  return "Yes";
}

const routes = routeFiles.flatMap(extractRoutes);
const uniqueRoutes = Array.from(
  new Map(routes.map((route) => [routeLabel(route), route])).values(),
).sort((a, b) => routeLabel(a).localeCompare(routeLabel(b)));
const readmeContent = readCandidate("README.md");
const documented = documentedMethodRoutes(readmeContent);
const documentedRows = documentedRouteRows(readmeContent);
const adminSummaryPresent = hasAdminSummary(readmeContent);
const adminRoutes = uniqueRoutes.filter((route) => route.path.startsWith("/api/admin/"));
const adminAccessViolations = adminRoutes.filter((route) => route.access !== "admin");
const coveredByAdminSummary = (route) =>
  route.path.startsWith("/api/admin/") &&
  route.access === "admin" &&
  adminSummaryPresent;
const missing = uniqueRoutes.filter(
  (route) => !coveredByAdminSummary(route) && !documented.has(routeLabel(route)),
);
const missingRows = uniqueRoutes.filter(
  (route) => !coveredByAdminSummary(route) && !documentedRows.has(routeLabel(route)),
);
const mismatchedAuth = uniqueRoutes.filter((route) => {
  const row = documentedRows.get(routeLabel(route));
  return row && row.auth !== expectedAuthLabel(route.access);
});

if (
  missing.length > 0 ||
  missingRows.length > 0 ||
  mismatchedAuth.length > 0 ||
  adminAccessViolations.length > 0 ||
  (adminRoutes.length > 0 && !adminSummaryPresent)
) {
  console.error("API reference drift check failed.");

  if (missing.length > 0) {
    console.error(
      "README.md is missing method/path entries for these implemented API routes:",
    );
    for (const route of missing) {
      console.error(
        `- ${routeLabel(route)} (${route.access}, declared in ${route.source})`,
      );
    }
  }

  if (missingRows.length > 0) {
    console.error(
      "README.md mentions these routes outside the API reference tables, but they need table rows with auth classification:",
    );
    for (const route of missingRows) {
      console.error(
        `- ${routeLabel(route)} (${route.access}, declared in ${route.source})`,
      );
    }
  }

  if (mismatchedAuth.length > 0) {
    console.error("README.md has stale auth classifications:");
    for (const route of mismatchedAuth) {
      const row = documentedRows.get(routeLabel(route));
      console.error(
        `- ${routeLabel(route)} expected "${expectedAuthLabel(route.access)}" but found "${row.auth}".`,
      );
    }
  }

  if (adminRoutes.length > 0 && !adminSummaryPresent) {
    console.error(
      "README.md must include a summarized `/api/admin/*` Admin row for administrator-only operational APIs.",
    );
  }

  if (adminAccessViolations.length > 0) {
    console.error("Admin API routes must remain administrator-only:");
    for (const route of adminAccessViolations) {
      console.error(
        `- ${routeLabel(route)} expected "admin" access but found "${route.access}".`,
      );
    }
  }

  console.error(
    "Update the README.md API Reference when route behavior changes, or adjust this check if a route is intentionally internal and should not be public-facing documentation.",
  );
  process.exit(1);
}

console.log(
  `API reference drift check passed (${uniqueRoutes.length} implemented API routes covered).`,
);
