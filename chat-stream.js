const {StringDecoder}=require('node:string_decoder');

async function readCompletion(stream,onDelta,signal) {
  const decoder=new StringDecoder('utf8');
  let buffer='',content='',finishReason,usage;
  const calls=[];
  function frame(text) {
    const data=text.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data||data==='[DONE]')return;
    const item=JSON.parse(data);
    if(item.error)throw new Error('The model returned a streaming error. Try again.');
    if(item.usage)usage=item.usage;
    const choice=item.choices?.[0];if(!choice)return;
    if(choice.finish_reason)finishReason=choice.finish_reason;
    if(typeof choice.delta?.content==='string'){content+=choice.delta.content;onDelta(choice.delta.content);}
    for(const part of choice.delta?.tool_calls||[]) {
      if(!Number.isInteger(part.index)||part.index<0||part.index>11)throw new Error('Invalid streamed tool call');
      const call=calls[part.index]||={id:'',type:'function',function:{name:'',arguments:''}};
      call.id+=part.id||'';call.function.name+=part.function?.name||'';call.function.arguments+=part.function?.arguments||'';
    }
  }
  for await(const chunk of stream) {
    signal?.throwIfAborted();buffer+=decoder.write(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
    let match;while((match=/\r?\n\r?\n/.exec(buffer))){frame(buffer.slice(0,match.index));buffer=buffer.slice(match.index+match[0].length);}
  }
  buffer+=decoder.end();if(buffer.trim())frame(buffer);
  if(!finishReason)throw new Error('The model stream ended early. Incomplete edits cannot be applied.');
  return {choices:[{message:{role:'assistant',content,...(calls.length?{tool_calls:calls.filter(Boolean)}:{})},finish_reason:finishReason}],usage};
}
module.exports={readCompletion};
