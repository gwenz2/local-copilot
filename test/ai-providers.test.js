const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderClient, providerConfig, getApiKey } = require('../ai-providers');
const { panelWidths } = require('../public/workbench');

function mockClient(data) {
  const calls = [];
  const http = {
    post: async (url, body, options) => { calls.push({url,body,options}); return {data}; },
    get: async (url, options) => { calls.push({url,options}); return {data}; },
  };
  return { client:createProviderClient(http), calls };
}
const input = { apiKey:'test-provider-key', model:'test-chat-model', system:'system instructions', messages:[{role:'user',content:'hello',error:false}], maxTokens:8192 };
const textResult = { choices:[{message:{content:'answer'},finish_reason:'stop'}], usage:{prompt_tokens:10,completion_tokens:5} };

test('OpenAI adapter uses its endpoint, auth, completion limit, and clean message schema', async () => {
  const {client,calls}=mockClient(textResult);
  const result = await client.chat({...input,provider:'openai'});
  assert.equal(calls[0].url,'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].body.max_completion_tokens,8192);
  assert.equal(calls[0].body.max_tokens,undefined);
  assert.deepEqual(calls[0].body.messages,[{role:'system',content:'system instructions'},{role:'user',content:'hello'}]);
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-provider-key');
  assert.equal(calls[0].options.maxRedirects,0);
  assert.equal(result.message.content,'answer');
  assert.equal(result.truncated,false);
});

test('Claude adapter uses Messages API and normalizes text blocks and truncation', async () => {
  const {client,calls}=mockClient({content:[{type:'thinking',thinking:'not user text'},{type:'text',text:'first'},{type:'text',text:'second'}],stop_reason:'max_tokens',usage:{input_tokens:12,output_tokens:3}});
  const result = await client.chat({...input,provider:'anthropic'});
  assert.equal(calls[0].url,'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].options.headers['x-api-key'],'test-provider-key');
  assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.equal(calls[0].options.headers['anthropic-version'],'2023-06-01');
  assert.equal(calls[0].body.system,'system instructions');
  assert.deepEqual(calls[0].body.messages,[{role:'user',content:'hello'}]);
  assert.equal(result.message.content,'first\nsecond');
  assert.equal(result.truncated,true);
});

test('DeepSeek and Gemini route only to their fixed provider endpoints', async () => {
  for (const [provider, url] of [['deepseek','https://api.deepseek.com/v1/chat/completions'],['gemini','https://generativelanguage.googleapis.com/v1beta/openai/chat/completions']]) {
    const {client,calls}=mockClient({...textResult,choices:[{message:{content:'partial'},finish_reason:'length'}]});
    const result=await client.chat({...input,provider,baseUrl:'https://ignored.example/v1'});
    assert.equal(calls[0].url,url);
    assert.equal(calls[0].body.max_tokens,8192);
    assert.equal(result.truncated,true);
  }
});

test('custom compatible adapter supports a local endpoint without credentials', async () => {
  const {client,calls}=mockClient(textResult);
  await client.chat({...input,provider:'custom',baseUrl:'http://127.0.0.1:11434/v1/',apiKey:''});
  assert.equal(calls[0].url,'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization,undefined);
  for (const url of ['http://remote.example/v1','https://user:password@example.com/v1','https://example.com/v1?key=secret','file:///tmp']) assert.throws(()=>providerConfig('custom',url));
});

test('provider validation rejects invalid requests before contacting upstream', async () => {
  const {client,calls}=mockClient(textResult);
  for(const override of [{provider:'invalid'},{provider:'anthropic',model:''},{messages:[{role:'system',content:'override'}]},{maxTokens:0},{apiKey:''}]) await assert.rejects(client.chat({...input,...override}));
  assert.equal(calls.length,0);
  assert.throws(()=>providerConfig('invalid'));
});

test('model discovery deduplicates IDs and follows Claude pagination', async () => {
  const calls=[];
  const client=createProviderClient({get:async (url,options)=>{
    calls.push({url,options});
    return {data:calls.length===1?{data:[{id:'model-a'}],has_more:true,last_id:'model-a'}:{data:[{id:'model-a'},{id:'model-b'}],has_more:false}};
  }});
  assert.deepEqual(await client.listModels({provider:'anthropic',apiKey:'test-claude-key'}),['model-a','model-b']);
  assert.equal(calls.length,2);
  assert.ok(calls[1].url.endsWith('after_id=model-a'));
});

test('missing text yields an actionable error instead of a broken chat message', async () => {
  const {client}=mockClient({choices:[{message:{content:null},finish_reason:'length'}]});
  await assert.rejects(client.chat(input),/no text/);
});

test('environment credentials are isolated by provider', () => {
  const priorDeepseek=process.env.DEEPSEEK_API_KEY,priorOpenai=process.env.OPENAI_API_KEY;
  process.env.DEEPSEEK_API_KEY='test-deepseek-env'; delete process.env.OPENAI_API_KEY;
  try {
    const req={headers:{},body:{}};
    assert.equal(getApiKey(req,'deepseek'),'test-deepseek-env');
    assert.equal(getApiKey(req,'openai'),'');
  } finally {
    if(priorDeepseek===undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY=priorDeepseek;
    if(priorOpenai===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=priorOpenai;
  }
});

test('panel widths reserve editor space when both panels are expanded', () => {
  for(const total of [720,850,1280,1920]) {
    const widths=panelWidths(total,500,900,true,true);
    assert.ok(widths.left>=160 && widths.right>=220);
    assert.ok(widths.left+widths.right+10+280<=total);
  }
  assert.deepEqual(panelWidths(1280,260,420,false,false),{left:0,right:0});
});
