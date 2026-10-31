import {readFileSync,writeFileSync,renameSync,lstatSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

type Target={agentId:string;sessionId:string};
type Entry={id:string;kind:'message';role:'user'|'assistant';content:string;timestampMs:number;clientNonce?:string};
type Turn={nonce:string;prompt:string;modelPrompt:string;answer:string;at:number;synthetic:boolean};
type Data={version:1;target:Target;turns:Turn[]};
const same=(a:Target,b:Target)=>a.agentId===b.agentId&&a.sessionId===b.sessionId;
export function createScratchStore(file:string){
  function read():Data|undefined{
    try{if(lstatSync(file).isSymbolicLink())throw Error('scratch history symlink refused');const data=JSON.parse(readFileSync(file,'utf8'));
      if(data.version!==1||!data.target||typeof data.target.agentId!=='string'||typeof data.target.sessionId!=='string'||!Array.isArray(data.turns))throw Error('invalid scratch history');return data as Data;
    }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e}
  }
  function write(data:Data){
    try{if(lstatSync(file).isSymbolicLink())throw Error('scratch history symlink refused')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
    const temp=`${file}.${randomUUID()}.tmp`;
    try{writeFileSync(temp,JSON.stringify(data),{mode:0o600,flag:'wx'});renameSync(temp,file)}finally{try{unlinkSync(temp)}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}}
  }
  return {
    read,
    append(target:Target,turn:Turn){const state=read()??{version:1 as const,target,turns:[]};if(!same(state.target,target))throw Error('another conversation owns the scratch session');
      if(state.turns.some(t=>t.nonce===turn.nonce))throw Error('duplicate scratch turn');state.turns.push(turn);write(state)},
    merge(target:Target,server:readonly Record<string,unknown>[]):Record<string,unknown>[] {
      const state=read();if(!state||!same(state.target,target))return server as Record<string,unknown>[];
      const ids=new Set(server.map(x=>x.id));let seq=server.reduce<number>((n,x)=>typeof x.seq==='number'&&Number.isSafeInteger(x.seq)?Math.max(n,x.seq):n,0);
      const entries:Entry[]=[];for(const t of state.turns){const user:Entry={id:`scratch-user-${t.nonce}`,kind:'message',role:'user',content:t.prompt,clientNonce:t.nonce,timestampMs:t.at},assistant:Entry={id:`scratch-assistant-${t.nonce}`,kind:'message',role:'assistant',content:t.answer,timestampMs:t.at};for(const row of [user,assistant])if(!ids.has(row.id)){ids.add(row.id);entries.push(row)}}
      const merged=[...server];for(const row of entries){const entry={...row,seq:++seq};const position=merged.findIndex(item=>typeof item.timestampMs==='number'&&Number.isFinite(item.timestampMs)&&item.timestampMs>entry.timestampMs);if(position<0)merged.push(entry);else merged.splice(position,0,entry)}return merged;
    },
  };
}
let singleton:ReturnType<typeof createScratchStore>|undefined;
export function getScratchStore(){const f=process.env.GROKBOT_SCRATCH_STORE;if(!f)throw Error('scratch store is not configured');return singleton??=createScratchStore(f)}
