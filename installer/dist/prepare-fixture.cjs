#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareFixture = prepareFixture;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const installer_cts_1 = require("./installer.cjs");
const asar_cts_1 = require("./asar.cjs");
function prepareFixture(sourceApp, output) {
    const source = fs.realpathSync(sourceApp);
    const verified = (0, installer_cts_1.inspect)({ app: source });
    if (verified.status !== 'supported-original')
        throw new installer_cts_1.Refusal('fixture-source-must-be-supported-original');
    const parent = fs.realpathSync(path.dirname(path.resolve(output)));
    const target = path.join(parent, path.basename(output));
    if ((0, installer_cts_1.isLiveAppPath)(target) || target === source || fs.existsSync(target))
        throw new installer_cts_1.Refusal('fixture-output-must-be-new-offline-path');
    fs.mkdirSync(target, { mode: 0o700 });
    try {
        fs.mkdirSync(path.join(target, 'Contents/Resources'), { recursive: true });
        fs.copyFileSync(path.join(source, 'Contents/Resources/app.asar'), path.join(target, 'Contents/Resources/app.asar'));
        fs.copyFileSync(path.join(source, 'Contents/Info.plist'), path.join(target, 'Contents/Info.plist'));
        const result = { status: 'fixture-created', target, runnableApp: false,
            archiveSha256: (0, asar_cts_1.digest)(fs.readFileSync(path.join(target, 'Contents/Resources/app.asar'))),
            plistSha256: (0, asar_cts_1.digest)(fs.readFileSync(path.join(target, 'Contents/Info.plist'))),
            scope: 'ASAR and Info.plist only; no executables, app data, or credentials' };
        fs.writeFileSync(path.join(target, '.grokbot-offline-fixture.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        return result;
    }
    catch (error) {
        fs.rmSync(target, { recursive: true, force: true });
        throw error;
    }
}
if (require.main === module) {
    try {
        const argv = process.argv.slice(2);
        if (argv.length !== 4 || argv[0] !== '--source-app' || argv[2] !== '--out')
            throw new installer_cts_1.Refusal('usage-source-app-path-out-new-path');
        process.stdout.write(JSON.stringify(prepareFixture(argv[1], argv[3]), null, 2) + '\n');
    }
    catch (error) {
        process.stdout.write(JSON.stringify({ status: 'refused', changedSource: false,
            reason: error instanceof installer_cts_1.Refusal ? error.code : 'fixture-filesystem-failure' }, null, 2) + '\n');
        process.exitCode = 1;
    }
}
