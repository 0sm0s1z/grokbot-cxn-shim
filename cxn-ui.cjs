"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.alias = void 0;
exports.modelChoices = modelChoices;
exports.findModel = findModel;
exports.prettyWhen = prettyWhen;
exports.prettyDuration = prettyDuration;
const node_crypto_1 = require("node:crypto");
const clean = (s) => s.replace(/[\r\n\t`<>\[\]*_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const alias = (id) => 'm-' + (0, node_crypto_1.createHash)('sha256').update(id).digest('hex').slice(0, 12);
exports.alias = alias;
const name = (m) => { const n = clean(m.displayName); return n && n !== m.id ? n : /^[^/]{1,35}$/.test(m.id) ? m.id : 'Unnamed model'; };
function modelChoices(models) { const counts = new Map(); for (const m of models) {
    const n = name(m).toLowerCase();
    counts.set(n, (counts.get(n) ?? 0) + 1);
} return models.map(m => ({ id: m.id, alias: (0, exports.alias)(m.id), name: name(m), label: name(m) + (counts.get(name(m).toLowerCase()) > 1 && m.provider ? ` · ${clean(m.provider)}` : '') })).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)); }
function findModel(models, query) { const a = modelChoices(models), q = query.trim().toLowerCase(); return a.filter(x => x.id.toLowerCase() === q || x.alias === q || x.name.toLowerCase() === q || x.label.toLowerCase() === q); }
function prettyWhen(t, now) { if (t === null)
    return 'never'; const n = Math.max(0, Math.floor((now - t) / 60000)); return n < 1 ? 'just now' : n < 60 ? `${n} min ago` : n < 1440 ? `${Math.floor(n / 60)} hr ago` : `${Math.floor(n / 1440)} days ago`; }
function prettyDuration(ms) { return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} sec`; }
