const test = require('node:test');
const assert = require('node:assert/strict');
const { splitMessage } = require('../public/openui-chat');

const ui='```openui-lang\nroot = TextContent("Summary")\n```';
const message={role:'assistant',provider:'openui',content:ui};

test('UI rendering is limited to successful OpenUI assistant messages', () => {
  assert.deepEqual(splitMessage(message),[{type:'ui',content:'root = TextContent("Summary")'}]);
  for(const override of [{provider:'openai'},{provider:'deepseek'},{provider:'custom'},{provider:undefined},{role:'user'},{error:true}]) {
    assert.deepEqual(splitMessage({...message,...override}),[{type:'text',content:ui}]);
  }
});

test('mixed replies preserve normal code and independently reviewed apply controls', () => {
  const code='```js\nconst value = 1;\n```\n';
  const apply='\n```apply\n{"filePath":"test.js","content":"const value = 2;"}\n```';
  assert.deepEqual(splitMessage({...message,content:code+ui+apply}),[
    {type:'text',content:code},
    {type:'ui',content:'root = TextContent("Summary")'},
    {type:'text',content:apply},
  ]);
});

test('old plain messages and incomplete UI fences remain readable text', () => {
  for(const content of ['A normal answer','```openui-lang\nroot = TextContent("partial")']) {
    assert.deepEqual(splitMessage({...message,content}),[{type:'text',content}]);
  }
});

test('code samples containing OpenUI text are not rendered as live UI', () => {
  const content='```js\nconst sample = "```openui-lang\\nroot = TextContent(\\"example\\")";\n```';
  assert.deepEqual(splitMessage({...message,content}),[{type:'text',content}]);
});
