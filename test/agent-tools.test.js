const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {createAgentSession,publicAddress,publicUrl,readPublicPage,criticalCommand,searchItems,pageText}=require('../agent-tools');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'draftdrion-tools-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'index.js'),'const answer = 42;\nconsole.log(answer);');return root;}

test('repository tools explore and search text while excluding credentials and generated content',async t=>{
  const root=fixture(t);fs.writeFileSync(path.join(root,'.env'),'API_KEY=secret');fs.writeFileSync(path.join(root,'credentials.json'),'secret');fs.mkdirSync(path.join(root,'node_modules'));fs.writeFileSync(path.join(root,'node_modules/dependency.js'),'secret');
  const session=createAgentSession({rootDir:root});
  assert.deepEqual((await session.execute('repository_list')).files,['index.js']);
  assert.match((await session.execute('repository_read',{path:'index.js'})).content,/42/);
  assert.equal((await session.execute('repository_search',{query:'answer'})).matches.length,2);
  for(const name of ['../outside.txt','.env','credentials.json','node_modules/dependency.js','C:\\Windows\\win.ini','index.js:stream'])await assert.rejects(session.execute('repository_read',{path:name}));
  assert.equal(session.tools.some(tool=>tool.function.name==='web_search'),false);
});

test('repository access blocks symlinks and Obsidian vault ancestors and descendants',async t=>{
  const root=fixture(t),outside=fs.mkdtempSync(path.join(os.tmpdir(),'draftdrion-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));fs.writeFileSync(path.join(outside,'private.txt'),'secret');
  fs.symlinkSync(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');
  const session=createAgentSession({rootDir:root});await assert.rejects(session.execute('repository_read',{path:'linked/private.txt'}),/links/);
  fs.mkdirSync(path.join(root,'vault'));fs.mkdirSync(path.join(root,'vault/.obsidian'));fs.writeFileSync(path.join(root,'vault/memory.md'),'private');
  assert.equal((await session.execute('repository_list')).files.includes('vault/memory.md'),false);
  await assert.rejects(session.execute('repository_read',{path:'vault/memory.md'}),/Obsidian/);
  const vault=createAgentSession({rootDir:path.join(root,'vault')});for(let attempt=0;attempt<2;attempt++)await assert.rejects(vault.execute('repository_list'),/Obsidian/);
});

test('disabled tools and closed or cancelled sessions do not execute',async t=>{
 const root=fixture(t),session=createAgentSession({rootDir:root,settings:{repository:false,terminal:'off'}});assert.deepEqual(session.tools,[]);await assert.rejects(session.execute('terminal_run',{command:'node --test'}),/disabled/);session.close();await assert.rejects(session.execute('repository_list'),/abort/i);
});

test('public URL validation rejects private, mapped, reserved, credential and custom-port targets',async()=>{
 for(const address of ['127.0.0.1','10.1.2.3','172.31.0.1','192.168.1.1','169.254.169.254','100.64.1.2','0.0.0.0','224.0.0.1','192.88.99.1','::1','::ffff:8.8.8.8','fe80::1','fc00::1','2001:db8::1','2001:0db8::1','2002:808:808::1','2001:20::1','3fff::1'])assert.equal(publicAddress(address),false,address);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
 const lookup=async()=>[{address:'8.8.8.8',family:4}];
 for(const url of ['file:///etc/passwd','http://127.1','https://user:password@example.com','https://example.com:3000','https://example.com/#secret'])await assert.rejects(publicUrl(url,lookup));
 await assert.rejects(publicUrl('https://example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/blocked/);
 assert.equal((await publicUrl('https://example.com/path',lookup)).address.address,'8.8.8.8');
});

test('web downloads pin checked DNS and revalidate redirects before sending requests',async()=>{
 let requests=0;const lookup=async host=>[{address:host==='example.com'?'8.8.8.8':'127.0.0.1',family:4}];
 const request=(url,options,callback)=>{requests++;const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>{options.lookup(url.hostname,{},(error,address)=>assert.equal(address,'8.8.8.8'));const res=new PassThrough();res.statusCode=302;res.headers={location:'http://private.example/secret'};callback(res);res.end();};return req;};
 await assert.rejects(readPublicPage('https://example.com',{lookup,request}),/blocked/);assert.equal(requests,1);
});

test('search exposes source links and page text removes executable markup',async()=>{
 const xml='<rss><channel><item><title>A &amp; B</title><link>https://example.com/a</link><description><![CDATA[<b>Useful source</b>]]></description></item></channel></rss>';
 assert.deepEqual(searchItems(xml),[{title:'A & B',url:'https://example.com/a',snippet:'Useful source'}]);
 assert.equal(pageText('<script>steal()</script><p>Evidence</p><style>body{}</style>'),'Evidence');
 const session=createAgentSession({settings:{webSearch:true,webFetch:true,terminal:'off'},pageReader:async url=>({url,body:xml})});assert.equal((await session.execute('web_search',{query:'test docs'})).results[0].url,'https://example.com/a');
 await assert.rejects(session.execute('web_search',{query:''}),/query/);
});

test('commands require explicit approval and critical commands cannot use the saved allowlist',async t=>{
 const root=fixture(t),calls=[];
 const session=createAgentSession({rootDir:root,settings:{terminal:'approved',approvedCommands:['node -e "console.log(1)"']},requestApproval:async request=>{calls.push(request);return false;}});
 await assert.rejects(session.execute('terminal_run',{command:'node -e "console.log(1)"',reason:'test'}),/denied/);assert.equal(calls[0].critical,true);
 const absent=createAgentSession({rootDir:root});await assert.rejects(absent.execute('terminal_run',{command:'git status',reason:'inspect'}),/denied/);
 assert.equal(criticalCommand('npm test'),false);assert.equal(criticalCommand('git status'),false);assert.equal(criticalCommand('npm test && del index.js'),true);assert.equal(criticalCommand('npm install'),true);assert.equal(criticalCommand('git push'),true);
});

test('approved commands return exit status with bounded redacted output and no inherited API key',async t=>{
 const root=fixture(t);process.env.DRAFTDRION_TEST_API_KEY='test-secret-123456789';t.after(()=>delete process.env.DRAFTDRION_TEST_API_KEY);
 const session=createAgentSession({rootDir:root,requestApproval:async()=>true});
 const result=await session.execute('terminal_run',{command:'node -e "console.log(process.env.DRAFTDRION_TEST_API_KEY || \'not inherited\'); process.exitCode=3"',reason:'verify environment'});
 assert.equal(result.exitCode,3);assert.match(result.output,/not inherited/);assert.equal(result.output.includes('test-secret-123456789'),false);
 const denied=createAgentSession({rootDir:root,settings:{terminal:'ask',testCommand:'node --test'},requestApproval:async()=>false});await assert.rejects(denied.execute('run_tests'),/denied/);
});

test('browser tool is exposed only when enabled and an isolated inspector is supplied',async()=>{
 const session=createAgentSession({settings:{repository:false,terminal:'off',browser:true},browserInspect:async({url})=>({url,title:'isolated'})});assert.equal((await session.execute('browser_inspect',{url:'https://example.com'})).title,'isolated');assert.equal(createAgentSession({settings:{browser:true}}).tools.some(tool=>tool.function.name==='browser_inspect'),false);
});

test('Stop cancels an approved running command instead of leaving its process running',async t=>{
 const root=fixture(t),controller=new AbortController();const session=createAgentSession({rootDir:root,signal:controller.signal,requestApproval:async()=>true});
 const result=session.execute('terminal_run',{command:'node -e "setTimeout(()=>console.log(\'late\'),20000)"',reason:'verify cancellation'});setTimeout(()=>controller.abort(),100);
 await assert.rejects(result,/abort/i);
});


test('denying one command blocks replacement commands for the rest of that request',async t=>{
 const root=fixture(t);let approvals=0;const session=createAgentSession({rootDir:root,requestApproval:async()=>{approvals++;return false;}});
 await assert.rejects(session.execute('terminal_run',{command:'git status',reason:'inspect'}),/denied/);
 await assert.rejects(session.execute('terminal_run',{command:'git diff',reason:'try again'}),/rest of this request/);assert.equal(approvals,1);
});
test('an exact recognized approved test command can run without another approval',async t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'safe.test.js'),"require('node:test')('passes',()=>{}); ");let approvals=0;
 const command='node --test safe.test.js';const session=createAgentSession({rootDir:root,settings:{terminal:'approved',approvedCommands:[command]},requestApproval:async()=>{approvals++;return false;}});
 const result=await session.execute('terminal_run',{command,reason:'approved test'});assert.equal(result.exitCode,0);assert.equal(approvals,0);
});


test('all mode runs an unlisted critical command without an approval callback and records automatic approval',async t=>{
 const root=fixture(t),events=[];let asked=0;const session=createAgentSession({rootDir:root,settings:{terminal:'all'},requestApproval:async()=>{asked++;return false;},onProgress:event=>events.push(event)});
 const command=process.platform==='win32'?'cmd /c echo Hello from terminal test':'echo Hello from terminal test';
 assert.equal(criticalCommand(command),true);const result=await session.execute('terminal_run',{command,reason:'simple terminal check'});
 assert.equal(result.exitCode,0);assert.match(result.output,/Hello from terminal test/);assert.equal(asked,0);assert.ok(events.some(event=>event.text==='Command automatically approved · all commands mode'));
});
