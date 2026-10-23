const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

test('desktop and web bootstrap share saved data while static files work outside the source directory', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'draftdrion-desktop-'));
  process.env.CODEBENCH_DATA_DIR = directory;
  const {app} = require('../server');
  const cwd = process.cwd();
  process.chdir(directory);
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  t.after(() => {server.closeAllConnections();server.close();process.chdir(cwd);fs.rmSync(directory,{recursive:true,force:true});});
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(origin);
  assert.equal(page.status,200);
  assert.match(await page.text(),/<title>Draftdrion/);
  const saved = await fetch(origin+'/api/local-state',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({changes:{backendUrl:'http://127.0.0.1:3001',codebenchPreferences:'{"autoFollow":false}'}})});
  assert.equal(saved.status,200);
  async function bootstrap() {
    const context = {window:{}};
    vm.runInNewContext(await (await fetch(origin+'/api/local-state/bootstrap')).text(),context);
    return context.window.__CODEBENCH_LOCAL_STATE__;
  }
  const web = await bootstrap();
  assert.equal(web.desktop,false);
  assert.equal(web.envFile,undefined);
  app.locals.desktop = true;
  const desktop = await bootstrap();
  assert.equal(desktop.desktop,true);
  assert.equal(desktop.values.backendUrl,web.values.backendUrl);
  assert.equal(desktop.values.codebenchPreferences,web.values.codebenchPreferences);
  assert.equal(typeof desktop.envFile,'string');
  assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(__dirname,'../desktop/main.js'),'utf8')));
});
