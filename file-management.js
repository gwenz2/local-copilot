const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');

const within=(root,target)=>{const rel=path.relative(root,target);return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function fingerprint(target){
  const hash=createHash('sha256');let entries=0,bytes=0;
  // shortcut: bound synchronous recovery checks; use background jobs for very large trees.
  function visit(file,relative){
    const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw new Error('Links and special files cannot be managed.');
    if(++entries>5000||(bytes+=stat.isFile()?stat.size:0)>250*1024*1024)throw new Error('This action exceeds the 5,000-entry / 250 MB recovery limit.');
    hash.update(JSON.stringify([stat.isDirectory()?'dir':'file',relative,stat.isFile()?stat.size:0]));
    if(stat.isDirectory())for(const name of fs.readdirSync(file).sort()){
      if(name.toLowerCase()==='.git'||name.startsWith('.codebench-stage-'))throw new Error('Git metadata or pending recovery data must be managed separately.');
      visit(path.join(file,name),relative?relative+'/'+name:name);
    }else{const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(65536);try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,count));}finally{fs.closeSync(fd);}}
  }
  visit(target,'');return hash.digest('hex');
}
function emptyFingerprint(kind){return createHash('sha256').update(JSON.stringify([kind,'',0])).digest('hex');}

function createFileManagement(directory){
  const data=path.resolve(directory),journal=path.join(data,'file-actions.json'),trash=path.join(data,'file-trash');
  fs.mkdirSync(trash,{recursive:true,mode:0o700});
  function load(){if(!fs.existsSync(journal))return[];try{const value=JSON.parse(fs.readFileSync(journal,'utf8'));if(!Array.isArray(value.entries))throw new Error();return value.entries;}catch{throw new Error('File recovery history is unreadable. Preserve it before continuing.');}}
  function save(entries){const temporary=journal+'.tmp';fs.writeFileSync(temporary,JSON.stringify({entries}),{mode:0o600});fs.renameSync(temporary,journal);}
  function rootPath(root){if(typeof root!=='string'||!path.isAbsolute(root))throw new Error('Choose an absolute project folder.');const value=fs.realpathSync(root);if(!fs.statSync(value).isDirectory()||value.split(path.sep).some(part=>part.toLowerCase()==='.git'))throw new Error('Choose a project folder outside Git metadata.');return value;}
  function resolve(root,relative,internal=false){
    if(typeof relative!=='string'||!relative||relative.length>1000||path.isAbsolute(relative))throw new Error('Enter a relative file or folder path.');
    const parts=relative.replace(/\\/g,'/').split('/');
    if(parts.some(part=>!part||part==='.'||part==='..'||/[<>:"|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)||part.toLowerCase()==='.git'||(!internal&&part.startsWith('.codebench-stage-'))))throw new Error('Invalid or reserved file/folder name.');
    let current=root;
    for(const part of parts){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw new Error('Links cannot be managed.');}catch(error){if(error.code!=='ENOENT')throw error;}}
    if(!within(root,current)||same(root,current)||within(data,current)||within(current,data))throw new Error('This path is outside the project or protects Codebench recovery data.');
    return current;
  }
  function backup(entry){if(!/^[a-f0-9-]{36}$/.test(entry.id))throw new Error('Invalid recovery record.');const target=path.resolve(trash,entry.id);if(!within(trash,target)||same(trash,target))throw new Error('Invalid recovery path.');return target;}
  function transfer(source,destination,expected){
    try{fs.renameSync(source,destination);}catch(error){if(error.code!=='EXDEV')throw error;
      fs.cpSync(source,destination,{recursive:true,force:false,errorOnExist:true});
      if(fingerprint(destination)!==expected||fingerprint(source)!==expected)throw new Error('The item changed during recovery transfer; both copies were preserved.');
      fs.rmSync(source,{recursive:true});
    }
  }
  function reverse(entry){
    const root=rootPath(entry.rootDir),from=resolve(root,entry.from),to=entry.to&&resolve(root,entry.to);
    if(entry.action==='create-file'||entry.action==='create-folder'){
      if(!fs.existsSync(from))return;
      if(fingerprint(from)!==entry.after)throw new Error('The created item has changed. Undo was stopped to protect your edits.');
      if(entry.kind==='dir')fs.rmdirSync(from);else fs.unlinkSync(from);
    }else if(entry.action==='rename'){
      if(!same(from,to)&&fs.existsSync(from)){
        if(!fs.existsSync(to)&&fingerprint(from)===entry.before)return;
        throw new Error('The original path now exists. Undo will not overwrite it.');
      }
      if(!fs.existsSync(to)||fingerprint(to)!==entry.before)throw new Error('The renamed item changed or moved. Undo was stopped.');
      fs.renameSync(to,from);
    }else if(entry.action==='delete'){
      if(fs.existsSync(from)){if(fingerprint(from)===entry.before)return;throw new Error('The deleted path now exists. Undo will not overwrite it.');}
      const stage=resolve(root,entry.stage,true),source=fs.existsSync(stage)?stage:backup(entry);
      if(!fs.existsSync(source)||fingerprint(source)!==entry.before)throw new Error('Recovery data is missing or changed. No files were overwritten.');
      if(source===stage)fs.renameSync(stage,from);
      else{
        try{fs.renameSync(source,from);}catch(error){if(error.code!=='EXDEV')throw error;
          fs.cpSync(source,stage,{recursive:true,force:false,errorOnExist:true});
          if(fingerprint(stage)!==entry.before||fs.existsSync(from))throw new Error('Restore could not be verified. Recovery data was preserved.');
          fs.renameSync(stage,from);
        }
      }
    }else throw new Error('Unknown file recovery action.');
  }
  function history(rootDir){const root=rootPath(rootDir),entries=load().filter(entry=>same(entry.rootDir,root));const last=entries.findLast(entry=>['applied','prepared'].includes(entry.status));return{undo:last?{id:last.id,label:last.label,status:last.status}:null,entries:entries.slice(-15).reverse().map(({id,label,status,time})=>({id,label,status,time}))};}
  function perform({rootDir,action,filePath,newPath}){
    const root=rootPath(rootDir),from=resolve(root,filePath),entries=load();
    if(!['create-file','create-folder','rename','delete'].includes(action))throw new Error('Unsupported file action.');
    if(entries.some(entry=>same(entry.rootDir,root)&&entry.status==='prepared'))throw new Error('Undo the pending recovery action before making more changes.');
    const creating=action.startsWith('create-');let kind=action==='create-folder'?'dir':'file',to;
    if(creating){if(fs.existsSync(from))throw new Error('That name already exists. Nothing was overwritten.');if(!fs.statSync(path.dirname(from)).isDirectory())throw new Error('Create the parent folder first.');}
    else{const stat=fs.lstatSync(from);kind=stat.isDirectory()?'dir':'file';}
    const before=creating?null:fingerprint(from);
    if(action==='rename'){
      to=resolve(root,newPath);if(from===to)throw new Error('Enter a different name or path.');
      if(fs.existsSync(to)&&!same(from,to))throw new Error('The destination already exists. Nothing was overwritten.');
      if(kind==='dir'&&within(from,to)&&!same(from,to))throw new Error('A folder cannot be moved inside itself.');
      if(!fs.statSync(path.dirname(to)).isDirectory())throw new Error('The destination folder does not exist.');
    }
    const id=randomUUID(),relative=value=>path.relative(root,value).split(path.sep).join('/');
    const entry={id,rootDir:root,action,from:relative(from),...(to?{to:relative(to)}:{}),kind,before,after:creating?emptyFingerprint(kind):before,status:'prepared',time:new Date().toISOString(),label:`${action==='rename'?'Rename / move':action==='delete'?'Delete':kind==='dir'?'New folder':'New file'} ${relative(from)}`};
    if(action==='delete')entry.stage=relative(path.join(path.dirname(from),'.codebench-stage-'+id));
    entries.push(entry);save(entries);let mutated=false;
    try{
      if(action==='create-file'){fs.writeFileSync(from,'',{flag:'wx'});mutated=true;}
      else if(action==='create-folder'){fs.mkdirSync(from);mutated=true;}
      else if(action==='rename'){fs.renameSync(from,to);mutated=true;}
      else{const stage=resolve(root,entry.stage,true);fs.renameSync(from,stage);mutated=true;transfer(stage,backup(entry),before);}
      entry.status='applied';save(entries);
      return{change:{action,from:entry.from,to:entry.to,kind},...history(root)};
    }catch(error){
      try{if(mutated)reverse(entry);entry.status='failed';save(entries);}catch{throw new Error('The action could not finish. Recovery was preserved; use Undo file action before continuing.');}
      throw error;
    }
  }
  function undo({rootDir,id}){
    const root=rootPath(rootDir),entries=load(),entry=entries.findLast(entry=>same(entry.rootDir,root)&&['applied','prepared'].includes(entry.status));
    if(!entry||entry.id!==id)throw new Error('File history changed. Refresh before Undo.');
    const uncertainCreation=entry.status==='prepared'&&entry.action.startsWith('create-');
    // An interrupted create has no durable ownership proof; preserve any existing item.
    if(!uncertainCreation)reverse(entry);entry.status='undone';save(entries);
    // Backups are removed only after a verified restore and a committed Undo record.
    if(entry.action==='delete'){const target=backup(entry);if(fs.existsSync(target))try{fs.rmSync(target,{recursive:true});}catch{}}
    return{change:{action:uncertainCreation?'preserve':entry.action==='rename'?'rename':entry.action==='delete'?'restore':'remove',from:entry.action==='rename'?entry.to:entry.from,to:entry.action==='rename'?entry.from:undefined,kind:entry.kind},...(uncertainCreation?{warning:'Interrupted creation cleared from recovery. Any existing file/folder was kept; inspect it before deleting.'}:{}),...history(root)};
  }
  return{perform,undo,history};
}
module.exports={createFileManagement,fingerprint};
