'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createScratchStore}=require('../scratch-store.cjs'),{createLabScratchRouter}=require('../native-scratch.cjs');
test('scratch turns persist privately and merge with backend rows across store and router recreation',async()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'scratch-store-'));try{
  const file=path.join(d,'history.json'),store=createScratchStore(file),target={agentId:'scratch',sessionId:''},emitted=[];
  const opts={store,ready:()=>true,emit:(t,e)=>(emitted.push(...e),true),makeId:()=> 'unused',now:()=>123,complete:async()=> 'router answer'};
  let route=createLabScratchRouter(opts);
  await route('sendPrompt',{...target,clientNonce:'n1',prompt:'/shim-synthetic hello'});
  await route('sendPrompt',{...target,clientNonce:'n2',prompt:'/shim-router question'});
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  const child=spawnSync(process.execPath,['-e',`const s=require(${JSON.stringify(path.resolve('scratch-store.cjs'))}).createScratchStore(process.argv[1]);const v=s.read();process.stdout.write(JSON.stringify({turns:v.turns.length,selected:v.target.agentId}));`,file],{encoding:'utf8'});
  assert.equal(child.status,0);assert.deepEqual(JSON.parse(child.stdout),{turns:2,selected:'scratch'});
  const restored=createScratchStore(file),server=[{id:'server',seq:7,content:'native',timestampMs:100}];let merged=restored.merge(target,server);
  assert.equal(merged.length,5);assert.equal(merged[0],server[0]);assert.deepEqual(merged.slice(1).map(x=>x.seq),[8,9,10,11]);
  assert.equal(restored.merge({agentId:'different',sessionId:''},server),server);
  assert.equal(restored.merge(target,merged).length,5);
  const later=[{id:'server-later',seq:9,content:'native later',timestampMs:200}];
  assert.equal(restored.merge(target,later).at(-1),later[0]);
  let seen;route=createLabScratchRouter({...opts,store:restored,complete:async m=>(seen=m,'second')});
  await route('sendPrompt',{...target,clientNonce:'n3',prompt:'/shim-router followup'});
  assert.deepEqual(seen,[{role:'user',content:'question'},{role:'assistant',content:'router answer'},{role:'user',content:'followup'}]);
  await assert.rejects(route('sendPrompt',{...target,clientNonce:'n3',prompt:'/shim-router again'}),/duplicate/);
 }finally{fs.rmSync(d,{recursive:true,force:true})}
});
