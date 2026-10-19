const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {Readable}=require('node:stream');
const {createLocalState}=require('../local-state');
const {readCompletion}=require('../chat-stream');
const {readResponse}=require('../public/chat-transport');
const {proposals}=require('../public/codebench');

test('laptop state survives a new instance, separates credentials and prevents stale overwrites',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codebench-state-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=createLocalState(dir);
  const first={aiProvider:'openui',chatHistory:'[{"role":"user","content":"hello"}]',editorDrafts:'{"tabs":[{"content":"unsaved"}]}',explorerState:'{"project":{"selected":"src/a.js","expanded":["src"],"showHidden":true}}'};
  store.patch(first);store.saveCredential('openai','fake-test-credential');
  const restored=createLocalState(dir);assert.deepEqual(restored.snapshot(),first);
  assert.equal(restored.credentials().openai,'fake-test-credential');
  assert.ok(!fs.readFileSync(path.join(dir,'state.json'),'utf8').includes('fake-test-credential'));
  restored.patch({aiProvider:'openai'},{aiProvider:'openui'});
  assert.throws(()=>store.patch({aiProvider:'deepseek'},{aiProvider:'openui'}),{status:409});
  assert.equal(store.snapshot().aiProvider,'openai');
  assert.throws(()=>store.patch({aiProfiles:'{"openai":{"apiKey":"forbidden"}}'}));
  assert.throws(()=>store.patch({'../outside':'value'}));
  assert.throws(()=>store.saveCredential('openui','forbidden'));
  assert.throws(()=>store.patch({aiProvider:'openui'},null));
  store.recordMemoryChange({id:'test',path:'project/example.md',operation:'append',status:'saved',provider:'openai'});
  assert.equal(createLocalState(dir).memoryChanges()[0].status,'saved');
});

test('corrupt local data is preserved and fails closed',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codebench-state-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'state.json'),'{broken');assert.throws(()=>createLocalState(dir),/Preserve/);
  assert.equal(fs.readFileSync(path.join(dir,'state.json'),'utf8'),'{broken');
});

test('only complete safe assistant proposals can be reviewed',()=>{
  const block=data=>'```apply\n'+JSON.stringify(data)+'\n```';
  const good={filePath:'src/a.js',content:'new'};
  assert.deepEqual(proposals([{role:'assistant',content:block(good)}]),[{...good,action:'write'}]);
  for(const filePath of ['../secret','/abs','C:/secret','a\\b','a//b','a/./b'])assert.equal(proposals([{role:'assistant',content:block({...good,filePath})}]).length,0);
  for(const flags of [{role:'user'},{role:'assistant',error:true},{role:'assistant',incomplete:true}])assert.equal(proposals([{...flags,content:block(good)}]).length,0);
  assert.equal(proposals([{role:'assistant',content:block(good).slice(0,-3)}]).length,0);
  assert.equal(proposals([{role:'assistant',content:block(good)+'\n'+block({...good,content:'latest'})}])[0].content,'latest');
});

const sse=item=>'data: '+JSON.stringify(item)+'\r\n\r\n';
test('streaming parses fragmented UTF8, tool calls and usage',async()=>{
  const raw=sse({choices:[{delta:{content:'Hello 🐈',tool_calls:[{index:0,id:'t1',function:{name:'obsidian_read',arguments:'{"path":'}}]}}]})+sse({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'"guide"}'}}]},finish_reason:'tool_calls'}]})+sse({choices:[],usage:{total_tokens:12}})+'data: [DONE]\r\n\r\n';
  const bytes=Buffer.from(raw);let live='';const result=await readCompletion(Readable.from([...bytes].map(b=>Buffer.from([b]))),text=>live+=text);
  assert.equal(live,'Hello 🐈');assert.equal(result.usage.total_tokens,12);
  assert.deepEqual(JSON.parse(result.choices[0].message.tool_calls[0].function.arguments),{path:'guide'});
});
test('interrupted, failed or aborted streams cannot produce a completed response',async()=>{
  await assert.rejects(readCompletion(Readable.from([sse({choices:[{delta:{content:'partial'}}]})]),()=>{}),/ended early/);
  await assert.rejects(readCompletion(Readable.from([sse({error:{message:'secret'}})]),()=>{}),/streaming error/);
  const controller=new AbortController();controller.abort();await assert.rejects(readCompletion(Readable.from(['data: [DONE]\n\n']),()=>{},controller.signal),{name:'AbortError'});
});
test('browser transport requires a final result and reports actual delta events',async()=>{
  const events=[];const payload={message:{content:'done'}};
  const response=new Response('{"type":"delta","text":"a"}\n'+JSON.stringify({type:'result',result:payload})+'\n',{headers:{'content-type':'application/x-ndjson'}});
  assert.deepEqual(await readResponse(response,event=>events.push(event)),payload);assert.equal(events[0].text,'a');
  await assert.rejects(readResponse(new Response('{"type":"delta","text":"partial"}\n',{headers:{'content-type':'application/x-ndjson'}})),/before the answer/);
  await assert.rejects(readResponse(new Response('{"type":"error","error":"upstream failed"}\n',{headers:{'content-type':'application/x-ndjson'}})),/upstream failed/);
});

test('legacy browser data migrates once, credentials separately; existing laptop data preserves other browser records',async()=>{
  async function boot(initial,legacy){
    const browserData=new Map(Object.entries(legacy)),posts=[];
    const window={__CODEBENCH_LOCAL_STATE__:{values:initial},addEventListener(){}};
    const context={window,document:{readyState:'complete',getElementById(){return null;},addEventListener(){}},localStorage:{getItem:key=>browserData.get(key)??null,key:i=>[...browserData.keys()][i],get length(){return browserData.size;},removeItem:key=>browserData.delete(key)},setTimeout,clearTimeout,fetch:async(endpoint,options)=>{posts.push({endpoint,body:JSON.parse(options.body)});return{ok:true,json:async()=>({saved:true})};}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/laptop-store.js'),'utf8'),context);
    await window.LaptopStore.ready;await window.LaptopStore.flush();return{window,posts,browserData};
  }
  const migrated=await boot({}, {aiProvider:'openai',aiProfiles:'{"openai":{"apiKey":"test-legacy-secret","model":"test"}}','projectSession:fixture':'{"messages":[]}',unrelated:'keep'});
  assert.equal(migrated.posts[0].endpoint,'/api/local-credentials');
  const statePost=migrated.posts.find(post=>post.endpoint==='/api/local-state');
  assert.ok(!JSON.stringify(statePost).includes('test-legacy-secret'));assert.equal(migrated.browserData.size,1);
  assert.equal(migrated.window.LaptopStore.getItem('aiProvider'),'openai');
  const existing=await boot({aiProvider:'openui'},{aiProvider:'deepseek',chatHistory:'old-browser-history'});
  existing.window.LaptopStore.setItem('histMode','full');await existing.window.LaptopStore.flush();
  assert.equal(existing.browserData.get('chatHistory'),'old-browser-history');assert.equal(existing.window.LaptopStore.getItem('aiProvider'),'openui');
});
