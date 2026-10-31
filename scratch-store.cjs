"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScratchStore = createScratchStore;
exports.getScratchStore = getScratchStore;
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const same = (a, b) => a.agentId === b.agentId && a.sessionId === b.sessionId;
function createScratchStore(file) {
    function read() {
        try {
            if ((0, node_fs_1.lstatSync)(file).isSymbolicLink())
                throw Error('scratch history symlink refused');
            const data = JSON.parse((0, node_fs_1.readFileSync)(file, 'utf8'));
            if (data.version !== 1 || !data.target || typeof data.target.agentId !== 'string' || typeof data.target.sessionId !== 'string' || !Array.isArray(data.turns))
                throw Error('invalid scratch history');
            return data;
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return;
            throw e;
        }
    }
    function write(data) {
        try {
            if ((0, node_fs_1.lstatSync)(file).isSymbolicLink())
                throw Error('scratch history symlink refused');
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
        }
        const temp = `${file}.${(0, node_crypto_1.randomUUID)()}.tmp`;
        try {
            (0, node_fs_1.writeFileSync)(temp, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
            (0, node_fs_1.renameSync)(temp, file);
        }
        finally {
            try {
                (0, node_fs_1.unlinkSync)(temp);
            }
            catch (e) {
                if (e.code !== 'ENOENT')
                    throw e;
            }
        }
    }
    return {
        read,
        append(target, turn) {
            const state = read() ?? { version: 1, target, turns: [] };
            if (!same(state.target, target))
                throw Error('another conversation owns the scratch session');
            if (state.turns.some(t => t.nonce === turn.nonce))
                throw Error('duplicate scratch turn');
            state.turns.push(turn);
            write(state);
        },
        merge(target, server) {
            const state = read();
            if (!state || !same(state.target, target))
                return server;
            const ids = new Set(server.map(x => x.id));
            let seq = server.reduce((n, x) => typeof x.seq === 'number' && Number.isSafeInteger(x.seq) ? Math.max(n, x.seq) : n, 0);
            const entries = [];
            for (const t of state.turns) {
                const user = { id: `scratch-user-${t.nonce}`, kind: 'message', role: 'user', content: t.prompt, clientNonce: t.nonce, timestampMs: t.at }, assistant = { id: `scratch-assistant-${t.nonce}`, kind: 'message', role: 'assistant', content: t.answer, timestampMs: t.at };
                for (const row of [user, assistant])
                    if (!ids.has(row.id)) {
                        ids.add(row.id);
                        entries.push(row);
                    }
            }
            const merged = [...server];
            for (const row of entries) {
                const entry = { ...row, seq: ++seq };
                const position = merged.findIndex(item => typeof item.timestampMs === 'number' && Number.isFinite(item.timestampMs) && item.timestampMs > entry.timestampMs);
                if (position < 0)
                    merged.push(entry);
                else
                    merged.splice(position, 0, entry);
            }
            return merged;
        },
    };
}
let singleton;
function getScratchStore() { const f = process.env.GROKBOT_SCRATCH_STORE; if (!f)
    throw Error('scratch store is not configured'); return singleton ??= createScratchStore(f); }
