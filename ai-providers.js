const axios = require('axios');
const { generateSystemPrompt, parseMessage } = require('@openuidev/lang-core');
const openuiLibrary = require('./openui-library.json');
const {readCompletion}=require('./chat-stream');

const PROVIDERS = Object.freeze({
  deepseek: { url: 'https://api.deepseek.com/v1', env: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-flash' },
  openai: { url: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY', defaultModel: 'gpt-4.1' },
  anthropic: { url: 'https://api.anthropic.com/v1', env: 'ANTHROPIC_API_KEY', defaultModel: '' },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY', defaultModel: '' },
  openui: { url: 'https://api.thesys.dev/v1/embed', env: 'THESYS_API_KEY', defaultModel: 'google/gemini-3.6-flash-free' },
  custom: { url: '', env: 'CUSTOM_AI_API_KEY', defaultModel: '' },
});

function providerConfig(provider = 'deepseek', baseUrl) {
  const preset = PROVIDERS[provider];
  if (!preset) throw new Error('Unsupported AI provider');
  let url = preset.url;
  if (provider === 'custom') {
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new Error('Enter a custom API base URL');
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('API base URL must be HTTP(S), without credentials, query parameters, or fragments');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !local) throw new Error('Use HTTPS for remote AI endpoints');
    url = parsed.href.replace(/\/+$/, '');
  }
  return { ...preset, provider, url };
}

function getApiKey(req, provider = 'deepseek') {
  const config = providerConfig(provider, req.body.baseUrl);
  if (provider === 'openui') return process.env.THESYS_API_KEY || '';
  return req.headers['x-api-key'] || process.env[config.env] || '';
}

function createProviderClient(http = axios) {
  function options(config, apiKey) {
    if (!apiKey && config.provider !== 'custom') throw new Error('No API key provided for this provider');
    const headers = { 'Content-Type': 'application/json' };
    if (config.provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return { headers, timeout: 180000, maxRedirects: 0 };
  }

  async function listModels({ provider = 'deepseek', baseUrl, apiKey }) {
    const config = providerConfig(provider, baseUrl);
    const ids = [];
    let after;
    for (let page = 0; page < 10; page++) {
      const url = config.url + '/models' + (after ? '?after_id=' + encodeURIComponent(after) : '');
      const response = await http.get(url, options(config, apiKey));
      if (!Array.isArray(response.data?.data)) throw new Error('Provider returned an invalid model list');
      for (const item of response.data.data) if (typeof item.id === 'string') ids.push(item.id);
      if (provider !== 'anthropic' || !response.data.has_more || !response.data.last_id || response.data.last_id === after) break;
      after = response.data.last_id;
    }
    return [...new Set(ids)].filter(id => provider !== 'openui' || id.endsWith('-free')).sort();
  }

  async function chat({ provider = 'deepseek', baseUrl, apiKey, model, system, messages, maxTokens = 8192, memory, agent, onProgress=()=>{}, onDelta, signal }) {
    const config = providerConfig(provider, baseUrl);
    model = model || config.defaultModel;
    if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new Error('Choose a valid model ID');
    if (!Array.isArray(messages) || !messages.length || messages.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) {
      throw new Error('Chat messages must contain user or assistant text');
    }
    if (!Number.isInteger(maxTokens) || maxTokens < 512 || maxTokens > 65536) throw new Error('Output limit must be between 512 and 65536 tokens');
    const cleanMessages = messages.map(({ role, content }) => ({ role, content }));
    signal?.throwIfAborted();
    if (memory) {onProgress({type:'status',text:'Reading Obsidian instructions'});system += '\n\n' + await memory.bootstrap();}
    if (provider === 'openui') system = generateSystemPrompt({ cloud: true, library:openuiLibrary, instructions: system + `
For explanations, summaries, comparisons and data, respond with the built-in OpenUI components inside a fenced openui-lang block. Prefer readable cards, tables and headings appropriate to a narrow chat pane. State missing information instead of inventing project facts or measurements.
Do not invent images or add decorative stock photos. For text-only data, use Card and TextContent instead of image-based ProductCard components.
When proposing file changes, keep every literal fenced apply JSON block OUTSIDE the openui-lang fence, following the file-edit format above. Do not put apply blocks inside a component string. Use OpenUI for the explanation, and the separate apply blocks for reviewable edits.
Use presentational components and local interactions. No backend tools are connected to generated views: do not emit Query, Mutation, external network actions or automatic file operations. UI buttons cannot apply code changes. Never output raw executable HTML or JavaScript.` });
    const requestOptions = options(config, apiKey);
    if(signal)requestOptions.signal=signal;
    const tools=[...(memory?.tools||[]),...(agent?.tools||[])];
    const hasTools=tools.length>0;
    const roundLimit=agent?.maxRounds||5;
    let toolCount=0;
    async function useTool(name,args){
      signal?.throwIfAborted();
      const started=Date.now();
      const known=tools.some(tool=>tool.function.name===name);
      if(!known)return {error:'Tool is unavailable or disabled'};
      onProgress({type:'tool-start',name,text:'Started '+name});
      let result;
      try{result=name.startsWith('obsidian_')?await memory.call(name,args):await agent.execute(name,args);}
      catch(error){result={error:error.message||'Tool failed. Do not claim it succeeded.'};}
      const output=JSON.stringify(result);
      onProgress({type:result?.error?'tool-error':'tool-result',name,text:name+(result?.error?' failed':' finished'),output:output.slice(0,24000),duration:Date.now()-started,...(result?.screenshotUrl?{screenshotUrl:result.screenshotUrl}:{})});
      return result;
    }
    let data, text, finishReason, usage;
    if (provider === 'anthropic') {
      onProgress({type:'status',text:'Waiting for Claude’s response'});
      const body={model,system,messages:cleanMessages,max_tokens:maxTokens,stream:false};
      const totals={input_tokens:0,output_tokens:0};
      for(let round=0;round<roundLimit;round++){
        signal?.throwIfAborted();
        if(hasTools){body.tools=tools.map(({function:tool})=>({name:tool.name,description:tool.description,input_schema:tool.parameters}));body.tool_choice={type:round===roundLimit-1||toolCount>=12?'none':'auto'};}
        data=(await http.post(config.url+'/messages',body,requestOptions)).data;
        if(hasTools)for(const key of Object.keys(totals))totals[key]+=Number(data.usage?.[key])||0;
        const calls=(data.content||[]).filter(block=>block.type==='tool_use');
        if(!hasTools||!calls.length||data.stop_reason==='max_tokens')break;
        if(round===roundLimit-1||toolCount+calls.length>12)throw new Error('Agent tool limit reached. Review the results and continue with a focused request.');
        body.messages.push({role:'assistant',content:data.content});
        const results=[];
        for(const call of calls){
          if(typeof call.id!=='string'||call.id.length>200)throw new Error('Invalid agent tool call');
          if(!call.input||typeof call.input!=='object'||JSON.stringify(call.input).length>16000)throw new Error('Invalid agent tool arguments');
          toolCount++;const result=await useTool(call.name,call.input);
          results.push({type:'tool_result',tool_use_id:call.id,content:JSON.stringify(result),...(result.error?{is_error:true}:{})});
        }
        body.messages.push({role:'user',content:results});
      }
      text = (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
      finishReason = data.stop_reason;
      usage = hasTools?{...totals,total_tokens:totals.input_tokens+totals.output_tokens}:data.usage;
    } else {
      const body = { model, messages: [{ role: 'system', content: system }, ...cleanMessages], stream: Boolean(onDelta) };
      if(onDelta){requestOptions.responseType='stream';if(['openai','openui'].includes(provider))body.stream_options={include_usage:true};}
      body[provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
      const totals = {prompt_tokens:0,completion_tokens:0,total_tokens:0};
      for (let round = 0; round < roundLimit; round++) {
        signal?.throwIfAborted();
        onProgress({type:'status',text:round?'Generating response with retrieved context':'Waiting for '+(provider==='openui'?'OpenUI':provider)});
        onProgress({type:'reset'});
        if (hasTools) { body.tools = tools; body.tool_choice = round === roundLimit-1 || toolCount >= 12 ? 'none' : 'auto'; }
        const response = await http.post(config.url + '/chat/completions', body, requestOptions);
        data = onDelta ? await readCompletion(response.data,onDelta,signal) : response.data;
        if (hasTools) for (const key of Object.keys(totals)) totals[key] += Number(data.usage?.[key]) || 0;
        const message = data.choices?.[0]?.message;
        if (!hasTools || !message?.tool_calls?.length || ['length','max_tokens'].includes(data.choices?.[0]?.finish_reason)) break;
        if (round === roundLimit-1 || toolCount + message.tool_calls.length > 12) throw new Error('Agent tool limit reached. Review the results and continue with a focused request.');
        body.messages.push({role:'assistant',content:message.content || null,tool_calls:message.tool_calls});
        for (const call of message.tool_calls) {
          if (typeof call.id !== 'string' || call.id.length > 200) throw new Error('Invalid agent tool call');
          toolCount++;
          let result;
          try {
            if (typeof call.function?.arguments !== 'string' || call.function.arguments.length > 16000) throw new Error();
            result = await useTool(call.function.name,JSON.parse(call.function.arguments));
          } catch { result = {error:'Tool operation denied or unavailable. Do not claim it succeeded.'}; }
          body.messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
        }
      }
      text = data.choices?.[0]?.message?.content;
      finishReason = data.choices?.[0]?.finish_reason;
      usage = hasTools ? totals : data.usage;
    }
    if (provider === 'openui' && typeof text === 'string') text = parseMessage(text).content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('Model returned no text. Try a larger output limit or a text chat model.');
    return { message: { role: 'assistant', content: text, provider, model }, usage, finishReason,
      truncated: finishReason === 'length' || finishReason === 'max_tokens' };
  }
  return { listModels, chat };
}

module.exports = { PROVIDERS, providerConfig, getApiKey, createProviderClient };
