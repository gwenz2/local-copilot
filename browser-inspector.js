const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {validatePublicUrl}=require('./agent-tools');
async function inspectBrowser({url,signal}){
  signal?.throwIfAborted();
  const validated=await validatePublicUrl(url);
  if(validated.address.family!==4)throw new Error('Browser inspection currently requires a public IPv4 address. Use Read public webpages for this URL.');
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'draftdrion-browser-'));
    const executable=process.versions.electron?process.execPath:require('electron');
    const script=path.join(__dirname,'desktop','browser-worker.js');
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    for(const key of Object.keys(env))if(/KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|OBSIDIAN_PROJECTS/i.test(key))delete env[key];
    const rules=`MAP ${validated.url.hostname} ${validated.address.address}, MAP * ~NOTFOUND`;
    const args=process.versions.electron&&require('electron').app.isPackaged?['--draftdrion-browser-worker']:[script];
    args.push('--draftdrion-target='+Buffer.from(JSON.stringify({url:validated.url.href,address:validated.address.address})).toString('base64url'),'--host-resolver-rules='+rules,'--no-proxy-server','--force-webrtc-ip-handling-policy=disable_non_proxied_udp',profile);
    const child=spawn(executable,args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',settled=false,stopError,closed=false,killing=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100},()=>{});error?reject(error):resolve(result);};
    const stop=error=>{
      if(stopError)return;stopError=error;killing=true;
      if(process.platform==='win32'&&child.pid){const killer=spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>{killing=false;child.kill();if(closed)finish(stopError);});killer.once('close',()=>{killing=false;if(closed)finish(stopError);});}
      else{killing=false;child.kill('SIGKILL');if(closed)finish(stopError);}
    };
    const abort=()=>stop(new Error('Browser inspection stopped'));
    const timer=setTimeout(()=>stop(new Error('Browser inspection timed out')),45000);
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>500000)stop(new Error('Browser result was too large'));});
    child.stderr.resume();
    child.once('error',()=>finish(new Error('The isolated browser could not start. Check the desktop runtime installation.')));
    child.once('close',()=>{closed=true;if(stopError){if(!killing)finish(stopError);return;}try{const line=output.split('\n').find(line=>line.startsWith('DRAFTDRION_BROWSER:'));const result=JSON.parse(line?.slice(19));if(result.error)throw new Error(result.error);finish(null,result);}catch(error){finish(new Error(error.message?.startsWith('Browser ')?error.message:'Browser inspection failed. Run Draftdrion under your normal Windows account.'));}});
    child.stdin.on('error',()=>{});child.stdin.end();
  });
}
module.exports={inspectBrowser};
