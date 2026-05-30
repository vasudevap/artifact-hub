import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const app = express();
const PORT = 3000;

// Resolve paths for modern ES Modules on macOS
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// API Route: Fetch clean summaries for navigation sidebar menu construction
app.get("/api/templates", async (req, res) => {
  try {
    const data = await fs.readFile(
      path.join(__dirname, "data", "templates.json"),
      "utf-8",
    );
    const templates = JSON.parse(data);
    const summary = Object.keys(templates).map((key) => ({
      id: key,
      title: templates[key].title,
      description: templates[key].description,
    }));
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: "Failed to read template definitions." });
  }
});

// API Route: Fetch functional breakdown fields matrix for selected workspace index canvas
app.get("/api/templates/:id", async (req, res) => {
  try {
    const data = await fs.readFile(
      path.join(__dirname, "data", "templates.json"),
      "utf-8",
    );
    const templates = JSON.parse(data);
    const template = templates[req.params.id];

    if (!template) {
      return res
        .status(404)
        .json({ error: "Template workspace matrix target layout not found." });
    }
    res.json(template);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch template detail structural breakdown." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 ArtifactHub Base running at: http://localhost:3000`);
});
