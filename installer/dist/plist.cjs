"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodePlist = decodePlist;
exports.encodePlist = encodePlist;
const node_child_process_1 = require("node:child_process");
const asar_cts_1 = require("./asar.cjs");
function decodePlist(bytes) {
    try {
        return JSON.parse((0, node_child_process_1.execFileSync)('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: bytes, timeout: 10000, maxBuffer: 8 * 1024 * 1024 }).toString('utf8'));
    }
    catch {
        (0, asar_cts_1.refuse)('plist-decode-failed');
    }
}
function encodePlist(metadata, original) {
    try {
        return (0, node_child_process_1.execFileSync)('/usr/bin/plutil', ['-convert', original.subarray(0, 8).toString() === 'bplist00' ? 'binary1' : 'xml1',
            '-o', '-', '--', '-'], { input: Buffer.from(JSON.stringify(metadata)), timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
    }
    catch {
        (0, asar_cts_1.refuse)('plist-encode-failed');
    }
}
