'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {syntheticScratchSend,routedScratchSend,createLabScratchRouter}=require('../native-scratch.cjs');
test('lab commands bind one conversation, delegate ordinary sends, and retain successful router context',async()=>{
  const seen=[],events=[];const run=createLabScratchRouter({ready:()=>true,emit:(t,e)=>(events.push({t,e}),true),makeId:()=> 'reply',now:()=>1,complete:async(m)=>{seen.push(m);return 'router response'}});
  const args={agentId:'scratch',sessionId:'s',clientNonce:'nonce'};
  assert.equal(await run('sendPrompt',{...args,prompt:'ordinary message'}),undefined);
  await assert.rejects(run('sendPrompt',{...args,prompt:'/shim-router first'}),/start/);
  assert.deepEqual(await run('sendPrompt',{...args,prompt:'/shim-synthetic hello'}),{accepted:true});
  await assert.rejects(run('sendPrompt',{...args,agentId:'other',prompt:'/shim-router test'}),/another conversation/);
  assert.deepEqual(await run('sendPrompt',{...args,prompt:'/shim-router first'}),{accepted:true});
  assert.equal(await run('sendPrompt',{...args,agentId:'other',prompt:'ordinary'}),undefined);
  assert.deepEqual(await run('sendPrompt',{...args,prompt:'second'}),{accepted:true});
  assert.deepEqual(seen[1],[{role:'user',content:'first'},{role:'assistant',content:'router response'},{role:'user',content:'second'}]);
  assert.match(events[0].e[1].content,/Synthetic/);
});
test('synthetic native events require both selected identifiers and preserve the client nonce',()=>{
  const entries=[]; const opts={agentId:'agent-fixture',sessionId:'session-fixture',emit:e=>(entries.push(...e),true),makeId:()=> 'reply-fixture',now:()=>100};
  const args={agentId:'agent-fixture',sessionId:'session-fixture',prompt:'fixture',clientNonce:'nonce'};
  assert.equal(syntheticScratchSend(opts,'sendPrompt',{...args,sessionId:'other'}),undefined);
  assert.equal(entries.length,0);
  assert.deepEqual(syntheticScratchSend(opts,'sendPrompt',args),{accepted:true});
  assert.equal(entries[0].clientNonce,'nonce');assert.equal(entries[1].role,'assistant');
  assert.match(entries[1].content,/Synthetic local fixture/);
});
test('router adapter delegates unrelated turns and renders only a selected successful completion',async()=>{
  let calls=0;const entries=[];const opts={agentId:'a',sessionId:'',ready:()=>true,emit:e=>(entries.push(...e),true),makeId:()=> 'r',now:()=>2,complete:async(p)=>{calls++;assert.equal(p,'fixture prompt');return 'fixture router response'}};
  const signal=new AbortController().signal;
  assert.equal(await routedScratchSend(opts,'sendPrompt',{agentId:'other',prompt:'fixture prompt',clientNonce:'n'},signal),undefined);
  assert.equal(calls,0);
  assert.deepEqual(await routedScratchSend(opts,'sendPrompt',{agentId:'a',prompt:'fixture prompt',clientNonce:'n'},signal),{accepted:true});
  assert.equal(calls,1);assert.equal(entries[1].content,'fixture router response');
});
test('router adapter does not render on failure or cancellation',async()=>{
  let emitted=0;const controller=new AbortController();const opts={agentId:'a',sessionId:'s',ready:()=>true,emit:()=>{emitted++;return true},makeId:()=> 'r',now:()=>2,complete:async()=>{controller.abort();return 'late'}};
  await assert.rejects(routedScratchSend(opts,'sendPrompt',{agentId:'a',sessionId:'s',prompt:'p',clientNonce:'n'},controller.signal),{name:'AbortError'});assert.equal(emitted,0);
});
test('selected unsupported input or unavailable transcript does not return acceptance',()=>{
  const opts={agentId:'a',sessionId:'s',emit:()=>false,makeId:()=> 'r',now:()=>1};
  assert.throws(()=>syntheticScratchSend(opts,'sendPrompt',{agentId:'a',sessionId:'s',prompt:'p',clientNonce:'n',attachmentPaths:['fixture']}),/text/);
  assert.throws(()=>syntheticScratchSend(opts,'sendPrompt',{agentId:'a',sessionId:'s',prompt:'p',clientNonce:'n'}),/unavailable/);
});
