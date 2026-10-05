const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { app } = require('../server');

test('folder browser lists directories only and rejects invalid paths', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-browse-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.writeFileSync(path.join(root, 'private.txt'), 'not directory context');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const request = body => fetch(`http://127.0.0.1:${server.address().port}/api/folders/list`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const response = await request({ folderPath: root });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.folderPath, root);
  assert.equal(data.parentPath, path.dirname(root));
  assert.deepEqual(data.folders, [{ name: 'src', path: path.join(root, 'src') }]);
  assert.equal((await request({ folderPath: 'relative' })).status, 400);
  assert.equal((await request({ folderPath: path.join(root, 'private.txt') })).status, 400);
  assert.equal((await request({ folderPath: 42 })).status, 400);
  const roots = await (await request({ folderPath: null })).json();
  assert.equal(roots.folderPath, null);
  assert.ok(roots.folders.length > 0);
});

function projectHarness() {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const start = html.indexOf('      function projectSessionKey(');
  const end = html.indexOf('      function renderTree(', start);
  const input = { value: 'C:/second' };
  const store = new Map();
  const state = { rootDir: 'C:/first', loading: false, openTabs: [], activeTab: null, messages: [{ role: 'user', content: 'first project' }], contextFiles: ['first.js'] };
  const applyHistory = [{ filePath: 'first.js' }];
  const context = { state, applyHistory, alerts: [], localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) }, document: { getElementById: () => input }, api: async (_, body) => ({ rootDir: body.rootDir, tree: [] }) };
  context.alert = message => context.alerts.push(message);
  for (const name of ['saveState', 'renderTabs', 'renderEditor', 'renderContextChips', 'renderContextList', 'renderMessages', 'updateUndoBtn', 'updateTokenEst', 'renderTree']) context[name] = () => {};
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  return { context, state, input, store, applyHistory };
}

test('project switching isolates chat and context and clears stale edit targets', async () => {
  const { context, state, input, applyHistory } = projectHarness();
  state.openTabs.push({ path: 'first.js', modified: false });
  assert.equal(await context.loadTree(), true);
  assert.equal(state.rootDir, 'C:/second');
  assert.equal(state.messages.length, 0);
  assert.equal(state.contextFiles.length, 0);
  assert.equal(state.openTabs.length, 0);
  assert.equal(applyHistory.length, 0);
  input.value = 'C:/first';
  await context.loadTree();
  assert.equal(state.messages[0].content, 'first project');
  assert.equal(state.contextFiles[0], 'first.js');
});

test('project switching protects modified buffers and keeps root on failed load', async () => {
  const { context, state, input } = projectHarness();
  state.openTabs.push({ path: 'first.js', modified: true });
  assert.equal(await context.loadTree(), false);
  assert.equal(state.rootDir, 'C:/first');
  state.openTabs = [];
  input.value = 'C:/missing';
  context.api = async () => { throw new Error('missing folder'); };
  assert.equal(await context.loadTree(), false);
  assert.equal(state.rootDir, 'C:/first');
  assert.equal(state.messages[0].content, 'first project');
});
