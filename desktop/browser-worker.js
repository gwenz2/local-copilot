// Remote pages run in an ephemeral sandbox with no access to Draftdrion's session.
const {app,BrowserWindow,session}=require('electron');
const {publicAddress}=require('../agent-tools');
app.setPath('userData',process.argv[process.argv.length-1]);
(async()=>{
 let win;
 try{
  const {url,address}=JSON.parse(Buffer.from(process.argv.find(arg=>arg.startsWith('--draftdrion-target='))?.slice(20)||'','base64url').toString());
  const target=new URL(url),hostname=target.hostname;
  const allowed=value=>{try{const candidate=new URL(value);return ['https:','http:'].includes(candidate.protocol)&&candidate.hostname===hostname&&!candidate.username&&!candidate.password&&['','80','443'].includes(candidate.port);}catch{return false;}};
  if(!allowed(url)||!publicAddress(address)||!/^\d+\.\d+\.\d+\.\d+$/.test(address)||!process.argv.includes('--host-resolver-rules='+`MAP ${hostname} ${address}, MAP * ~NOTFOUND`))throw new Error('Invalid public browser target');
  await app.whenReady();
  const isolated=session.fromPartition('draftdrion-browser-'+Date.now());
  await isolated.setProxy({mode:'direct'});
  isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  isolated.setPermissionCheckHandler(()=>false);
  isolated.on('will-download',(event)=>event.preventDefault());
  isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!allowed(details.url)&&!(details.resourceType!=='mainFrame'&&details.url.startsWith('data:'))}));
  win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webgl:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.webContents.on('will-navigate',(event,value)=>{if(!allowed(value))event.preventDefault();});
  const errors=[];win.webContents.on('console-message',(_event,...args)=>{const detail=typeof args[0]==='object'?args[0]:{level:args[0],message:args[1]};if(detail.level==='error'||detail.level===3)errors.push(String(detail.message).slice(0,1000));});
  await win.loadURL(url,{userAgent:'Draftdrion browser inspection'});
  const page=await win.webContents.executeJavaScript('({title:document.title,url:location.href,text:document.body.innerText.slice(0,16000),links:Array.from(document.links).slice(0,30).map(a=>({text:a.innerText.slice(0,100),url:a.href}))})');
  const shot=await win.webContents.capturePage();
  const screenshot=shot.resize({width:800}).toJPEG(65).toString('base64');
  console.log('DRAFTDRION_BROWSER:'+JSON.stringify({...page,consoleErrors:errors.slice(-10),screenshot}));
 }catch(error){console.log('DRAFTDRION_BROWSER:'+JSON.stringify({error:'Browser inspection failed: '+error.message}));}
 finally{win?.destroy();app.quit();}
})();
