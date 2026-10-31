'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createScratchAdapter} = require('../scratch.cjs');
const messages = [{role:'user',content:'synthetic prompt'}];
test('only explicitly selected text conversation reaches the synthetic provider and renderer', async () => {
  const events=[]; const provider={async complete(req, signal){events.push(['provider',req,signal]);return 'synthetic answer'}};
  const renderer={async complete(id,text){events.push(['render',id,text])}};
  const run=createScratchAdapter({conversationId:'scratch',model:'fixture-model',provider,renderer});
  const signal=new AbortController().signal;
  assert.equal(await run({conversationId:'other',messages,signal}),'not-selected');
  assert.equal(events.length,0);
  assert.equal(await run({conversationId:'scratch',messages,signal}),'rendered');
  assert.deepEqual(events,[['provider',{model:'fixture-model',messages},signal],['render','scratch','synthetic answer']]);
});
test('abort and malformed response never render', async () => {
  let renders=0; const controller=new AbortController();
  const run=createScratchAdapter({conversationId:'scratch',model:'fixture',provider:{async complete(){controller.abort();return 'too late'}},renderer:{async complete(){renders++}}});
  await assert.rejects(run({conversationId:'scratch',messages,signal:controller.signal}),{name:'AbortError'});
  assert.equal(renders,0);
  const run2=createScratchAdapter({conversationId:'scratch',model:'fixture',provider:{async complete(){return ''}},renderer:{async complete(){renders++}}});
  await assert.rejects(run2({conversationId:'scratch',messages,signal:new AbortController().signal}),/no text/);
  assert.equal(renders,0);
});
