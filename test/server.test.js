const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { app, safePath, validateRoot } = require("../server");

test("safePath keeps files inside the selected project", () => {
  const root = path.resolve(os.tmpdir(), "copilot-project");
  assert.equal(
    safePath(root, "src/index.js"),
    path.join(root, "src", "index.js"),
  );
  assert.throws(() => safePath(root, "../copilot-project-copy/secret.txt"));
  assert.throws(() => safePath(root, path.resolve(root, "absolute.txt")));
});

test("safePath requires an absolute project root", () => {
  assert.throws(() => safePath("relative/project", "index.js"));
});

test("validateRoot accepts directories and rejects missing paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-test-"));
  try {
    assert.equal(validateRoot(root), path.resolve(root));
    assert.throws(() => validateRoot(path.join(root, "missing")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("file API can write, read, and delete within a project", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-api-"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (endpoint, body) =>
    fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const writeResponse = await request("/api/files/write", {
    rootDir: root,
    filePath: "src/test.txt",
    content: "hello",
  });
  assert.equal(writeResponse.status, 200);
  assert.deepEqual(await writeResponse.json(), { success: true, created: true });

  const readResponse = await request("/api/files/read", {
    rootDir: root,
    filePath: "src/test.txt",
  });
  assert.equal(readResponse.status, 200);
  assert.deepEqual(await readResponse.json(), { content: "hello" });

  const escapeResponse = await request("/api/files/read", {
    rootDir: root,
    filePath: "../outside.txt",
  });
  assert.equal(escapeResponse.status, 400);

  const deleteResponse = await request("/api/files/delete", {
    rootDir: root,
    filePath: "src/test.txt",
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal(fs.existsSync(path.join(root, "src", "test.txt")), false);
});
