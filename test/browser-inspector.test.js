const test=require('node:test'),assert=require('node:assert/strict');
const {inspectBrowser}=require('../browser-inspector');
test('browser blocks local targets and stopped calls before starting a browser process',async()=>{
 await assert.rejects(inspectBrowser({url:'http://127.0.0.1'}),/blocked/);
 await assert.rejects(inspectBrowser({url:'file:///C:/secret'}),/public/);
 const controller=new AbortController();controller.abort();await assert.rejects(inspectBrowser({url:'https://example.com',signal:controller.signal}),/abort/i);
});
