const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('chat follows growth, pauses for reading, anchors redraws and respects its disabled preference', () => {
  const frames = [], observers = [], handlers = {};
  const context = {module:{exports:{}},requestAnimationFrame:fn => frames.push(fn),
    ResizeObserver:class { constructor(fn) { observers.push(fn); } observe() {} disconnect() {} },
    MutationObserver:class { constructor(fn) { observers.push(fn); } observe() {} }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/chat-scroll.js'),'utf8'),context);
  let top = 0;
  const container = {clientHeight:100,children:[],getBoundingClientRect:() => ({top:0}),
    addEventListener:(name,fn) => handlers[name] = fn,
    get scrollHeight() { return this.children.reduce((total,child) => total + child.height,0); },
    get scrollTop() { return top; },set scrollTop(value) { top = Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight)); }};
  const message = (index,height) => ({dataset:{messageIndex:String(index)},height,getBoundingClientRect() {
    const y = container.children.slice(0,container.children.indexOf(this)).reduce((sum,child) => sum+child.height,0)-top;
    return {top:y,bottom:y+this.height};
  }});
  container.children = [message(0,200),message(1,200)];
  const button = {hidden:true,addEventListener:(name,fn) => button.click=fn};
  const scroll = context.module.exports.createChatScroll(container,button);
  function layout() { observers.forEach(fn => fn()); while(frames.length) frames.shift()(); }
  function move(value) { container.scrollTop=value; handlers.scroll(); }
  layout(); assert.equal(top,300);
  container.children[1].height=300;layout();assert.equal(top,400);
  move(240); assert.equal(button.hidden,false);
  container.children[1].height=400;layout();assert.equal(top,240);
  scroll.capture();container.children[0]=message(0,250);scroll.restore();
  assert.equal(top,290,'the same message and reading offset survive a redraw above it');
  container.children[0].height=300;layout();assert.equal(top,340,'late card resize preserves the reading anchor');
  button.click();assert.equal(top,600);assert.equal(button.hidden,true);
  container.children[1].height=450;layout();assert.equal(top,650);
  scroll.setEnabled(false);container.children[1].height=500;layout();assert.equal(top,650);assert.equal(button.hidden,false);
  button.click();assert.equal(top,700);
  container.children[1].height=550;layout();assert.equal(top,700,'Jump does not enable a disabled preference');
  scroll.setEnabled(true);assert.equal(top,750);
  handlers.wheel({deltaY:-20});container.children[1].height=600;layout();assert.equal(top,750,'upward wheel pauses before the scroll event');
  move(800);container.children[1].height=650;layout();assert.equal(top,850,'scrolling to the bottom resumes following');
});
