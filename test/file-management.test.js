const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createFileManagement}=require('../file-management');
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'codebench-files-')),root=path.join(home,'project'),data=path.join(home,'data');fs.mkdirSync(root);t.after(()=>fs.rmSync(home,{recursive:true,force:true}));const service=createFileManagement(data);return{home,root,data,service,act:body=>service.perform({rootDir:root,...body}),undo:()=>service.undo({rootDir:root,id:service.history(root).undo.id})};}

test('create files with extensions and folders, reject collisions, and persist ordered Undo',t=>{
 const f=fixture(t);f.act({action:'create-folder',filePath:'src'});f.act({action:'create-file',filePath:'src/index.html'});
 assert.equal(fs.readFileSync(path.join(f.root,'src/index.html'),'utf8'),'');
 assert.throws(()=>f.act({action:'create-file',filePath:'src/index.html'}),/exists/);
 const restored=createFileManagement(f.data);restored.undo({rootDir:f.root,id:restored.history(f.root).undo.id});assert.equal(fs.existsSync(path.join(f.root,'src/index.html')),false);
 f.undo();assert.equal(fs.existsSync(path.join(f.root,'src')),false);
});
test('Undo creation refuses changed content and a nonempty folder',t=>{
 const f=fixture(t);f.act({action:'create-file',filePath:'draft.md'});fs.writeFileSync(path.join(f.root,'draft.md'),'user edits');assert.throws(f.undo,/changed/);assert.equal(fs.readFileSync(path.join(f.root,'draft.md'),'utf8'),'user edits');
 f.act({action:'create-folder',filePath:'folder'});fs.writeFileSync(path.join(f.root,'folder/keep.txt'),'keep');assert.throws(f.undo,/changed/);assert.equal(fs.existsSync(path.join(f.root,'folder/keep.txt')),true);
});
test('rename/move directories preserves contents and supports Undo without overwriting',t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.root,'src'));fs.mkdirSync(path.join(f.root,'dest'));fs.writeFileSync(path.join(f.root,'src/a.js'),'code');
 f.act({action:'rename',filePath:'src',newPath:'dest/lib'});assert.equal(fs.readFileSync(path.join(f.root,'dest/lib/a.js'),'utf8'),'code');
 fs.mkdirSync(path.join(f.root,'src'));assert.throws(f.undo,/now exists/);fs.rmdirSync(path.join(f.root,'src'));f.undo();assert.equal(fs.existsSync(path.join(f.root,'src/a.js')),true);
 fs.writeFileSync(path.join(f.root,'taken.js'),'preserve');assert.throws(()=>f.act({action:'rename',filePath:'src/a.js',newPath:'taken.js'}),/exists/);assert.equal(fs.readFileSync(path.join(f.root,'taken.js'),'utf8'),'preserve');
 assert.throws(()=>f.act({action:'rename',filePath:'src',newPath:'src/inside'}),/inside itself/);
});
test('delete a nonempty binary folder into laptop recovery and restore after restart',t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.root,'assets'));const binary=Buffer.from([0,255,128,1,2,0]);fs.writeFileSync(path.join(f.root,'assets/image.bin'),binary);
 f.act({action:'delete',filePath:'assets'});assert.equal(fs.existsSync(path.join(f.root,'assets')),false);assert.equal(fs.readdirSync(path.join(f.data,'file-trash')).length,1);assert.deepEqual(fs.readdirSync(f.root),[]);
 const restored=createFileManagement(f.data);restored.undo({rootDir:f.root,id:restored.history(f.root).undo.id});assert.deepEqual(fs.readFileSync(path.join(f.root,'assets/image.bin')),binary);assert.deepEqual(fs.readdirSync(path.join(f.data,'file-trash')),[]);
});
test('deletion Undo preserves a newly occupied path and stale Undo IDs cannot mutate files',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'a.txt'),'original');f.act({action:'delete',filePath:'a.txt'});fs.writeFileSync(path.join(f.root,'a.txt'),'new file');assert.throws(f.undo,/now exists/);assert.equal(fs.readFileSync(path.join(f.root,'a.txt'),'utf8'),'new file');
 assert.throws(()=>f.service.undo({rootDir:f.root,id:'stale-id'}),/history changed/);
});
test('invalid names, project root, Git metadata, storage and symlink escapes are protected',t=>{
 const f=fixture(t);for(const filePath of ['', '../outside', '/absolute','a/../../outside','a:stream','CON.txt','bad.','.git/config','.codebench-stage-reserved'])assert.throws(()=>f.act({action:'create-file',filePath}),undefined,filePath);
 fs.mkdirSync(path.join(f.root,'nested'));fs.mkdirSync(path.join(f.root,'nested/.git'));assert.throws(()=>f.act({action:'delete',filePath:'nested'}),/Git metadata/);
 assert.throws(()=>f.service.perform({rootDir:f.home,action:'delete',filePath:'data'}),/recovery data/);
 const outside=path.join(f.home,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.txt'),'keep');
 try{fs.symlinkSync(outside,path.join(f.root,'link'),process.platform==='win32'?'junction':'dir');}catch(error){if(error.code==='EPERM')return;throw error;}
 assert.throws(()=>f.act({action:'delete',filePath:'link/keep.txt'}),/Links/);assert.equal(fs.readFileSync(path.join(outside,'keep.txt'),'utf8'),'keep');
});
test('cross-volume transfer copies and verifies recovery, and copy failure rolls back the original',t=>{
 const f=fixture(t),rename=fs.renameSync,copy=fs.cpSync;fs.writeFileSync(path.join(f.root,'a.txt'),'cross-volume bytes');
 fs.renameSync=(from,to)=>{if(String(from).includes('.codebench-stage-')&&String(to).startsWith(path.join(f.data,'file-trash'))||String(from).startsWith(path.join(f.data,'file-trash'))){const error=new Error('different volume');error.code='EXDEV';throw error;}return rename(from,to);};
 try{f.act({action:'delete',filePath:'a.txt'});f.undo();assert.equal(fs.readFileSync(path.join(f.root,'a.txt'),'utf8'),'cross-volume bytes');
 fs.cpSync=()=>{throw new Error('copy interrupted');};assert.throws(()=>f.act({action:'delete',filePath:'a.txt'}),/copy interrupted/);assert.equal(fs.readFileSync(path.join(f.root,'a.txt'),'utf8'),'cross-volume bytes');
 }finally{fs.renameSync=rename;fs.cpSync=copy;}
});
test('prepared creation recovery preserves items whose ownership cannot be confirmed',t=>{
 const f=fixture(t);f.act({action:'create-file',filePath:'draft.txt'});const journal=path.join(f.data,'file-actions.json'),data=JSON.parse(fs.readFileSync(journal,'utf8'));data.entries[0].status='prepared';fs.writeFileSync(journal,JSON.stringify(data));
 const result=f.undo();assert.match(result.warning,/kept/);assert.equal(fs.existsSync(path.join(f.root,'draft.txt')),true);
});
