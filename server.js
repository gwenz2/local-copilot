const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// Config
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TREE_ENTRIES = 10000;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".cache",
]);

// Safety: resolve and validate path stays within root
function safePath(rootDir, relativePath) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) {
    throw new Error("Project root must be an absolute path");
  }
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) {
    throw new Error("File path must be relative to the project root");
  }
  const root = path.resolve(rootDir);
  const target = path.resolve(rootDir, relativePath);
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Path traversal denied");
  }
  return target;
}

function validateRoot(rootDir) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) {
    throw new Error("Project root must be an absolute path");
  }
  const root = path.resolve(rootDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error("Project root does not exist or is not a directory");
  }
  return root;
}

// ── File Routes ──────────────────────────────────────────────

// List folder tree
app.post("/api/files/list", (req, res) => {
  const { rootDir } = req.body;
  if (!rootDir) return res.status(400).json({ error: "rootDir required" });
  let entryCount = 0;

  function walk(dir, base = "") {
    let results = [];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return results;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    for (const e of entries) {
      if (entryCount >= MAX_TREE_ENTRIES) break;
      if (e.name.startsWith(".") || IGNORED_DIRECTORIES.has(e.name)) continue;
      if (e.isSymbolicLink()) continue;
      entryCount += 1;
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) {
        results.push({
          name: e.name,
          path: rel,
          type: "dir",
          children: walk(path.join(dir, e.name), rel),
        });
      } else {
        results.push({ name: e.name, path: rel, type: "file" });
      }
    }
    return results;
  }

  try {
    const root = validateRoot(rootDir);
    const tree = walk(root);
    res.json({ tree, truncated: entryCount >= MAX_TREE_ENTRIES });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Read file
app.post("/api/files/read", (req, res) => {
  const { rootDir, filePath } = req.body;
  try {
    const abs = safePath(rootDir, filePath);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new Error("Path is not a file");
    if (stat.size > MAX_FILE_BYTES) {
      return res.status(413).json({ error: "File is larger than 2 MB" });
    }
    const content = fs.readFileSync(abs, "utf8");
    res.json({ content });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Write file
app.post("/api/files/write", (req, res) => {
  const { rootDir, filePath, content } = req.body;
  if (content === undefined || content === null) {
    return res.status(400).json({
      error:
        "Content is missing or undefined. The AI response may have been malformed.",
    });
  }
  try {
    const abs = safePath(rootDir, filePath);
    if (Buffer.byteLength(String(content), "utf8") > MAX_FILE_BYTES) {
      return res.status(413).json({ error: "File is larger than 2 MB" });
    }
    const created = !fs.existsSync(abs);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(content), "utf8");
    res.json({ success: true, created });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete is used by the local undo stack when an AI-created file is reverted.
app.post("/api/files/delete", (req, res) => {
  const { rootDir, filePath } = req.body;
  try {
    const abs = safePath(rootDir, filePath);
    if (!fs.existsSync(abs)) return res.json({ success: true });
    if (!fs.statSync(abs).isFile()) {
      return res.status(400).json({ error: "Only files can be deleted" });
    }
    fs.unlinkSync(abs);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Create new file
app.post("/api/files/create", (req, res) => {
  const { rootDir, filePath, content } = req.body;
  if (content === undefined || content === null) {
    return res.status(400).json({
      error:
        "Content is missing or undefined. The AI response may have been malformed.",
    });
  }
  try {
    const abs = safePath(rootDir, filePath);
    if (Buffer.byteLength(String(content), "utf8") > MAX_FILE_BYTES) {
      return res.status(413).json({ error: "File is larger than 2 MB" });
    }
    // If file exists, overwrite instead of erroring
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(content), "utf8");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/balance", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "No API key" });
  try {
    const response = await axios.get("https://api.deepseek.com/user/balance", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    res.json(response.data);
  } catch (e) {
    res
      .status(500)
      .json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ── AI Chat Route ────────────────────────────────────────────

app.post("/api/chat", async (req, res) => {
  const { messages, rootDir, openFiles } = req.body;
  const apiKey = req.headers["x-api-key"] || DEEPSEEK_API_KEY;
  if (!apiKey) return res.status(401).json({ error: "No API key provided" });

  // Build system prompt
  let systemPrompt = `You are an AI coding assistant (like GitHub Copilot) with direct access to the user local project files.

CRITICAL RULES when suggesting file changes:
- ALWAYS include the FULL file content in the "content" field. Never use placeholders like "..." or "rest of file unchanged".
- The JSON must be valid. Escape newlines as \\n, quotes as \\", backslashes as \\\\.
- ALWAYS include both "filePath" AND "content" in every apply block.

To edit an existing file, output EXACTLY this format (single JSON object, no extra text inside the block):
\`\`\`apply
{"action":"write","filePath":"relative/path/file.php","content":"full file content here with \\n for newlines"}
\`\`\`

To create a new file:
\`\`\`apply
{"action":"create","filePath":"relative/path/newfile.php","content":"full file content here"}
\`\`\`

Project root: ${rootDir || "(not set)"}`;

  if (openFiles && openFiles.length > 0) {
    systemPrompt += "\n\nCurrently open files:\n";
    for (const f of openFiles) {
      systemPrompt += `\n### ${f.path}\n\`\`\`\n${f.content}\n\`\`\`\n`;
    }
  }

  try {
    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: "deepseek-v4-flash",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: false,
        max_tokens: 4096,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    res.json({ message: response.data.choices[0].message });
  } catch (e) {
    const errMsg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: errMsg });
  }
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

if (require.main === module) {
  app.listen(PORT, HOST, () =>
    console.log(`AI Copilot server running at http://${HOST}:${PORT}`),
  );
}

module.exports = { app, safePath, validateRoot };
