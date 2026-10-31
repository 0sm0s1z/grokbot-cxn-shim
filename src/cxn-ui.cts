import {createHash} from 'node:crypto';
type Model={id:string;displayName:string;provider?:string};
const clean=(s:string)=>s.replace(/[\r\n\t`<>\[\]*_]/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
export const alias=(id:string)=>'m-'+createHash('sha256').update(id).digest('hex').slice(0,12);
const name=(m:Model)=>{const n=clean(m.displayName);return n&&n!==m.id?n:/^[^/]{1,35}$/.test(m.id)?m.id:'Unnamed model'};
export function modelChoices(models:readonly Model[]){const counts=new Map<string,number>();for(const m of models){const n=name(m).toLowerCase();counts.set(n,(counts.get(n)??0)+1)}return models.map(m=>({id:m.id,alias:alias(m.id),name:name(m),label:name(m)+(counts.get(name(m).toLowerCase())!>1&&m.provider?` · ${clean(m.provider)}`:'')})).sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id))}
export function findModel(models:readonly Model[],query:string){const a=modelChoices(models),q=query.trim().toLowerCase();return a.filter(x=>x.id.toLowerCase()===q||x.alias===q||x.name.toLowerCase()===q||x.label.toLowerCase()===q)}
export function prettyWhen(t:number|null,now:number){if(t===null)return 'never';const n=Math.max(0,Math.floor((now-t)/60000));return n<1?'just now':n<60?`${n} min ago`:n<1440?`${Math.floor(n/60)} hr ago`:`${Math.floor(n/1440)} days ago`}
export function prettyDuration(ms:number){return ms<1000?`${ms} ms`:`${(ms/1000).toFixed(1)} sec`}
