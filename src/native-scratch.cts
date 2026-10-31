/** Lab-only, in-memory transcript event helper. It is not installed in the app. */
export interface NativeScratchOptions {
  readonly agentId: string;
  readonly sessionId: string;
  readonly emit: (entries: readonly Record<string, unknown>[]) => boolean;
  readonly makeId: () => string;
  readonly now: () => number;
}
export function syntheticScratchSend(options: NativeScratchOptions, method: string,
  args: {agentId?: string; sessionId?: string; prompt?: string; clientNonce?: string; attachmentPaths?: readonly string[]}): {accepted: true} | undefined {
  if (!options.agentId || typeof options.sessionId !== 'string' || method !== 'sendPrompt' ||
      args.agentId !== options.agentId || (args.sessionId ?? '') !== options.sessionId) return undefined;
  if (typeof args.prompt !== 'string' || !args.prompt.trim() || !args.clientNonce || args.attachmentPaths?.length) {
    throw new Error('selected scratch turn must contain only text');
  }
  const timestampMs = options.now();
  const user = {id: args.clientNonce, kind:'message', role:'user', content:args.prompt,
    clientNonce:args.clientNonce, timestampMs};
  const assistant = {id:options.makeId(), kind:'message', role:'assistant',
    content:'Synthetic local fixture response. No router request was made.', timestampMs};
  if (!options.emit([user, assistant])) throw new Error('scratch transcript unavailable');
  return {accepted:true};
}

/** One selected text-only turn; provider and native event sink are explicit dependencies. */
export async function routedScratchSend(options: NativeScratchOptions & {
  readonly ready: () => boolean;
  readonly complete: (prompt: string, signal: AbortSignal) => Promise<string>;
}, method: string, args: {agentId?: string; sessionId?: string; prompt?: string;
  clientNonce?: string; attachmentPaths?: readonly string[]}, signal: AbortSignal): Promise<{accepted:true} | undefined> {
  if (!options.agentId || method !== 'sendPrompt' || args.agentId !== options.agentId ||
      (args.sessionId ?? '') !== options.sessionId) return undefined;
  if (typeof args.prompt !== 'string' || !args.prompt.trim() || !args.clientNonce || args.attachmentPaths?.length)
    throw new Error('selected scratch turn must contain only text');
  signal.throwIfAborted();
  if (!options.ready()) throw new Error('scratch transcript unavailable');
  const text=await options.complete(args.prompt,signal);
  signal.throwIfAborted();
  if (typeof text !== 'string' || !text.trim()) throw new Error('provider returned no text');
  const timestampMs=options.now();
  if (!options.emit([
    {id:args.clientNonce,kind:'message',role:'user',content:args.prompt,clientNonce:args.clientNonce,timestampMs},
    {id:options.makeId(),kind:'message',role:'assistant',content:text,timestampMs},
  ])) throw new Error('scratch transcript unavailable');
  return {accepted:true};
}

/** Explicit per-turn commands in the lab select one conversation; normal sends delegate. */
export function createLabScratchRouter(options:{
  readonly ready:(args:{agentId:string;sessionId:string})=>boolean;
  readonly emit:(args:{agentId:string;sessionId:string},entries:readonly Record<string,unknown>[])=>boolean;
  readonly complete:(messages:readonly {role:'user'|'assistant';content:string}[],signal:AbortSignal,target?:{agentId:string;sessionId:string})=>Promise<string>;
  readonly makeId:()=>string; readonly now:()=>number;
  readonly store?:{read:()=>{target:{agentId:string;sessionId:string};turns:{nonce:string;modelPrompt:string;answer:string;synthetic:boolean}[]}|undefined;
    append:(target:{agentId:string;sessionId:string},turn:{nonce:string;prompt:string;modelPrompt:string;answer:string;at:number;synthetic:boolean})=>void};
}) {
  const saved=options.store?.read();
  let selected:{agentId:string;sessionId:string}|undefined=saved?.target;
  let history:{role:'user'|'assistant';content:string}[]=saved?.turns.filter(t=>!t.synthetic).flatMap(t=>[
    {role:'user' as const,content:t.modelPrompt},{role:'assistant' as const,content:t.answer}])??[];
  let busy=false;
  return async (method:string,args:{agentId?:string;sessionId?:string;prompt?:string;clientNonce?:string;attachmentPaths?:readonly string[];richText?:string},signal?:AbortSignal):Promise<{accepted:true}|undefined>=>{
    if(method!=='sendPrompt'||typeof args.prompt!=='string')return;
    const synthetic=args.prompt.startsWith('/shim-synthetic '),explicitRouter=args.prompt.startsWith('/shim-router ');
    const isSelected=selected!==undefined&&args.agentId===selected.agentId&&(args.sessionId??'')===selected.sessionId;
    if(!synthetic&&!explicitRouter&&!isSelected)return;
    if(busy)throw Error('scratch turn already in progress');busy=true;
    try {
    if(!args.agentId||!args.clientNonce||args.attachmentPaths?.length)throw Error('scratch requires a text-only conversation');
    if(options.store?.read()?.turns.some(t=>t.nonce===args.clientNonce))throw Error('duplicate scratch turn');
    const target={agentId:args.agentId,sessionId:args.sessionId??''};
    if(!selected&&!synthetic)throw Error('start this scratch session with /shim-synthetic');
    if(selected&&(selected.agentId!==target.agentId||selected.sessionId!==target.sessionId))throw Error('another conversation owns the scratch session');
    const prompt=(synthetic?args.prompt.slice(16):explicitRouter?args.prompt.slice(13):args.prompt).trim();if(!prompt)throw Error('scratch prompt is empty');
    const sig=signal??new AbortController().signal;sig.throwIfAborted();
    if(!options.ready(target))throw Error('scratch transcript unavailable');
    const next=[...history,{role:'user' as const,content:prompt}];
    const text=synthetic?'Synthetic local fixture response. No router request was made.':await options.complete(next,sig,target);
    sig.throwIfAborted();if(typeof text!=='string'||!text.trim())throw Error('provider returned no text');
    const timestampMs=options.now();
    options.store?.append(target,{nonce:args.clientNonce,prompt:args.prompt,modelPrompt:prompt,answer:text,at:timestampMs,synthetic});
    selected=target;if(!synthetic)history=[...next,{role:'assistant',content:text}];
    if(!options.emit(target,[{id:`scratch-user-${args.clientNonce}`,kind:'message',role:'user',content:args.prompt,clientNonce:args.clientNonce,timestampMs},
      {id:`scratch-assistant-${args.clientNonce}`,kind:'message',role:'assistant',content:text,timestampMs}]))throw Error('scratch transcript unavailable');
    return {accepted:true};
    } finally {busy=false}
  };
}
