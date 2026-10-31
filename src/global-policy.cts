/** Policy and orchestration contracts only. No live Grok Bot hook supplies these proofs yet. */
export type Target = Readonly<{agentId:string;sessionId:string}>;
export type TextMessage = Readonly<{role:'system'|'user'|'assistant';content:string}>;
export type NativeRow = Readonly<{id:string;kind:string;role?:string;content?:unknown;timestampMs?:number;clientNonce?:string}>;
export type NativeSnapshot = Readonly<{target:Target;complete:boolean;generation:string;revision:string;rows:readonly NativeRow[]}>;
export type Proof = Readonly<{
  textOnly:boolean;
  /** System instructions and other native model context are available and equivalent. */
  nativeModelContextVerified:boolean;
  nativeSystemMessages:readonly Readonly<{role:'system';content:string}>[];
  /** True only when an integration has proved exact-once canonical persistence and native continuation. */
  canonicalContinuationVerified:boolean;
}>;
export type Request = Readonly<{target:Target;nonce:string;text:string;attachments?:readonly unknown[];richText?:string;replyToId?:string;signal:AbortSignal}>;
export type Decision = Readonly<{route:'native'|'router';reason:string}>;
export function routeLabel(decision:Decision):string {
  if(decision.route==='router')return 'Constellation: verified text-only turn';
  switch(decision.reason){
    case 'unsupported-content':return 'Native: attachments or rich content';
    case 'unsupported-native-context':return 'Native: conversation contains unsupported context';
    case 'text-only-not-proven':return 'Native: tool requirements are not established';
    case 'native-continuation-not-proven':return 'Native: native continuation is not established';
    case 'native-model-context-not-proven':return 'Native: model instructions are not available';
    case 'complete-context-not-proven':return 'Native: complete conversation context is unavailable';
    default:return 'Native: turn is not eligible';
  }
}
/** `hasMore` and loss counters must come from the native read before its lossy page projection. */
export function snapshotFromNativeRead(input:{target:Target;generation:number;revision:string;hasMore:boolean;unresolvedBodies:number;droppedRows:number;rows:readonly NativeRow[]}):NativeSnapshot {
  const complete=Number.isSafeInteger(input.generation)&&input.generation>0&&typeof input.revision==='string'&&input.revision.length>0&&input.hasMore===false&&
    input.unresolvedBodies===0&&input.droppedRows===0;
  return {target:input.target,generation:complete?String(input.generation):'',revision:input.revision,complete,rows:input.rows};
}
export interface Bridge {
  /** Atomic, idempotent canonical commit; must include the original user turn and assistant answer. */
  commit(target:Target,nonce:string,userText:string,answer:string,expected:{generation:string;revision:string},signal:AbortSignal):Promise<void>;
}
/** Must durably reserve a nonce and serialize work per conversation, even across restarts. */
export interface Journal {
  lookup(target:Target,nonce:string):'new'|'native'|'started'|'committed';
  /** Atomically records native ownership against any concurrent router claim. */
  markNative(target:Target,nonce:string):'native'|'started'|'committed'|'busy';
  claim(target:Target,nonce:string):'new'|'native'|'started'|'committed'|'busy';
  finish(target:Target,nonce:string,outcome:'committed'|'uncertain'):void;
}
export function keyOf(t:Target):string{return JSON.stringify([t.agentId,t.sessionId])}
export function evaluateTurn(req:Request,proof:Proof|undefined,snapshot:NativeSnapshot|undefined):Decision {
  if(!req.target.agentId||!req.nonce||!req.text.trim())return {route:'native',reason:'invalid-text'};
  if(req.attachments?.length||req.richText!==undefined||req.replyToId!==undefined)return {route:'native',reason:'unsupported-content'};
  if(!proof?.textOnly)return {route:'native',reason:'text-only-not-proven'};
  if(!proof.nativeModelContextVerified||!Array.isArray(proof.nativeSystemMessages)||
     proof.nativeSystemMessages.some(m=>m?.role!=='system'||typeof m.content!=='string'))return {route:'native',reason:'native-model-context-not-proven'};
  if(!proof.canonicalContinuationVerified)return {route:'native',reason:'native-continuation-not-proven'};
  if(!snapshot||!snapshot.complete||!snapshot.generation||!snapshot.revision||keyOf(snapshot.target)!==keyOf(req.target))return {route:'native',reason:'complete-context-not-proven'};
  const seen=new Set<string>(),allowed=new Set(['id','kind','role','content','timestampMs','clientNonce','seq']);let previous=-Infinity;
  for(const row of snapshot.rows){
    if(!row.id||seen.has(row.id)||row.kind!=='message'||(row.role!=='user'&&row.role!=='assistant')||
       Object.keys(row).some(key=>!allowed.has(key))||typeof row.content!=='string'||typeof row.timestampMs!=='number'||!Number.isFinite(row.timestampMs)||row.timestampMs<previous)
      return {route:'native',reason:'unsupported-native-context'};
    previous=row.timestampMs;seen.add(row.id);
  }
  return {route:'router',reason:'verified-text-only'};
}

/**
 * The caller must supply real, independently verified proofs and a canonical bridge.
 * Unselected calls return the native function's exact result. Once provider work starts,
 * failures never fall back to native, avoiding double processing.
 */
export function createGlobalPolicy<T>(options:{
  readonly bridge:Bridge;
  readonly journal:Journal;
  readonly complete:(messages:readonly TextMessage[],signal:AbortSignal)=>Promise<string>;
  readonly onRoute?:(target:Target,decision:Decision)=>void;
}){
  const operations=new Map<string,Promise<T>>(), busy=new Set<string>();
  return function dispatch(req:Request,proof:Proof|undefined,snapshot:NativeSnapshot|undefined,native:()=>T):T|Promise<T>{
    const chat=keyOf(req.target),operation=JSON.stringify([chat,req.nonce]);const prior=operations.get(operation);if(prior)return prior;
    let known:'new'|'native'|'started'|'committed';try{known=options.journal.lookup(req.target,req.nonce)}catch(e){return Promise.reject(e)}
    if(known==='started')return Promise.reject(new Error('prior routed turn has an uncertain outcome'));
    if(known==='committed')return Promise.resolve({accepted:true} as T);
    if(known==='native'){
      let owner:'native'|'started'|'committed'|'busy';try{owner=options.journal.markNative(req.target,req.nonce)}catch(e){return Promise.reject(e)}
      if(owner==='busy')return Promise.reject(new Error('conversation has an active routed turn'));
      if(owner!=='native')return Promise.reject(new Error('native ownership changed'));
      try{options.onRoute?.(req.target,{route:'native',reason:'already-native'})}catch{}return native();
    }
    if(known!=='new')return Promise.reject(new Error('invalid journal lookup'));
    const decision=evaluateTurn(req,proof,snapshot);
    if(decision.route==='native'){
      let owner:'native'|'started'|'committed'|'busy';try{owner=options.journal.markNative(req.target,req.nonce)}catch(e){return Promise.reject(e)}
      if(owner==='native'){try{options.onRoute?.(req.target,decision)}catch{}return native()}if(owner==='committed')return Promise.resolve({accepted:true} as T);
      if(owner==='busy')return Promise.reject(new Error('conversation has an active routed turn'));
      return Promise.reject(new Error('prior routed turn has an uncertain outcome'));
    }
    if(busy.has(chat))return Promise.reject(new Error('conversation has an active routed turn'));
    busy.add(chat);
    const work=(async()=>{
      req.signal.throwIfAborted();
      const claim=options.journal.claim(req.target,req.nonce);
      if(claim==='committed')return {accepted:true} as T;
      if(claim==='started')throw new Error('prior routed turn has an uncertain outcome');
      if(claim==='busy')throw new Error('conversation has an active routed turn');
      if(claim==='native')throw new Error('turn is already owned by native dispatch');
      if(claim!=='new')throw new Error('invalid journal claim');
      try{options.onRoute?.(req.target,decision)}catch{}
      let committed=false;
      try {
      const messages:TextMessage[]=[...proof!.nativeSystemMessages,...snapshot!.rows.filter(r=>r.role!=='user'||r.clientNonce!==req.nonce).map(r=>({role:r.role as 'user'|'assistant',content:r.content as string}))];
      messages.push({role:'user',content:req.text});
      const answer=await options.complete(messages,req.signal);req.signal.throwIfAborted();
      if(typeof answer!=='string'||!answer.trim())throw new Error('provider returned no text');
      await options.bridge.commit(req.target,req.nonce,req.text,answer,{generation:snapshot!.generation,revision:snapshot!.revision},req.signal);
      committed=true;
      return {accepted:true} as T;
      } finally {options.journal.finish(req.target,req.nonce,committed?'committed':'uncertain')}
    })();
    operations.set(operation,work);work.finally(()=>busy.delete(chat)).catch(()=>{});return work;
  }
}
