'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { wrapConnectTransport, inspectMessageStructure } = require('../index.cjs');

class Input { static typeName = 'offline.fixture.Input'; }
class Output { static typeName = 'offline.fixture.Output'; }
const service = Object.freeze({ typeName: 'offline.fixture.Service' });
const unaryMethod = Object.freeze({ name: 'Send', kind: 0, I: Input, O: Output });
const streamMethod = Object.freeze({ name: 'Watch', kind: 1, I: Input, O: Output });
function selection(method = unaryMethod, operation = 'unary') {
  return { operation, service: service.typeName, method: method.name,
    inputType: Input.typeName, outputType: Output.typeName };
}
function args(method = unaryMethod, input = { text: 'synthetic fixture' }) {
  return [service, method, new AbortController().signal, 1234,
    new Headers({ authorization: 'Bearer fake-fixture-secret', 'x-fixture': 'keep' }),
    input, new Map([['fake-context', 'fake-context-secret']])];
}
function nativeFixture(overrides = {}) {
  return { unary() { return Promise.resolve({ message: {} }); },
    stream() { return Promise.resolve({ message: { async *[Symbol.asyncIterator]() {} } }); }, ...overrides };
}
function inspected(native, events, extra = {}) {
  return wrapConnectTransport(native, { knownMethods: [selection(), selection(streamMethod, 'stream')],
    policy: () => 'inspect-structure', onInspect: (event) => events.push(event), ...extra });
}

test('default returns the original transport and does not inspect input', () => {
  const native = nativeFixture();
  assert.equal(wrapConnectTransport(native), native);
  assert.equal(wrapConnectTransport(native, { onInspect() { throw Error('unreachable'); } }), native);
});

test('unknown RPC delegates once with exact arguments, receiver, and promise', async () => {
  const call = args(Object.freeze({ ...unaryMethod, name: 'Unlisted' }));
  const response = { message: {}, header: new Headers(), trailer: new Headers() };
  const pending = Promise.resolve(response);
  let calls = 0;
  const native = nativeFixture({ unary(...received) {
    calls += 1; assert.equal(this, native); assert.equal(received.length, call.length);
    received.forEach((value, i) => assert.equal(value, call[i])); return pending;
  } });
  const wrapper = inspected(native, [], { policy() { assert.fail('unknown method policy'); } });
  assert.equal(wrapper.unary(...call), pending);
  assert.equal(await pending, response); assert.equal(calls, 1);
});

test('unlisted native tool, transcript, voice, and image methods remain untouched', () => {
  let calls = 0;
  const native = nativeFixture({ unary(...received) { calls += 1; return received[5]; },
    stream(...received) { calls += 1; return received[5]; } });
  const wrapper = inspected(native, [], { policy() { assert.fail('unlisted policy'); } });
  for (const [name, operation] of [['SubmitGrokBotUserComputerResponses', 'unary'],
    ['WatchGrokBotTranscripts', 'stream'], ['MintSandVoiceCallSecret', 'unary'],
    ['StartGrokBotImagePrecaption', 'unary'], ['Stream', 'stream']]) {
    const call = args({ ...unaryMethod, name });
    assert.equal(wrapper[operation](...call), call[5]);
  }
  assert.equal(calls, 5);
});

test('listed metadata policy can decline inspection without touching input', () => {
  const input = new Proxy({}, { ownKeys() { assert.fail('input was inspected'); } });
  const call = args(unaryMethod, input); const pending = Promise.resolve({});
  let metadata;
  const wrapper = inspected(nativeFixture({ unary: () => pending }), [], {
    policy(value) { metadata = value; return 'delegate'; },
  });
  assert.equal(wrapper.unary(...call), pending);
  assert.ok(Object.isFrozen(metadata));
  assert.equal(metadata.service, service.typeName);
  assert.equal(metadata.inputType, Input.typeName);
  assert.equal(metadata.timeoutMs, 1234);
  assert.equal(metadata.signalAborted, false);
  assert.equal(metadata.callerHeadersPresent, true);
  assert.equal(metadata.contextValuesPresent, true);
  assert.equal('message' in metadata, false); assert.equal('headers' in metadata, false);
});

test('schema/type mismatch bypasses policy and delegates unchanged', () => {
  const call = args({ ...unaryMethod, I: class { static typeName = 'offline.fixture.Different'; } });
  const pending = Promise.resolve({});
  const wrapper = inspected(nativeFixture({ unary: () => pending }), [], {
    policy() { assert.fail('type mismatch policy'); },
  });
  assert.equal(wrapper.unary(...call), pending);
});

test('unary inspection sees a pre-serialization object and preserves request/response identities', async () => {
  const input = { privateFieldNameAlpha: 'synthetic fixture', privateNestedNameBeta: { counter: 987654321n }, privateBinaryNameGamma: new Uint8Array([7, 8]) };
  const call = args(unaryMethod, input); const events = [];
  const response = { message: new Output(), header: new Headers({ 'x-response': 'kept' }), trailer: new Headers() };
  const pending = Promise.resolve(response);
  const native = nativeFixture({ unary(...received) {
    received.forEach((value, i) => assert.equal(value, call[i])); return pending;
  } });
  assert.equal(inspected(native, events).unary(...call), pending);
  assert.equal(await pending, response);
  assert.equal(events.length, 1); assert.equal(events[0].structure.rootKind, 'object');
  assert.equal(events[0].structure.counts.bigint, 1); assert.equal(events[0].structure.binaryBytesObserved, 2);
  assert.ok(Object.isFrozen(events[0].structure.counts));
  const rendered = JSON.stringify(events);
  for (const secret of ['synthetic fixture', 'privateFieldNameAlpha', 'privateNestedNameBeta', 'privateBinaryNameGamma', '987654321',
    'fake-fixture-secret', 'authorization', 'fake-context-secret']) assert.equal(rendered.includes(secret), false, secret);
});

test('generated-message instances are inspected without serialization, getters, or toJSON', () => {
  let serializationCalls = 0; let getterCalls = 0;
  class Message {
    constructor() { this.body = 'private-content'; }
    toBinary() { serializationCalls += 1; throw Error('must remain native'); }
    toJSON() { serializationCalls += 1; throw Error('must not stringify'); }
  }
  const input = new Message();
  Object.defineProperty(input, 'secret-getter', { enumerable: true, get() { getterCalls += 1; throw Error('getter'); } });
  input[Symbol('secret-symbol')] = 'secret-symbol-value';
  const summary = inspectMessageStructure(input);
  assert.equal(summary.rootKind, 'object'); assert.equal(summary.counts.string, 1);
  assert.equal(summary.accessorPropertiesSkipped, 1); assert.equal(summary.symbolPropertiesSkipped, 1);
  assert.equal(serializationCalls, 0); assert.equal(getterCalls, 0);
  assert.equal(JSON.stringify(summary).includes('private-content'), false);
});

test('structure traversal handles cycles, binary views, opaque proxies, and configured bounds', () => {
  const root = { binary: new DataView(new ArrayBuffer(5)), array: new Array(1000000) };
  root.self = root;
  const summary = inspectMessageStructure(root, { maxNodes: 8, maxProperties: 6, maxDepth: 3 });
  assert.ok(summary.nodesVisited <= 8); assert.ok(summary.ownPropertySlotsVisited <= 6);
  assert.equal(summary.binaryBytesObserved, 5); assert.equal(summary.repeatedObjectsSkipped, 1);
  assert.equal(summary.truncated, true);
  const opaque = inspectMessageStructure(new Proxy({}, { ownKeys() { throw Error('private-error'); } }));
  assert.equal(opaque.opaqueObjectsSkipped, 1);
  assert.equal(JSON.stringify(opaque).includes('private-error'), false);
});

test('stream inspection is lazy, bounded, and leaves output headers/trailers/stream untouched', async () => {
  let starts = 0; let pulls = 0; const events = [];
  const input = { async *[Symbol.asyncIterator]() {
    starts += 1; pulls += 1; yield { text: 'first-synthetic' };
    pulls += 1; yield { text: 'second-synthetic' };
  } };
  const output = { async *[Symbol.asyncIterator]() { yield { token: 'output-synthetic' }; } };
  const response = { message: output, header: new Headers({ 'x-response': 'keep' }), trailer: new Headers() };
  const pending = Promise.resolve(response); let nativeInput; const call = args(streamMethod, input);
  const native = nativeFixture({ stream(...received) {
    assert.equal(starts, 0); assert.equal(pulls, 0);
    received.forEach((value, i) => { if (i !== 5) assert.equal(value, call[i]); });
    nativeInput = received[5]; return pending;
  } });
  assert.equal(inspected(native, events).stream(...call), pending);
  assert.equal(events.length, 0); assert.equal((await pending).message, output);
  const iterator = nativeInput[Symbol.asyncIterator]();
  assert.equal(starts, 0); assert.equal(iterator[Symbol.asyncIterator](), iterator);
  assert.equal((await iterator.next()).value.text, 'first-synthetic');
  assert.equal(pulls, 1); assert.equal(events.length, 1);
  assert.equal((await iterator.next()).value.text, 'second-synthetic');
  assert.equal(pulls, 2); assert.equal(events.length, 1);
  assert.equal((await iterator.next()).done, true);
});

test('inspection never buffers messages and forwards iterator next/return/throw arguments and receiver', async () => {
  const events = []; const sent = []; const closed = Promise.resolve({ done: true, value: 'closed' });
  const failure = Error('synthetic-iterator-error');
  const iterator = {
    next(value) { assert.equal(this, iterator); sent.push(['next', value]); return Promise.resolve({ done: false, value: { prompt: 'fixture' } }); },
    return(value) { assert.equal(this, iterator); sent.push(['return', value]); return closed; },
    throw(value) { assert.equal(this, iterator); sent.push(['throw', value]); throw value; },
    [Symbol.asyncIterator]() { return this; },
  };
  let tapped;
  const native = nativeFixture({ stream(...received) { tapped = received[5]; return Promise.resolve({}); } });
  inspected(native, events).stream(...args(streamMethod, { [Symbol.asyncIterator]: () => iterator }));
  const current = tapped[Symbol.asyncIterator]();
  await current.next('resume-synthetic'); assert.equal(events.length, 1);
  assert.equal(current.return('stop-synthetic'), closed);
  assert.throws(() => current.throw(failure), (error) => error === failure);
  assert.deepEqual(sent, [['next', 'resume-synthetic'], ['return', 'stop-synthetic'], ['throw', failure]]);
});

test('accessor-based iterator result is forwarded without evaluating its getters', async () => {
  let getterCalls = 0; let tapped; const events = [];
  const step = Object.defineProperties({}, { done: { get() { getterCalls += 1; return false; } },
    value: { get() { getterCalls += 1; return { text: 'fixture' }; } } });
  const native = nativeFixture({ stream(...received) { tapped = received[5]; return Promise.resolve({}); } });
  inspected(native, events).stream(...args(streamMethod, { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(step) }) }));
  assert.equal(await tapped[Symbol.asyncIterator]().next(), step);
  assert.equal(getterCalls, 0); assert.equal(events.length, 0);
});

test('native synchronous failure is thrown once, without retry, for both unknown and listed calls', () => {
  const failure = Error('native-synthetic');
  for (const name of ['Unlisted', 'Send']) {
    let calls = 0;
    const native = nativeFixture({ unary() { calls += 1; throw failure; } });
    const wrapper = inspected(native, [], { policy: () => 'delegate' });
    assert.throws(() => wrapper.unary(...args({ ...unaryMethod, name })), (error) => error === failure);
    assert.equal(calls, 1);
  }
});

test('native rejected promise and error identity pass through unchanged', async () => {
  const failure = Error('synthetic-native-rejection'); const pending = Promise.reject(failure);
  let calls = 0;
  const wrapper = inspected(nativeFixture({ unary() { calls += 1; return pending; } }), []);
  assert.equal(wrapper.unary(...args()), pending);
  await assert.rejects(pending, (error) => error === failure); assert.equal(calls, 1);
});

test('partial output failure remains native and never replays the request', async () => {
  const failure = Error('synthetic-partial-failure'); let calls = 0;
  const output = { async *[Symbol.asyncIterator]() { yield { text: 'first' }; throw failure; } };
  const response = { message: output, header: new Headers(), trailer: new Headers() };
  const native = nativeFixture({ stream() { calls += 1; return Promise.resolve(response); } });
  const actual = await inspected(native, []).stream(...args(streamMethod, { async *[Symbol.asyncIterator]() { yield {}; } }));
  assert.equal(actual, response); const iterator = actual.message[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value, { text: 'first' });
  await assert.rejects(iterator.next(), (error) => error === failure); assert.equal(calls, 1);
});

test('cancellation uses the original signal/reason and native cancellation behavior', async () => {
  const controller = new AbortController(); const reason = Error('synthetic-abort'); let receivedSignal;
  const pending = new Promise((resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
  const native = nativeFixture({ unary(...received) { receivedSignal = received[2]; return pending; } });
  const call = args(); call[2] = controller.signal;
  assert.equal(inspected(native, []).unary(...call), pending); assert.equal(receivedSignal, controller.signal);
  controller.abort(reason); await assert.rejects(pending, (error) => error === reason);
});

test('policy and observer failures delegate once and diagnostics expose no error details', async () => {
  const diagnostics = []; const pending = Promise.resolve({}); let calls = 0;
  const native = nativeFixture({ unary() { calls += 1; return pending; } });
  for (const policy of [() => { throw Error('secret-policy-error'); }, () => Promise.reject(Error('secret-async-policy'))]) {
    const wrapper = inspected(native, [], { policy, onDiagnostic: (record) => diagnostics.push(record) });
    assert.equal(wrapper.unary(...args()), pending);
  }
  for (const onInspect of [() => { throw Error('secret-observer-error'); }, () => Promise.reject(Error('secret-async-observer'))]) {
    const wrapper = inspected(native, [], { onInspect, onDiagnostic: (record) => diagnostics.push(record) });
    assert.equal(wrapper.unary(...args()), pending);
  }
  await new Promise(setImmediate); assert.equal(calls, 4); assert.equal(diagnostics.length, 4);
  assert.equal(JSON.stringify(diagnostics).includes('secret-'), false);
});

test('missing callbacks and unknown policy actions perform no inspection or routing', () => {
  const native = nativeFixture();
  assert.equal(wrapConnectTransport(native, { knownMethods: [selection()], policy: () => 'inspect-structure' }), native);
  const input = new Proxy({}, { ownKeys() { assert.fail('unknown action inspected'); } });
  let received;
  const wrapper = inspected(nativeFixture({ unary(...call) { received = call[5]; } }), [], { policy: () => 'route' });
  wrapper.unary(...args(unaryMethod, input)); assert.equal(received, input);
});

test('invalid setup is rejected before a transport can be installed', () => {
  assert.throws(() => wrapConnectTransport({}), TypeError);
  assert.throws(() => wrapConnectTransport(nativeFixture(), { knownMethods: [selection(), selection()] }), TypeError);
  assert.throws(() => wrapConnectTransport(nativeFixture(), { knownMethods: [{ ...selection(), method: 'bad/name' }] }), TypeError);
  assert.throws(() => inspectMessageStructure({}, { maxNodes: 0 }), TypeError);
});
