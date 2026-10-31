'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGlobalPolicy,evaluateTurn,snapshotFromNativeRead,routeLabel}=require('../global-policy.cjs');
const proof={textOnly:true,nativeModelContextVerified:true,nativeSystemMessages:[{role:'system',content:'fixture instructions'}],canonicalContinuationVerified:true};
const target=(agentId,sessionId='')=>({agentId,sessionId});
const req=(agentId,nonce,text='new text',sessionId='')=>({target:target(agentId,sessionId),nonce,text,signal:new AbortController().signal});
const snap=(agentId,rows=[],sessionId='')=>({target:target(agentId,sessionId),complete:true,generation:'fixture-generation',revision:'fixture-revision',rows});
const row=(id,role,content,timestampMs)=>({id,kind:'message',role,content,timestampMs});
function journal(){const records=new Map(),active=new Set(),key=(t,n)=>JSON.stringify([t.agentId,t.sessionId,n]),chat=t=>JSON.stringify(t);return {lookup(t,n){return records.get(key(t,n))??'new'},markNative(t,n){let k=key(t,n),v=records.get(k);if(active.has(chat(t)))return 'busy';if(v)return v;records.set(k,'native');return 'native'},claim(t,n){let k=key(t,n),v=records.get(k);if(v)return v;if(active.has(chat(t)))return 'busy';active.add(chat(t));records.set(k,'started');return 'new'},finish(t,n,o){records.set(key(t,n),o==='committed'?'committed':'started');active.delete(chat(t))}}}
test('two conversations and two sessions hydrate only their own complete native context',async()=>{
 const seen=[],commits=[];const route=createGlobalPolicy({journal:journal(),complete:async messages=>(seen.push(messages),'fixture answer'),bridge:{async commit(...args){commits.push(args)}}});
 const a=req('a','one'),b=req('b','two'),a2=req('a','three','followup','other-session');
 await route(a,proof,snap('a',[row('a1','user','A native',1),row('a2','assistant','A answer',2)]),()=>assert.fail('native'));
 await route(b,proof,snap('b',[row('b1','user','B native',1)]),()=>assert.fail('native'));
 await route(a2,proof,snap('a',[],'other-session'),()=>assert.fail('native'));
 assert.deepEqual(seen[0],[...proof.nativeSystemMessages,{role:'user',content:'A native'},{role:'assistant',content:'A answer'},{role:'user',content:'new text'}]);
 assert.deepEqual(seen[1],[...proof.nativeSystemMessages,{role:'user',content:'B native'},{role:'user',content:'new text'}]);
 assert.deepEqual(seen[2],[...proof.nativeSystemMessages,{role:'user',content:'followup'}]);assert.equal(commits.length,3);
 assert.deepEqual(commits.map(x=>x[0]),[a.target,b.target,a2.target]);
});
test('unknown capabilities, incomplete context and attachments delegate unchanged with route status',()=>{
 const events=[],pending=Promise.resolve('native');let calls=0;const run=createGlobalPolicy({journal:journal(),onRoute:(t,d)=>events.push(d),complete:async()=>{assert.fail('provider')},bridge:{async commit(){assert.fail('commit')}}});
 const base=req('a','x'),native=()=>{calls++;return pending};
 let i=0;for(const [r,p,s] of [[base,{...proof,textOnly:false},snap('a')],[base,proof,undefined],[{...base,attachments:['x']},proof,snap('a')],[base,{...proof,canonicalContinuationVerified:false},snap('a')],[base,proof,snap('b')],[base,{...proof,nativeModelContextVerified:false},snap('a')]])assert.equal(run({...r,nonce:'case-'+i++},p,s,native),pending);
 assert.equal(calls,6);assert.deepEqual(events.map(x=>x.reason),['text-only-not-proven','complete-context-not-proven','unsupported-content','native-continuation-not-proven','complete-context-not-proven','native-model-context-not-proven']);
});
test('missing proof defaults to native dispatch',()=>{
 const r=req('a','missing'),native=Promise.resolve('native');const run=createGlobalPolicy({journal:journal(),complete:async()=>{assert.fail('provider')},bridge:{async commit(){assert.fail('commit')}}});
 assert.equal(run(r,undefined,snap('a'),()=>native),native);
});
test('a nonce first delegated natively cannot later be rerouted after policy changes or recreation',()=>{
 const j=journal(),r=req('a','native-first'),s=snap('a'),pending=Promise.resolve('native');let calls=0;const opts={journal:j,complete:async()=>{assert.fail('provider')},bridge:{async commit(){assert.fail('commit')}}};
 assert.equal(createGlobalPolicy(opts)(r,{...proof,textOnly:false},s,()=>{calls++;return pending}),pending);
 assert.equal(createGlobalPolicy(opts)(r,proof,s,()=>{calls++;return pending}),pending);assert.equal(calls,2);
});
test('tool, image and unknown transcript structure never becomes text-only context',()=>{
 const a=req('a','x');for(const entry of [{id:'tool',kind:'tool-call',timestampMs:1},{...row('x','user','text',1),images:['fixture']},row('x','system','hidden context',1)])assert.equal(evaluateTurn(a,proof,snap('a',[entry])).route,'native');
});
test('native tail is hydrated only with explicit lossless completeness evidence',()=>{
 const base={target:target('a'),generation:2,revision:'fixture-revision',hasMore:false,unresolvedBodies:0,droppedRows:0,rows:[row('native','user','prior',1)]};
 const good=snapshotFromNativeRead(base);assert.equal(good.complete,true);assert.equal(evaluateTurn(req('a','n'),proof,good).route,'router');
 for(const change of [{hasMore:true},{unresolvedBodies:1},{droppedRows:1},{generation:0},{revision:''}]){
   const candidate=snapshotFromNativeRead({...base,...change});assert.equal(candidate.complete,false);assert.equal(evaluateTurn(req('a','n'),proof,candidate).route,'native');
 }
 assert.equal(routeLabel({route:'native',reason:'text-only-not-proven'}),'Native: tool requirements are not established');
 assert.equal(routeLabel({route:'router',reason:'verified-text-only'}),'Constellation: verified text-only turn');
});
test('provider failure and commit uncertainty never call native or issue duplicate provider requests',async()=>{
 let calls=0,native=0;const failure=Error('provider-failed');const run=createGlobalPolicy({journal:journal(),complete:async()=>{calls++;throw failure},bridge:{async commit(){assert.fail('commit')}}});
 const r=req('a','id'),s=snap('a');const first=run(r,proof,s,()=>{native++});const second=run(r,proof,s,()=>{native++});assert.equal(first,second);
 await assert.rejects(first,e=>e===failure);await assert.rejects(run(r,proof,s,()=>{native++}),e=>e===failure);assert.equal(calls,1);assert.equal(native,0);
 let commits=0;const run2=createGlobalPolicy({journal:journal(),complete:async()=> 'answer',bridge:{async commit(){commits++;throw Error('commit uncertain')}}});
 await assert.rejects(run2(r,proof,s,()=>{native++}),/commit uncertain/);await assert.rejects(run2(r,proof,s,()=>{native++}),/commit uncertain/);assert.equal(commits,1);assert.equal(native,0);
});
test('abort prevents commit and conflicting turns do not share context',async()=>{
 const controller=new AbortController();let release;const pending=new Promise(resolve=>{release=resolve});let committed=0;const run=createGlobalPolicy({journal:journal(),complete:()=>pending,bridge:{async commit(){committed++}}});
 const a={...req('a','one'),signal:controller.signal},first=run(a,proof,snap('a'),()=>assert.fail('native'));
 await assert.rejects(run(req('a','two'),proof,snap('a'),()=>assert.fail('native')),/active routed turn/);
 await assert.rejects(run(req('a','three'),{...proof,textOnly:false},snap('a'),()=>assert.fail('native')),/active routed turn/);
 controller.abort();release('late');await assert.rejects(first,{name:'AbortError'});assert.equal(committed,0);
});
test('journal blocks replay after recreation and returns committed status without duplicate work',async()=>{
 let calls=0,commits=0;const j=journal(),opts={journal:j,complete:async()=>{calls++;return 'answer'},bridge:{async commit(){commits++}}};const r=req('a','nonce'),s=snap('a');
 await createGlobalPolicy(opts)(r,proof,s,()=>assert.fail('native'));
 assert.deepEqual(await createGlobalPolicy(opts)(r,proof,s,()=>assert.fail('native')),{accepted:true});assert.equal(calls,1);assert.equal(commits,1);
 const badJournal=journal(),fail={journal:badJournal,complete:async()=>{throw Error('unknown')},bridge:{async commit(){assert.fail('commit')}}};
 await assert.rejects(createGlobalPolicy(fail)(r,proof,s,()=>assert.fail('native')),/unknown/);
 await assert.rejects(createGlobalPolicy(fail)(r,proof,s,()=>assert.fail('native')),/uncertain outcome/);
 await assert.rejects(createGlobalPolicy(fail)(r,{...proof,textOnly:false},s,()=>assert.fail('native')),/uncertain outcome/);
});
