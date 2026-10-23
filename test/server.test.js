const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testData=fs.mkdtempSync(path.join(os.tmpdir(),'draftdrion-server-state-'));
process.env.CODEBENCH_DATA_DIR=testData;
process.env.DRAFTDRION_ENV_FILE=path.join(testData,'absent.env');
const { app, safePath, validateRoot } = require("../server");
test.after(()=>fs.rmSync(testData,{recursive:true,force:true}));

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

  const conflict=await request('/api/files/write',{rootDir:root,filePath:'src/test.txt',content:'overwritten',expectedContent:'stale'});
  assert.equal(conflict.status,409);
  assert.equal(fs.readFileSync(path.join(root,'src/test.txt'),'utf8'),'hello');
  assert.equal((await request('/api/files/write',{rootDir:root,filePath:'src/test.txt',content:'overwritten',expectMissing:true})).status,409);
  assert.equal((await request('/api/files/delete',{rootDir:root,filePath:'src/test.txt',expectedContent:'stale'})).status,409);

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

test("OpenUI frame and local renderer assets are served with network actions blocked", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const view = await fetch(base + "/openui-view.html");
  assert.equal(view.status, 200);
  assert.match(await view.text(), /connect-src 'none'; form-action 'none'/);
  for (const asset of ["openui-bundle.min.js", "openui-styles.css"]) {
    const response = await fetch(base + "/vendor/openui/" + asset);
    assert.equal(response.status, 200);
    assert.ok(Number(response.headers.get("content-length")) > 0);
    await response.body.cancel();
  }
});

test("Obsidian modes validate all providers, Off never connects, and nonlocal requests are denied", async (t) => {
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>server.close());
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/obsidian/status`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openai',obsidianMode:'off'})});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{connected:false,mode:'off',project:null});
  const invalid=await fetch(`http://127.0.0.1:${server.address().port}/api/obsidian/status`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openai',obsidianMode:'invalid'})});assert.equal(invalid.status,400);
  for (const headers of [{host:'untrusted.example'},{origin:'https://untrusted.example'}]) {
    // Native fetch rewrites Host; use HTTP directly to exercise hostile headers.
    const status=await new Promise((resolve,reject)=>{
      const request=require('node:http').request({hostname:'127.0.0.1',port:server.address().port,path:'/api/obsidian/status',method:'POST',headers:{'content-type':'application/json',...headers}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
      request.on('error',reject);
      request.end(JSON.stringify({provider:'openui'}));
    });
    assert.equal(status,403);
  }
  for(const endpoint of ['/API/EXPLORER/ACTION/','/API/EXPLORER/UNDO/','/API/EXPLORER/HISTORY/','/API/OBSIDIAN/STATUS/','/API/OBSIDIAN/CHANGES/','/API/CHAT/','/API/LOCAL-STATE/','/API/LOCAL-CREDENTIALS/','/API/LOCAL-STATE/BOOTSTRAP/']) {
    const denied=await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`,{method:'POST',headers:{'content-type':'application/json',origin:'https://untrusted.example'},body:'{"provider":"openui","useObsidian":true}'});
    assert.equal(denied.status,403);
  }
});

test("unavailable Obsidian MCP returns a useful status without exposing credentials", async (t) => {
  const priorUrl=process.env.OBSIDIAN_MCP_URL,priorAuth=process.env.OBSIDIAN_MCP_AUTHORIZATION;
  const connections=require('../connections').createConnections(testData);
  const previous=connections.env();
  connections.save({...connections.status(),obsidianUrl:'http://127.0.0.1:1/mcp/',obsidianAuthorization:'test-private-credential'});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{
    server.closeAllConnections();server.close();
    connections.save({...connections.status(),obsidianUrl:previous.OBSIDIAN_MCP_URL,obsidianAuthorization:previous.OBSIDIAN_MCP_AUTHORIZATION,removeObsidianAuthorization:!previous.OBSIDIAN_MCP_AUTHORIZATION});
    if(priorUrl===undefined) delete process.env.OBSIDIAN_MCP_URL; else process.env.OBSIDIAN_MCP_URL=priorUrl;
    if(priorAuth===undefined) delete process.env.OBSIDIAN_MCP_AUTHORIZATION; else process.env.OBSIDIAN_MCP_AUTHORIZATION=priorAuth;
  });
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/obsidian/status`,{method:'POST',headers:{'content-type':'application/json'},body:'{"provider":"openui","obsidianMode":"read-only"}'});
  assert.equal(response.status,503);
  const text=await response.text();
  assert.match(text,/Open Obsidian/);
  assert.ok(!text.includes('test-private-credential'));
});


test('agent settings are server-owned, shared and protected from foreign origins',async t=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const post=(route,body,headers={})=>fetch(origin+route,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const initial=await(await post('/api/agent/settings',{})).json();
 assert.equal(initial.settings.repository,true);assert.equal(initial.settings.terminal,'ask');
 const updated=await(await post('/api/agent/settings/save',{settings:{...initial.settings,repository:false,terminal:'off'},revision:initial.revision})).json();
 assert.equal((await(await post('/api/agent/settings',{})).json()).settings.repository,false);
 assert.equal((await post('/api/agent/settings/save',{settings:initial.settings,revision:initial.revision})).status,409);
 assert.equal((await post('/api/agent/settings',{}, {origin:'http://127.0.0.1:1'})).status,403);
 assert.equal((await post('/api/agent/approval',{id:'invented',approved:true})).status,400);
 assert.equal((await post('/api/agent/settings/save',{settings:initial.settings,revision:updated.revision})).status,200);
});
