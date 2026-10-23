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

test('OpenUI uses its fixed Gateway endpoint and free default model', async () => {
  const {client,calls}=mockClient(textResult);
  const result=await client.chat({...input,provider:'openui',model:undefined,baseUrl:'https://untrusted.example/v1'});
  assert.equal(calls[0].url,'https://api.thesys.dev/v1/embed/chat/completions');
  assert.equal(calls[0].body.model,'google/gemini-3.6-flash-free');
  assert.match(calls[0].body.messages[0].content,/\]\]>openui:config/);
  assert.match(calls[0].body.messages[0].content,/fenced apply JSON block OUTSIDE/);
  assert.equal(calls[0].body.max_tokens,8192);
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-provider-key');
  assert.equal(result.message.provider,'openui');
  assert.equal(result.message.content,'answer');
});

test('OpenUI normalizes Gateway envelopes without altering UI or apply blocks', async () => {
  const content='```openui-lang\nroot = TextContent("Summary")\n```\n\n```apply\n{"action":"create","filePath":"test.txt","content":"test"}\n```';
  const {client}=mockClient({choices:[{message:{content:']]>openui:content?thesys=true\n'+content+'\n]]>openui:end'},finish_reason:'stop'}]});
  const result=await client.chat({...input,provider:'openui'});
  assert.equal(result.message.content,content);
  assert.equal(result.message.provider,'openui');
});

test('OpenUI discovers free models and only accepts its server credential', async () => {
  const prior=process.env.THESYS_API_KEY;
  process.env.THESYS_API_KEY='test-gateway-env';
  try {
    const req={headers:{'x-api-key':'test-browser-key'},body:{baseUrl:'https://untrusted.example'}};
    assert.equal(getApiKey(req,'openui'),'test-gateway-env');
    delete process.env.THESYS_API_KEY;
    assert.equal(getApiKey(req,'openui'),'');
    const {client,calls}=mockClient({data:[{id:'google/test-free'},{id:'openai/paid-model'},{id:'google/test-free'}]});
    assert.deepEqual(await client.listModels({provider:'openui',apiKey:'test-gateway-key'}),['google/test-free']);
    assert.equal(calls[0].url,'https://api.thesys.dev/v1/embed/models');
  } finally {
    if(prior===undefined) delete process.env.THESYS_API_KEY; else process.env.THESYS_API_KEY=prior;
  }
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

test('OpenUI completes a bounded read-only tool loop and aggregates request usage', async () => {
  const calls=[], reads=[];
  const client=createProviderClient({post:async(url,body)=>{
    calls.push(structuredClone(body));
    return {data:calls.length===1 ? {choices:[{message:{content:null,tool_calls:[{id:'read-1',type:'function',function:{name:'obsidian_read',arguments:'{"path":"me.md"}'}}]}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}} : {...textResult,usage:{prompt_tokens:20,completion_tokens:5,total_tokens:25}}};
  }});
  const memory={bootstrap:async()=>'Read-only memory context',tools:[{type:'function',function:{name:'obsidian_read'}}],call:async(name,args)=>{reads.push({name,args});return {path:'me.md',content:'example'};}};
  const result=await client.chat({...input,provider:'openui',memory});
  assert.equal(calls.length,2);
  assert.equal(calls[1].messages.at(-1).role,'tool');
  assert.equal(calls[1].messages.at(-1).tool_call_id,'read-1');
  assert.deepEqual(reads,[{name:'obsidian_read',args:{path:'me.md'}}]);
  assert.deepEqual(result.usage,{prompt_tokens:30,completion_tokens:7,total_tokens:37});
  assert.equal(result.message.content,'answer');
});

test('memory is absent unless supplied and invalid tool arguments never reach MCP', async () => {
  const {client,calls}=mockClient(textResult);
  await client.chat({...input,provider:'openai'});
  assert.equal(calls[0].body.tools,undefined);
  assert.equal(calls[0].body.messages[0].content,input.system);
  let attempts=0;
  const loop=createProviderClient({post:async()=>({data:++attempts===1 ? {choices:[{message:{tool_calls:[{id:'bad',function:{name:'vault_delete',arguments:'invalid json'}}]}}]} : textResult})});
  await loop.chat({...input,provider:'openui',memory:{bootstrap:async()=>'',tools:[{type:'function',function:{name:'obsidian_read'}}],call:async()=>{throw new Error('must not call');}}});
  assert.equal(attempts,2);
});

test('all compatible providers support bounded Obsidian tools',async()=>{
  for(const provider of ['deepseek','openai','gemini','custom']){
    const requests=[],reads=[];
    const client=createProviderClient({post:async(url,body)=>{requests.push(structuredClone(body));return{data:requests.length===1?{choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'read',type:'function',function:{name:'obsidian_read',arguments:'{"path":"me.md"}'}}]},finish_reason:'tool_calls'}],usage:{total_tokens:3}}:textResult};}});
    const result=await client.chat({...input,provider,baseUrl:'http://127.0.0.1:4321/v1',memory:{bootstrap:async()=>'permitted memory',tools:[{type:'function',function:{name:'obsidian_read',parameters:{type:'object'}}}],call:async(name,args)=>{reads.push({name,args});return{content:'read context'};}}});
    assert.equal(reads.length,1,provider);assert.equal(requests[1].messages.at(-1).role,'tool');assert.equal(result.message.content,'answer');
    assert.ok(!requests[0].messages[0].content.includes('openui-lang'));
  }
});

test('Claude uses native tool schemas and tool results with aggregated usage',async()=>{
  const requests=[],operations=[];
  const client=createProviderClient({post:async(url,body)=>{requests.push(structuredClone(body));return{data:requests.length===1?{content:[{type:'tool_use',id:'t1',name:'obsidian_create',input:{title:'Draft',content:'verified lesson'}}],stop_reason:'tool_use',usage:{input_tokens:10,output_tokens:3}}:{content:[{type:'text',text:'Saved the draft.'}],stop_reason:'end_turn',usage:{input_tokens:20,output_tokens:5}}};}});
  const result=await client.chat({...input,provider:'anthropic',memory:{bootstrap:async()=>'write mode',tools:[{type:'function',function:{name:'obsidian_create',description:'Save draft',parameters:{type:'object'}}}],call:async(name,args)=>{operations.push({name,args});return{saved:true,path:'project/draft.md'};}}});
  assert.equal(requests[0].tools[0].name,'obsidian_create');assert.deepEqual(requests[0].tools[0].input_schema,{type:'object'});
  assert.equal(requests[1].messages.at(-1).content[0].type,'tool_result');assert.equal(operations.length,1);
  assert.equal(result.usage.total_tokens,38);assert.equal(result.message.content,'Saved the draft.');
});

test('truncated tool calls never execute note writes',async()=>{
  let writes=0;const memory={bootstrap:async()=>'',tools:[],call:async()=>{writes++;}};
  const {client}=mockClient({choices:[{message:{content:'incomplete',tool_calls:[{id:'write',function:{name:'obsidian_create',arguments:'{}'}}]},finish_reason:'length'}]});
  assert.equal((await client.chat({...input,provider:'openai',memory})).truncated,true);assert.equal(writes,0);
});

test('repeated tool requests stop at the request budget', async () => {
  let attempts=0;
  const client=createProviderClient({post:async()=>{attempts++;return {data:{choices:[{message:{tool_calls:[{id:'repeat',function:{name:'obsidian_search',arguments:'{"query":"example"}'}}]}}]}};}});
  await assert.rejects(client.chat({...input,provider:'openui',memory:{bootstrap:async()=>'',tools:[{type:'function',function:{name:'obsidian_search'}}],call:async()=>({paths:[]})}}),/tool limit/);
  assert.equal(attempts,5);
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


test('repository and memory tools share one bounded compatible loop with activity events',async()=>{
 const requests=[],events=[],executed=[];
 const client=createProviderClient({post:async(_url,body)=>{requests.push(structuredClone(body));return {data:requests.length===1?{choices:[{message:{tool_calls:[{id:'r',function:{name:'repository_read',arguments:'{"path":"a.js"}'}},{id:'m',function:{name:'obsidian_read',arguments:'{"path":"me.md"}'}}]},finish_reason:'tool_calls'}],usage:{total_tokens:3}}:textResult};}});
 const schema=name=>({type:'function',function:{name,parameters:{type:'object'}}});
 const agent={tools:[schema('repository_read')],execute:async(name,args)=>{executed.push(name);return {content:'repo'};},maxRounds:3};
 const memory={bootstrap:async()=>'',tools:[schema('obsidian_read')],call:async(name)=>{executed.push(name);return {content:'memory'};}};
 const result=await client.chat({...input,provider:'openai',agent,memory,onProgress:event=>events.push(event)});
 assert.equal(result.message.content,'answer');assert.deepEqual(executed,['repository_read','obsidian_read']);assert.equal(requests[0].tools.length,2);assert.equal(events.filter(event=>event.type==='tool-result').length,2);
});
