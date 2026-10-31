'use strict';
// Builds a reviewable source-only proposal; this never modifies an app or archive.
const fs=require('node:fs'),path=require('node:path');
const {readEntry,digest}=require('../installer/dist/asar.cjs');
const backup=path.resolve('lab/Grok Bot Transport Lab.app.grokbot-shim-backup/before-scratch.asar');
const app=fs.existsSync(backup)?backup:path.resolve('lab/Grok Bot Transport Lab.app/Contents/Resources/app.asar');
const original=readEntry(fs.readFileSync(app),'dist/node-agent-coordinator/main.cjs');
if(digest(original)!=='e1a2bf5b2112dce2374546107599050cd099c915639cc6bc9bc3d3739f5b6557')throw Error('unsupported coordinator hash');
let source=original.toString('utf8');
function replace(before,after){if(source.split(before).length!==2)throw Error('coordinator anchor mismatch');source=source.replace(before,after)}
// The explicit lab-only commands select one conversation, and all other sends delegate.
replace('return{async dispatchCommand(O,$,j){let ce=await P(O,$)',
  'return{async dispatchCommand(O,$,j){if(O==="sendPrompt"&&n.onScratch){j?.signal?.throwIfAborted();let v=await n.onScratch(O,$,j?.signal);if(v!==void 0)return v}let ce=await P(O,$)');
replace('return{start:Qt,stop(){On(),z(d2(A))',
  'return{scratchReady(p){return !!g.get(Lt(p.agentId,p.sessionId))&&A.kind!=="stopped"&&se(p.agentId)},scratchEmit(p,entries){let x=g.get(Lt(p.agentId,p.sessionId));if(!x||A.kind==="stopped"||!se(p.agentId))return false;let seq=Math.max(Number(x.maxLiveSeq),x.scratchSeq??0);for(let entry of entries)ke({type:"appended",entry:{...entry,seq:++seq},agentId:p.agentId,ordered:Ct(x)});x.scratchSeq=seq;return true},start:Qt,stop(){On(),z(d2(A))');
replace(';if(_.rehydrate===!0){Yn.nextBeforeSeq',
  ';if(process.env.GROKBOT_SCRATCH_MODE==="test")Yn.entries=require("./grokbot-scratch/scratch-store.cjs").getScratchStore().merge({agentId:p.agentId,sessionId:p.sessionId},Yn.entries);if(_.rehydrate===!0){Yn.nextBeforeSeq');
replace('let ke=iW({gateway:j,control:i.commands,log:Vt,harnessOf:h.harnessOf,',
  'let scratchRouter;let ke=iW({gateway:j,control:i.commands,log:Vt,onScratch:(method,args,signal)=>{if(process.env.GROKBOT_SCRATCH_MODE!=="test")return;if(!scratchRouter){scratchRouter=require("./grokbot-scratch/native-scratch.cjs").createLabScratchRouter({store:require("./grokbot-scratch/scratch-store.cjs").getScratchStore(),ready:target=>Je.scratchReady(target),emit:(target,entries)=>Je.scratchEmit(target,entries),makeId:()=>(0,oj.randomUUID)(),now:()=>Date.now(),complete:(messages,sig)=>require("./grokbot-scratch/router.cjs").completeScratch(messages,sig)});process.stderr.write("[grokbot-scratch] adapter ready\\n")}return scratchRouter(method,args,signal)},harnessOf:h.harnessOf,');
const out=path.resolve('lab/coordinator-scratch-proposal.cjs');fs.writeFileSync(out,source,{flag:'w'});
console.log(JSON.stringify({sourceOnly:true,appModified:false,coordinatorSha256:digest(original),proposalSha256:digest(Buffer.from(source)),output:out}));
