const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createConnections}=require('../connections');
const {createLocalState}=require('../local-state');

function fixture(t,env={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'draftdrion-connections-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  return {directory,connections:createConnections(directory,env)};
}
function draft(connections,changes={}) {const current=connections.status();return {revision:current.revision,obsidianUrl:current.obsidianUrl,projects:current.projects,...changes};}

test('connections import once, share changes across editions and never return credentials',t=>{
  const {directory,connections:web}=fixture(t,{THESYS_API_KEY:'first-secret',OBSIDIAN_MCP_URL:'http://127.0.0.1:9988/mcp',OBSIDIAN_MCP_AUTHORIZATION:'Bearer memory-secret',OBSIDIAN_PROJECTS:JSON.stringify({[path.resolve('project')]:'02 - Projects/Active/Example'})});
  const desktop=createConnections(directory,{THESYS_API_KEY:'must-not-overwrite'});
  assert.equal(desktop.env().THESYS_API_KEY,'first-secret');
  const publicResult=web.save(draft(web,{openuiKey:'replacement-secret'}));
  assert.equal(desktop.env().THESYS_API_KEY,'replacement-secret');
  assert.equal(desktop.env().OBSIDIAN_MCP_AUTHORIZATION,'Bearer memory-secret');
  assert.equal(publicResult.openuiConfigured,true);
  assert.ok(!JSON.stringify(publicResult).includes('secret'));
  web.save(draft(web,{removeOpenuiKey:true,removeObsidianAuthorization:true}));
  assert.equal(createConnections(directory,{THESYS_API_KEY:'old-env-key'}).env().THESYS_API_KEY,'');
  assert.equal(desktop.status().obsidianConfigured,false);
});

test('connections validate local endpoints, mappings and stale saves',t=>{
  const {connections}=fixture(t);
  for(const address of ['https://remote.example/mcp','http://127.0.0.1:123/mcp?key=secret','file:///mcp','http://key:secret@localhost/mcp'])assert.throws(()=>connections.save(draft(connections,{obsidianUrl:address})),/local/);
  assert.throws(()=>connections.save(draft(connections,{projects:{relative:'02 - Projects/Active/Example'}})),/Map/);
  assert.throws(()=>connections.save(draft(connections,{projects:{[path.resolve('project')]:'../Private'}})),/Map/);
  assert.throws(()=>connections.save(draft(connections,{openuiKey:'bad\nkey'})),/credential/);
  const stale=draft(connections);
  connections.save(draft(connections,{obsidianUrl:'http://localhost:9999/mcp'}));
  assert.throws(()=>connections.save(stale),{status:409});
  assert.equal(connections.status().obsidianUrl,'http://localhost:9999/mcp');
});

test('corrupt connections fail closed without replacing saved data',t=>{
  const {directory,connections}=fixture(t);
  fs.writeFileSync(path.join(directory,'connections.json'),'not json');
  assert.throws(()=>connections.status(),/Preserve/);
  assert.throws(()=>createConnections(directory,{}).env(),/Preserve/);
  assert.equal(fs.readFileSync(path.join(directory,'connections.json'),'utf8'),'not json');
});

test('provider credentials and activity history are shared laptop files',t=>{
  const {directory}=fixture(t);
  const web=createLocalState(directory),desktop=createLocalState(directory);
  web.saveCredential('openai','sample-key');
  assert.equal(desktop.credentials().openai,'sample-key');
  const history=JSON.stringify({projects:{demo:[{id:'run-1',events:[{at:'2026-10-21T00:00:00Z',text:'Started'}]}]}});
  web.patch({activityHistory:history});
  assert.equal(desktop.snapshot().activityHistory,history);
});

test('connection routes reject cross-site writes and reveal only public status',async t=>{
  const {directory}=fixture(t);
  process.env.CODEBENCH_DATA_DIR=directory;
  process.env.DRAFTDRION_ENV_FILE=path.join(directory,'absent.env');
  const {app}=require('../server');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  const current=await (await request('/api/connections/status',{})).json();
  const payload={revision:current.revision,obsidianUrl:'http://localhost:9988/mcp',projects:{},openuiKey:'route-secret',obsidianAuthorization:'Bearer route-memory-secret'};
  const denied=await request('/api/connections/save',payload,{origin:'https://attacker.example','sec-fetch-site':'cross-site'});
  assert.equal(denied.status,403);
  const saved=await request('/api/connections/save',payload);
  assert.equal(saved.status,200);
  const responseText=await saved.text();
  assert.ok(!responseText.includes('route-secret'));
  assert.ok(!responseText.includes('route-memory-secret'));
  const providers=await (await request('/api/providers',{})).json();
  assert.equal(providers.serverKeys.openui,true);
  assert.equal(providers.obsidianConfigured,true);
});
