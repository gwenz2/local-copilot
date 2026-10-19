const test = require('node:test');
const assert = require('node:assert/strict');
const {createObsidianSession,allowedNote,allowedWrite,projectFolder,memoryMode} = require('../obsidian-memory');

const folder = '02 - Projects/Active/AI Copilot';
const env = {OBSIDIAN_MCP_URL:'http://127.0.0.1:27123/mcp/',OBSIDIAN_MCP_AUTHORIZATION:'test-only',OBSIDIAN_PROJECTS:JSON.stringify({'C:/workspace/copilot':folder})};
function fixture(access = 'internal') {
  const calls=[];
  const client={
    callTool:async request => {
      calls.push(request);
      const result = request.name === 'search_query'
        ? [{filename:'AGENTS.md',result:'AGENTS.md'},{filename:folder+'/memory.md',result:folder+'/memory.md'},{filename:'01 - Business/private.md',result:'never forward this'}]
        : {path:request.arguments.path,frontmatter:access ? {ai_access:access} : {},content:'Safe example project memory'};
      return {content:[{type:'text',text:JSON.stringify(result)}]};
    },
    close:async()=>{},
  };
  return {calls,client};
}

test('note scope rejects traversal, private folders, logs, archives and unrelated projects', () => {
  assert.equal(allowedNote('AGENTS.md'),true);
  assert.equal(allowedNote(folder+'/docs/decisions/example.md',folder),true);
  for(const note of ['../me.md','/me.md','C:/me.md','me.md%00','a\\me.md',folder+'-copy/memory.md',folder+'/logs/trace.md',folder+'/secret.md',folder+'/archive/old.md',folder+'/unclassified.txt','02 - Projects/Active/Other/memory.md']) {
    assert.equal(allowedNote(note,folder),false,note);
  }
  assert.equal(projectFolder('C:/workspace/copilot',env),folder);
  assert.equal(projectFolder('C:/workspace/other',env),'');
  assert.throws(()=>projectFolder('C:/workspace/copilot',{...env,OBSIDIAN_PROJECTS:JSON.stringify({'C:/workspace/copilot':'../Private'})}));
});

test('only allowlisted read tools reach MCP and search results contain permitted paths only', async () => {
  const {calls,client}=fixture();
  const session=await createObsidianSession({rootDir:'C:/workspace/copilot',env,connect:async()=>client});
  assert.deepEqual(session.tools.map(tool=>tool.function.name),['obsidian_search','obsidian_read']);
  assert.deepEqual(await session.call('obsidian_search',{query:'example'}),{paths:['AGENTS.md',folder+'/memory.md']});
  assert.equal(session.metadata().searches,1);
  assert.match(JSON.stringify(calls[0]),/frontmatter.ai_access/);
  assert.match(JSON.stringify(calls[0]),/internal/);
  const before=calls.length;
  for(const [name,args] of [['vault_write',{path:'AGENTS.md',content:'overwrite'}],['obsidian_read',{path:'../me.md'}],['obsidian_read',{path:'AGENTS.md',tool:'vault_delete'}],['obsidian_search',{query:'x'}]]) await assert.rejects(session.call(name,args));
  assert.equal(calls.length,before);
  const note=await session.call('obsidian_read',{path:folder+'/memory.md'});
  assert.equal(note.content,'Safe example project memory');
  assert.deepEqual(session.metadata().sources,[folder+'/memory.md']);
  assert.ok(calls.every(call=>['search_query','vault_read'].includes(call.name)));
});

test('restricted and missing classifications never become model context or source claims', async () => {
  for(const access of ['restricted',null]) {
    const {client}=fixture(access);
    const session=await createObsidianSession({env,connect:async()=>client});
    await assert.rejects(session.call('obsidian_read',{path:'AGENTS.md'}),/denied/);
    assert.deepEqual(session.metadata().sources,[]);
  }
});

test('note excerpts are bounded, repeats reuse context, and missing configuration does not connect', async () => {
  const {client,calls}=fixture();
  const original=client.callTool;
  client.callTool=async request=>request.name==='vault_read'
    ? {content:[{type:'text',text:JSON.stringify({path:request.arguments.path,frontmatter:{ai_access:'internal'},content:'x'.repeat(10000)})}]}
    : original(request);
  const session=await createObsidianSession({env,connect:async()=>client});
  const result=await session.call('obsidian_read',{path:'AGENTS.md'});
  assert.equal(result.content.length,6000);
  assert.equal(result.truncated,true);
  const count=calls.length;
  await session.call('obsidian_read',{path:'AGENTS.md'});
  assert.equal(calls.length,count);
  await assert.rejects(createObsidianSession({env:{},connect:async()=>{throw new Error('must not connect');}}),/not configured/);
});

test('total note context stops at 24000 characters before another vault read', async () => {
  const names=['AGENTS.md','me.md','memory.md','00 - System/AI/Development-Memory-Workflow.md','CONTEXT-POLICY.md'];
  let readCount=0;
  const client={close:async()=>{},callTool:async({name,arguments:args})=>{
    const data=name==='search_query' ? names.map(filename=>({filename,result:filename})) : (readCount++,{path:args.path,frontmatter:{ai_access:'internal'},content:'x'.repeat(7000)});
    return {content:[{type:'text',text:JSON.stringify(data)}]};
  }};
  const session=await createObsidianSession({env,connect:async()=>client});
  for(const note of names.slice(0,4)) await session.call('obsidian_read',{path:note});
  await assert.rejects(session.call('obsidian_read',{path:names[4]}),/context limit/);
  assert.equal(readCount,4);
  assert.equal(session.metadata().sources.length,4);
});

function writableFixture(){
  const note=folder+'/memory.md',calls=[],events=[];
  const notes=new Map([[note,{path:note,content:'# Overview\nOriginal content',frontmatter:{ai_access:'internal'},version:'v1'}]]);
  const client={close:async()=>{},callTool:async request=>{
    calls.push(request);const args=request.arguments;let value;
    if(request.name==='search_query')value=[...notes.values()].filter(note=>['public','internal'].includes(note.frontmatter.ai_access)).map(note=>({filename:note.path}));
    else if(request.name==='vault_get_document_map')value={version:notes.get(args.path).version,headings:{Overview:{}}};
    else if(request.name==='vault_read')value=notes.get(args.path);
    else if(request.name==='vault_write'){assert.ok(!notes.has(args.path));notes.set(args.path,{path:args.path,content:args.content,frontmatter:{ai_access:'internal'},version:'v1'});value={message:'OK'};}
    else if(request.name==='vault_patch'){const current=notes.get(args.path);assert.equal(args.ifMatch,current.version);assert.deepEqual(args.target,['Overview']);assert.equal(args.scope,'content');current.content+='\n'+args.content;current.version='v2';value={message:'OK'};}
    else throw new Error('Unexpected tool');
    return{content:[{type:'text',text:JSON.stringify(value)}]};
  }};
  return{note,notes,calls,events,client,session:()=>createObsidianSession({rootDir:'C:/workspace/copilot',mode:'read-write',env,connect:async()=>client,onChange:change=>events.push(change)})};
}

test('access modes validate and Off does not connect',async()=>{
  assert.equal(memoryMode(undefined,true),'read-only');assert.equal(memoryMode('off',true),'off');assert.throws(()=>memoryMode('all'));
  await assert.rejects(createObsidianSession({mode:'off',env,connect:async()=>{throw new Error('must not connect');}}),/off/);
  assert.equal(allowedWrite('AGENTS.md',folder),false);assert.equal(allowedWrite(folder+'/AGENTS.md',folder),false);assert.equal(allowedWrite(folder+'/memory.md',folder),true);
});

test('write mode creates a unique classified draft and verifies it through MCP',async()=>{
  const f=writableFixture(),session=await f.session();
  const result=await session.call('obsidian_create',{title:'Verified lesson',content:'Temporary test content'});
  assert.equal(result.saved,true);assert.ok(result.path.startsWith(folder+'/ai-notes/'));
  assert.match(f.notes.get(result.path).content,/review_status: draft/);assert.deepEqual(f.events.map(e=>e.status),['requested','saved']);
  assert.equal(session.metadata().changes[0].status,'saved');
  assert.ok(f.calls.some(call=>call.name==='vault_read'&&call.arguments.path===result.path));
});

test('updates require a prior read, known heading and matching revision; shared and restricted notes stay protected',async()=>{
  const f=writableFixture(),session=await f.session();
  const update={path:f.note,heading:['Overview'],version:'v1',operation:'append',content:'New verified information'};
  await assert.rejects(session.call('obsidian_update',update),/Read this note/);
  const read=await session.call('obsidian_read',{path:f.note});assert.equal(read.version,'v1');
  await assert.rejects(session.call('obsidian_update',{...update,heading:['Invented']}),/Unknown/);
  for(const path of ['AGENTS.md',folder+'/AGENTS.md','../me.md','02 - Projects/Active/Other/memory.md'])await assert.rejects(session.call('obsidian_update',{...update,path}));
  await session.call('obsidian_update',update);assert.equal(f.notes.get(f.note).version,'v2');assert.ok(session.metadata().sources.includes(f.note));
  await session.call('obsidian_read',{path:f.note});f.notes.get(f.note).version='v3';
  await assert.rejects(session.call('obsidian_update',{...update,version:'v2'}),/changed/);
  await session.call('obsidian_read',{path:f.note});f.notes.get(f.note).frontmatter.ai_access='restricted';
  await assert.rejects(session.call('obsidian_update',{...update,version:'v3'}),/denied/);
  assert.equal(f.calls.filter(call=>call.name==='vault_patch').length,1);
});

test('read-only, unmapped, malformed and secret writes never reach write tools',async()=>{
  const f=writableFixture();const readonly=await createObsidianSession({rootDir:'C:/workspace/copilot',env,connect:async()=>f.client});
  await assert.rejects(readonly.call('obsidian_create',{title:'No',content:'Not allowed'}));
  const writable=await f.session();await assert.rejects(writable.call('obsidian_create',{title:'No',content:'Not allowed',path:'AGENTS.md'}));
  const secretSession=await createObsidianSession({rootDir:'C:/workspace/copilot',mode:'read-write',env:{...env,OPENAI_API_KEY:'test-secret-123456789'},connect:async()=>({close:async()=>{},callTool:async()=>{throw new Error('must not reach MCP');}})});
  await assert.rejects(secretSession.call('obsidian_create',{title:'Bad',content:'test-secret-123456789'}),/Credentials/);
  const unmapped=await createObsidianSession({mode:'read-write',env,connect:async()=>({close:async()=>{}})});assert.equal(unmapped.tools.length,2);await assert.rejects(unmapped.call('obsidian_create',{title:'No',content:'No mapping'}));
});

test('truncated note replacement is denied and failed read-back is recorded as unconfirmed',async()=>{
  const f=writableFixture();f.notes.get(f.note).content='x'.repeat(7000);const session=await f.session();
  const note=await session.call('obsidian_read',{path:f.note});assert.equal(note.truncated,true);
  await assert.rejects(session.call('obsidian_update',{path:f.note,heading:['Overview'],version:note.version,operation:'replace',content:'replacement'}),/truncated/);
  assert.ok(!f.calls.some(call=>call.name==='vault_patch'));
  const original=f.client.callTool;f.client.callTool=async request=>{if(request.name==='vault_read')throw new Error('Disconnected');return original(request);};
  await assert.rejects(session.call('obsidian_create',{title:'Temporary draft',content:'test content'}),/could not be confirmed/);
  assert.deepEqual(f.events.map(event=>event.status),['requested','unconfirmed']);assert.equal(session.metadata().changes.at(-1).status,'unconfirmed');
});
