"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectMessageStructure = inspectMessageStructure;
exports.wrapConnectTransport = wrapConnectTransport;
const DEFAULT_LIMITS = Object.freeze({ maxNodes: 256, maxDepth: 4, maxProperties: 128 });
const TYPE_NAMES = Object.freeze([
    'null', 'undefined', 'boolean', 'number', 'bigint', 'string', 'symbol',
    'function', 'object', 'array', 'binary', 'opaque',
]);
const arrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const typedArrayLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const dataViewLength = Object.getOwnPropertyDescriptor(DataView.prototype, 'byteLength').get;
const sharedBufferLength = typeof SharedArrayBuffer === 'function'
    ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength').get : undefined;
function boundedInteger(value, fallback, maximum, name, minimum = 1) {
    if (value === undefined)
        return fallback;
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new TypeError(`Invalid ${name} limit`);
    }
    return value;
}
function limitsOf(options = {}) {
    return Object.freeze({
        maxNodes: boundedInteger(options.maxNodes, DEFAULT_LIMITS.maxNodes, 4096, 'maxNodes'),
        maxDepth: boundedInteger(options.maxDepth, DEFAULT_LIMITS.maxDepth, 12, 'maxDepth', 0),
        maxProperties: boundedInteger(options.maxProperties, DEFAULT_LIMITS.maxProperties, 4096, 'maxProperties'),
    });
}
function binaryLength(value) {
    for (const getter of [arrayBufferLength, sharedBufferLength, typedArrayLength, dataViewLength]) {
        if (getter === undefined)
            continue;
        try {
            return Reflect.apply(getter, value, []);
        }
        catch { /* Not this built-in binary type. */ }
    }
    return undefined;
}
/** Summarize own data values without recording keys, scalar values, or message references. */
function inspectMessageStructure(value, options) {
    const limits = limitsOf(options);
    const counts = Object.fromEntries(TYPE_NAMES.map((name) => [name, 0]));
    const result = {
        rootKind: 'opaque', nodesVisited: 0, counts,
        ownPropertySlotsVisited: 0, accessorPropertiesSkipped: 0,
        symbolPropertiesSkipped: 0, unreadablePropertiesSkipped: 0,
        repeatedObjectsSkipped: 0, opaqueObjectsSkipped: 0,
        binaryBytesObserved: 0, arraySlotsVisited: 0, truncated: false,
    };
    const seen = new WeakSet();
    const queue = [{ value, depth: 0 }];
    let cursor = 0;
    function enqueueProperty(object, key, depth, isArraySlot) {
        if (result.ownPropertySlotsVisited >= limits.maxProperties) {
            result.truncated = true;
            return false;
        }
        result.ownPropertySlotsVisited += 1;
        if (isArraySlot)
            result.arraySlotsVisited += 1;
        if (typeof key === 'symbol') {
            result.symbolPropertiesSkipped += 1;
            return true;
        }
        let descriptor;
        try {
            descriptor = Object.getOwnPropertyDescriptor(object, key);
        }
        catch {
            result.unreadablePropertiesSkipped += 1;
            return true;
        }
        if (descriptor === undefined)
            return true;
        if (!Object.hasOwn(descriptor, 'value')) {
            result.accessorPropertiesSkipped += 1;
            return true;
        }
        if (queue.length >= limits.maxNodes)
            result.truncated = true;
        else
            queue.push({ value: descriptor.value, depth: depth + 1 });
        return true;
    }
    while (cursor < queue.length && result.nodesVisited < limits.maxNodes) {
        const item = queue[cursor++];
        const current = item.value;
        let kind = (current === null ? 'null' : typeof current);
        let bytes;
        if (kind === 'object') {
            try {
                bytes = binaryLength(current);
                kind = bytes !== undefined ? 'binary' : Array.isArray(current) ? 'array' : 'object';
            }
            catch {
                kind = 'opaque';
            }
        }
        if (result.nodesVisited === 0)
            result.rootKind = kind;
        result.nodesVisited += 1;
        counts[kind] += 1;
        if (kind === 'binary') {
            result.binaryBytesObserved += bytes;
            continue;
        }
        if (kind !== 'object' && kind !== 'array')
            continue;
        if (seen.has(current)) {
            result.repeatedObjectsSkipped += 1;
            continue;
        }
        seen.add(current);
        if (item.depth >= limits.maxDepth) {
            result.truncated = true;
            continue;
        }
        if (kind === 'array') {
            let length;
            try {
                length = Object.getOwnPropertyDescriptor(current, 'length')?.value;
            }
            catch {
                result.opaqueObjectsSkipped += 1;
                continue;
            }
            if (!Number.isSafeInteger(length) || length < 0) {
                result.opaqueObjectsSkipped += 1;
                continue;
            }
            for (let index = 0; index < length; index += 1) {
                if (!enqueueProperty(current, String(index), item.depth, true))
                    break;
            }
        }
        else {
            let keys;
            try {
                keys = Reflect.ownKeys(current);
            }
            catch {
                result.opaqueObjectsSkipped += 1;
                continue;
            }
            for (const key of keys) {
                if (!enqueueProperty(current, key, item.depth, false))
                    break;
            }
        }
    }
    if (cursor < queue.length)
        result.truncated = true;
    return Object.freeze({ ...result, counts: Object.freeze(counts) });
}
function isThenable(value) {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
        && typeof value.then === 'function';
}
function callbackOrUndefined(value, name) {
    if (value !== undefined && typeof value !== 'function')
        throw new TypeError(`Invalid ${name} callback`);
    return value;
}
function selectorKey(operation, service, method) {
    return `${operation}\0${service}\0${method}`;
}
function selectorsOf(selectors = []) {
    if (!Array.isArray(selectors) || selectors.length > 256)
        throw new TypeError('Invalid knownMethods list');
    const result = new Map();
    for (const selector of selectors) {
        const { operation, service, method, inputType, outputType } = selector ?? {};
        if (!['unary', 'stream'].includes(operation)
            || typeof service !== 'string' || !/^[A-Za-z_][\w.]*$/.test(service)
            || typeof method !== 'string' || !/^[A-Za-z_]\w*$/.test(method)
            || (inputType !== undefined && typeof inputType !== 'string')
            || (outputType !== undefined && typeof outputType !== 'string')) {
            throw new TypeError('Invalid knownMethods selector');
        }
        const key = selectorKey(operation, service, method);
        if (result.has(key))
            throw new TypeError('Duplicate knownMethods selector');
        result.set(key, Object.freeze({ inputType, outputType }));
    }
    return result;
}
function metadataOf(operation, args) {
    const [service, method, signal, timeoutMs, headers, , contextValues] = args;
    return Object.freeze({
        operation, service: service.typeName, method: method.name,
        methodKind: typeof method.kind === 'number' ? method.kind : undefined,
        inputType: typeof method.I?.typeName === 'string' ? method.I.typeName : undefined,
        outputType: typeof method.O?.typeName === 'string' ? method.O.typeName : undefined,
        signalPresent: signal !== undefined, signalAborted: signal?.aborted === true,
        timeoutMs: typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) ? timeoutMs : undefined,
        callerHeadersPresent: headers !== undefined, contextValuesPresent: contextValues !== undefined,
    });
}
/** Observe input only when the native consumer pulls; do not pull, buffer, replay, or touch output. */
function inspectOnPull(input, observe) {
    return {
        [Symbol.asyncIterator]() {
            const iterator = Reflect.apply(input[Symbol.asyncIterator], input, []);
            let proxy;
            proxy = new Proxy(iterator, {
                get(target, key) {
                    const member = Reflect.get(target, key, target);
                    if (typeof member !== 'function')
                        return member;
                    if (key === 'next')
                        return function (...args) {
                            const pending = Reflect.apply(member, target, args);
                            return Promise.resolve(pending).then((step) => {
                                // Accessor-based iterator results pass through without a second getter evaluation.
                                try {
                                    const done = Object.getOwnPropertyDescriptor(step, 'done');
                                    const value = Object.getOwnPropertyDescriptor(step, 'value');
                                    if (done && Object.hasOwn(done, 'value') && !done.value
                                        && value && Object.hasOwn(value, 'value'))
                                        observe(value.value);
                                }
                                catch { /* Inspection must not change the native iterator result. */ }
                                return step;
                            });
                        };
                    if (key === 'return' || key === 'throw')
                        return function (...args) {
                            return Reflect.apply(member, target, args);
                        };
                    if (key === Symbol.asyncIterator)
                        return function (...args) {
                            const result = Reflect.apply(member, target, args);
                            return result === target ? proxy : result;
                        };
                    return member;
                },
            });
            return proxy;
        },
    };
}
/** Wrap Connect 1.x Transport.unary/stream. This proof only delegates; it has no routing action. */
function wrapConnectTransport(nativeTransport, options = {}) {
    if (typeof nativeTransport?.unary !== 'function' || typeof nativeTransport?.stream !== 'function') {
        throw new TypeError('A Connect transport with unary and stream is required');
    }
    const selectors = selectorsOf(options.knownMethods);
    const policy = callbackOrUndefined(options.policy, 'policy');
    const onInspect = callbackOrUndefined(options.onInspect, 'onInspect');
    const onDiagnostic = callbackOrUndefined(options.onDiagnostic, 'onDiagnostic');
    const limits = limitsOf(options.inspection);
    const maxStreamMessages = boundedInteger(options.maxStreamMessages, 1, 256, 'maxStreamMessages', 0);
    if (selectors.size === 0 || policy === undefined || onInspect === undefined)
        return nativeTransport;
    function diagnose(phase, code) {
        try {
            const result = onDiagnostic?.(Object.freeze({ phase, code }));
            if (isThenable(result))
                Promise.resolve(result).catch(() => { });
        }
        catch { /* Diagnostics cannot interrupt native requests. */ }
    }
    function notify(metadata, index, value) {
        try {
            const event = Object.freeze({ phase: 'request', metadata, messageIndex: index,
                structure: inspectMessageStructure(value, limits) });
            const result = onInspect(event);
            if (isThenable(result))
                Promise.resolve(result).catch(() => diagnose('observer', 'observer-rejected'));
        }
        catch {
            diagnose('observer', 'observer-failed');
        }
    }
    function call(operation, args) {
        let metadata;
        let inspect = false;
        try {
            const service = args[0]?.typeName;
            const method = args[1]?.name;
            const selector = selectors.get(selectorKey(operation, service, method));
            if (selector !== undefined) {
                metadata = metadataOf(operation, args);
                if ((selector.inputType === undefined || selector.inputType === metadata.inputType)
                    && (selector.outputType === undefined || selector.outputType === metadata.outputType)) {
                    const decision = policy(metadata);
                    if (isThenable(decision)) {
                        Promise.resolve(decision).catch(() => { });
                        diagnose('policy', 'async-policy-unsupported');
                    }
                    else
                        inspect = decision === 'inspect-structure';
                }
            }
        }
        catch {
            diagnose('policy', 'policy-failed');
        }
        if (!inspect)
            return Reflect.apply(nativeTransport[operation], nativeTransport, args);
        if (operation === 'unary')
            notify(metadata, 0, args[5]);
        else if (maxStreamMessages > 0) {
            let count = 0;
            const tapped = inspectOnPull(args[5], (value) => {
                if (count < maxStreamMessages)
                    notify(metadata, count++, value);
            });
            args = args.slice();
            args[5] = tapped;
        }
        return Reflect.apply(nativeTransport[operation], nativeTransport, args);
    }
    return {
        unary(...args) { return call('unary', args); },
        stream(...args) { return call('stream', args); },
    };
}
