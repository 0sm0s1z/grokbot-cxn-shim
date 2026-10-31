import {readFileSync,writeFileSync,renameSync,lstatSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';import {join} from 'node:path';
export const ORIGIN=process.env.CXN_ROUTER_ORIGIN??'https://router.example';
const origin=new URL(ORIGIN);if(origin.protocol!=='https:'||origin.origin!==ORIGIN)throw Error('CXN_ROUTER_ORIGIN must be an HTTPS origin');
type Model={id:string;displayName:string;provider?:string};
type Cache={version:1;models:Model[];syncedAt:number|null;checkedAt:number|null;availability:'unknown'|'available'|'unavailable';error:string|null};
const empty=():Cache=>({version:1,models:[],syncedAt:null,checkedAt:null,availability:'unknown',error:null});
export function keyFromFile(){const file=readFileSync(join(homedir(),'.config','cxn.env'),'utf8');const key=/^CXN_API_KEY=(.+)$/m.exec(file)?.[1]?.trim();if(!key)throw Error('key unavailable');return key}
export async function discoverModels():Promise<unknown>{const response=await fetch(`${ORIGIN}/v1/models`,{headers:{authorization:`Bearer ${keyFromFile()}`},redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json()}
export function createCatalog(file:string,discover:()=>Promise<unknown>=discoverModels,now:()=>number=Date.now){
 function read():Cache{try{if(lstatSync(file).isSymbolicLink())throw Error('cache symlink refused');const d=JSON.parse(readFileSync(file,'utf8'));if(d.version!==1||!Array.isArray(d.models))throw Error('invalid model cache');return d}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return empty();throw e}}
 function write(data:Cache){try{if(lstatSync(file).isSymbolicLink())throw Error('cache symlink refused')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}const tmp=`${file}.${randomUUID()}.tmp`;try{writeFileSync(tmp,JSON.stringify(data),{flag:'wx',mode:0o600});renameSync(tmp,file)}finally{try{unlinkSync(tmp)}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}}}
 let pending:Promise<Cache>|undefined;
 async function refresh(){if(pending)return pending;pending=(async()=>{const before=read(),checkedAt=now();try{const response:any=await discover();if(!response||!Array.isArray(response.data))throw Error('invalid model list');const seen=new Set<string>(),models:Model[]=[];for(const item of response.data){if(!item||typeof item.id!=='string'||!item.id||item.id.length>256||seen.has(item.id))continue;seen.add(item.id);models.push({id:item.id,displayName:typeof item.display_name==='string'?item.display_name:typeof item.name==='string'?item.name:item.id,...typeof item.owned_by==='string'?{provider:item.owned_by}:{}})}const next:Cache={version:1,models,syncedAt:checkedAt,checkedAt,availability:'available',error:null};write(next);return next}catch(e){const message=e instanceof Error&&/^HTTP \d{3}$/.test(e.message)?e.message:'model discovery failed';const next:Cache={...before,checkedAt,availability:'unavailable',error:message};write(next);return next}})();try{return await pending}finally{pending=undefined}}
 return {read,refresh,isStale:(d:Cache)=>d.syncedAt===null||now()-d.syncedAt>3600000};
}
