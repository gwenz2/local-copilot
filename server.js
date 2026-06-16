const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// Config
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";

// Safety: resolve and validate path stays within root
function safePath(rootDir, relativePath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(rootDir, relativePath);
  if (!target.startsWith(root)) throw new Error("Path traversal denied");
  return target;
}

// ── File Routes ──────────────────────────────────────────────

// List folder tree
app.post("/api/files/list", (req, res) => {
  const { rootDir } = req.body;
  if (!rootDir) return res.status(400).json({ error: "rootDir required" });

  function walk(dir, base = "") {
    let results = [];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
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
    const tree = walk(rootDir);
    res.json({ tree });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Read file
app.post("/api/files/read", (req, res) => {
  const { rootDir, filePath } = req.body;
  try {
    const abs = safePath(rootDir, filePath);
    const content = fs.readFileSync(abs, "utf8");
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(content), "utf8");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`AI Copilot server running at http://localhost:${PORT}`),
);
