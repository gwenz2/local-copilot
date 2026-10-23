const test=require('node:test');
const assert=require('node:assert/strict');
const {activitySnapshot,screenshotArtifactPath}=require('../public/codebench');

test('activity persists bounded summaries without terminal output, approval commands or live handles',()=>{
  const event={id:'e',type:'approval',time:'2026-10-21T10:00:00Z',text:'Command needs approval',approvalId:'a',command:'secret command',output:'secret output',approved:false};
  const run={id:'r',prompt:'Fix tests',provider:'openui',started:event.time,status:'Running',raw:'private response',controller:{},events:Array(105).fill(event)};
  const saved=activitySnapshot({projects:{project:Array(25).fill(run)}});
  assert.equal(saved.projects.project.length,20);
  assert.equal(saved.projects.project[0].events.length,100);
  assert.equal(saved.projects.project[0].status,'Interrupted; the app reloaded.');
  assert.equal(saved.projects.project[0].events[0].approved,false);
  const serialized=JSON.stringify(saved);
  for(const forbidden of ['secret command','secret output','private response','controller'])assert.ok(!serialized.includes(forbidden));
});

test('completed activity keeps completion status and projects remain separate',()=>{
  const saved=activitySnapshot({projects:{a:[{id:'a',finished:'done',status:'Response complete',events:[]}],b:[{id:'b',finished:'done',status:'Stopped',events:[]}]}});
  assert.equal(saved.projects.a[0].status,'Response complete');
  assert.equal(saved.projects.b[0].status,'Stopped');
  assert.deepEqual(activitySnapshot(null),{projects:{}});
});

test('browser artifact links allow only local screenshot IDs, never model-provided remote URLs',()=>{
  const valid='/api/agent/browser-artifact/12345678-abcd-1234-abcd-123456789012';
  assert.equal(screenshotArtifactPath(valid),valid);
  for(const value of ['https://example.com'+valid,'//example.com'+valid,'javascript:alert(1)',valid+'?secret=1',valid+'#fragment',valid+'/../secret','/api/agent/browser-artifact/%2e%2e',null])assert.equal(screenshotArtifactPath(value),'');
});
