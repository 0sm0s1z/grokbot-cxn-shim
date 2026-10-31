import {keyFromFile,ORIGIN} from './cxn-catalog.cjs';

export function classifyRouterError(e:unknown,signal:AbortSignal):string {if(signal.aborted)return 'canceled';if(e instanceof Error){const m=/^router HTTP ([1-5][0-9]{2})$/.exec(e.message);if(m)return `HTTP ${m[1]}`;if(e.name==='TimeoutError')return 'timeout';if(e.name==='AbortError')return 'canceled';if(e instanceof TypeError)return 'network error'}return 'error'}

/** Router completions contain only the supplied conversation context. */
export async function completeScratch(messages: readonly {role:'user'|'assistant';content:string}[], signal: AbortSignal, model='gpt-6-luna', report?:(stats:{success:boolean;checkedAt:number;durationMs:number;failure?:string;usage?:Record<string,number>})=>void): Promise<string> {
  const start=Date.now();
  try { const key=keyFromFile();
  const response=await fetch(`${ORIGIN}/v1/chat/completions`, {
    method:'POST', redirect:'error', signal:AbortSignal.any([signal,AbortSignal.timeout(45000)]),
    headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
    body:JSON.stringify({model,messages:[{role:'system',content:`You are a text-only assistant in a local test conversation. The configured model identifier is ${model}, accessed through Constellation Router; report that identifier if asked and do not claim to verify details beyond this configuration. You have no tools or access to external systems. Do not claim to have performed actions you cannot perform.`},...messages],max_tokens:256}),
  });
  if (!response.ok) throw new Error(`router HTTP ${response.status}`);
  const data: any=await response.json();
  const text=data.choices?.[0]?.message?.content;
  if (typeof text!=='string' || !text.trim()) throw new Error('router returned no text');
  process.stderr.write('[grokbot-scratch] '+JSON.stringify({status:response.status,model:data.model??null,
    requestId:response.headers.get('x-request-id')??data.id??null,usage:data.usage??null})+'\n');
  const usage:Record<string,number>={};for(const k of ['prompt_tokens','completion_tokens','total_tokens'])if(typeof data.usage?.[k]==='number'&&Number.isFinite(data.usage[k]))usage[k]=data.usage[k];report?.({success:true,checkedAt:Date.now(),durationMs:Date.now()-start,...Object.keys(usage).length?{usage}:{}});return text;
  } catch(e){report?.({success:false,checkedAt:Date.now(),durationMs:Date.now()-start,failure:classifyRouterError(e,signal)});throw e}
}
