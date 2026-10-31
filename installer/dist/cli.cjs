#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const installer_cts_1 = require("./installer.cjs");
function run(argv) {
    const command = argv[0];
    if (!['inspect', 'dry-run', 'install', 'verify', 'status', 'uninstall', 'restore'].includes(command)) {
        throw new installer_cts_1.Refusal('command-required-inspect-dry-run-install-verify-status-uninstall-restore');
    }
    const options = {};
    for (let index = 1; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--offline-copy')
            options.offlineCopy = true;
        else if (argument === '--recover-pending')
            options.recoverPending = true;
        else if (argument === '--app' || argument === '--shim-package') {
            const value = argv[++index];
            if (!value || value.startsWith('--'))
                throw new installer_cts_1.Refusal('option-value-required');
            if (argument === '--app')
                options.app = value;
            else
                options.shimPackage = value;
        }
        else
            throw new installer_cts_1.Refusal('unknown-option');
    }
    if (!options.app)
        throw new installer_cts_1.Refusal('explicit-app-path-required');
    if (options.recoverPending && command !== 'restore')
        throw new installer_cts_1.Refusal('recover-pending-only-for-restore');
    const exact = options;
    if (command === 'install')
        return (0, installer_cts_1.install)(exact);
    if (command === 'dry-run')
        return (0, installer_cts_1.dryRun)(exact);
    if (command === 'restore' || command === 'uninstall')
        return (0, installer_cts_1.restore)(exact);
    return (0, installer_cts_1.inspect)(exact);
}
if (require.main === module) {
    try {
        process.stdout.write(JSON.stringify(run(process.argv.slice(2)), null, 2) + '\n');
    }
    catch (error) {
        process.stdout.write(JSON.stringify({ status: 'refused', changed: false,
            reason: error instanceof installer_cts_1.Refusal ? error.code : 'filesystem-or-tool-failure' }, null, 2) + '\n');
        process.exitCode = 1;
    }
}
