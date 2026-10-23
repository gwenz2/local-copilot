const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');

const DEFAULTS=Object.freeze({repository:true,webSearch:true,webFetch:true,browser:false,terminal:'ask',approvedCommands:[],testCommand:'',maxRounds:5});
function validatePolicy(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid agent settings');
  const value={...DEFAULTS,...input};
  if(Object.keys(input).some(key=>!Object.hasOwn(DEFAULTS,key)))throw new Error('Unknown agent setting');
  if(['repository','webSearch','webFetch','browser'].some(key=>typeof value[key]!=='boolean')||!['off','ask','approved','all'].includes(value.terminal))throw new Error('Invalid tool permissions');
  if(!Array.isArray(value.approvedCommands)||value.approvedCommands.length>30||value.approvedCommands.some(command=>typeof command!=='string'||!command.trim()||command.length>1000||/[\r\n\0]/.test(command)))throw new Error('Enter up to 30 exact approved commands, one per line');
  if(typeof value.testCommand!=='string'||value.testCommand.length>1000||/[\r\n\0]/.test(value.testCommand))throw new Error('Invalid test command');
  if(!Number.isInteger(value.maxRounds)||value.maxRounds<2||value.maxRounds>10)throw new Error('Agent round limit must be from 2 to 10');
  value.approvedCommands=[...new Set(value.approvedCommands.map(command=>command.trim()))];value.testCommand=value.testCommand.trim();
  return value;
}
function createAgentPolicy(directory){
  const file=path.join(directory,'agent-policy.json');
  function read(){
    const text=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
    return {settings:validatePolicy(text?JSON.parse(text):{}),revision:createHash('sha256').update(text).digest('hex')};
  }
  function save(settings,revision){
    const current=read();if(revision!==current.revision){const error=new Error('Agent settings changed in another window. Reload settings before saving.');error.status=409;throw error;}
    const next=validatePolicy(settings);fs.writeFileSync(file+'.tmp',JSON.stringify(next),{mode:0o600});fs.renameSync(file+'.tmp',file);return read();
  }
  return {read,save};
}
function createApprovals({timeout=300000}={}){
  const pending=new Map();
  function request(details,signal,emit){
    signal?.throwIfAborted();
    return new Promise(resolve=>{
      const id=randomUUID();
      const finish=approved=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);emit({type:'approval-result',id,approved,text:approved?'Command approved':'Command denied, canceled, or expired'});resolve(approved);};
      const abort=()=>finish(false),timer=setTimeout(abort,timeout);
      pending.set(id,finish);signal?.addEventListener('abort',abort,{once:true});
      emit({type:'approval',...details,id});
    });
  }
  function answer(id,approved){if(typeof id!=='string'||typeof approved!=='boolean'||!pending.has(id))throw new Error('Approval has expired or is no longer active');pending.get(id)(approved);}
  return {request,answer};
}
module.exports={DEFAULTS,validatePolicy,createAgentPolicy,createApprovals};
