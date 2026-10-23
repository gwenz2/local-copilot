const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAgentPolicy,createApprovals,validatePolicy}=require('../agent-policy');
test('agent policies persist across instances and reject stale or invalid settings',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'draftdrion-policy-'));try{const a=createAgentPolicy(dir),b=createAgentPolicy(dir),original=a.read();assert.equal(original.settings.terminal,'ask');a.save({...original.settings,webSearch:true},original.revision);assert.equal(b.read().settings.webSearch,true);assert.throws(()=>b.save(original.settings,original.revision),/another window/);assert.throws(()=>validatePolicy({terminal:'everything'}));assert.throws(()=>validatePolicy({maxRounds:999}));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('approvals require explicit matching id and are single use',async()=>{
 const approvals=createApprovals(),events=[];const result=approvals.request({command:'npm test',critical:true},undefined,event=>events.push(event));assert.throws(()=>approvals.answer('invented',true));approvals.answer(events[0].id,true);assert.equal(await result,true);assert.throws(()=>approvals.answer(events[0].id,true));
});
test('Stop and expiry deny pending commands',async()=>{
 const approvals=createApprovals({timeout:20}),controller=new AbortController();const result=approvals.request({},controller.signal,()=>{});controller.abort();assert.equal(await result,false);assert.equal(await approvals.request({},undefined,()=>{}),false);
});

test('all-command permission persists as an explicit option without changing the ask default',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'draftdrion-all-'));try{const store=createAgentPolicy(dir),initial=store.read();assert.equal(initial.settings.terminal,'ask');store.save({...initial.settings,terminal:'all'},initial.revision);assert.equal(createAgentPolicy(dir).read().settings.terminal,'all');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
