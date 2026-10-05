const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("inline frontend scripts have valid JavaScript syntax", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "public", "index.html"),
    "utf8",
  );
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter(Boolean);

  assert.ok(scripts.length > 0);
  scripts.forEach((source, index) => {
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: `inline-${index}.js` }),
    );
  });
});

// Check the local deferred modules as well as inline startup code.
test("local frontend modules have valid JavaScript syntax", () => {
  for (const name of ["folder-browser.js", "provider-settings.js", "workbench.js"]) {
    const source=fs.readFileSync(path.join(__dirname,"..","public",name),"utf8");
    assert.doesNotThrow(()=>new vm.Script(source,{filename:name}));
  }
});
