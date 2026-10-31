#!/usr/bin/env node
import { inspect, dryRun, install, restore, Refusal, type Options } from './installer.cts';

export function run(argv: string[]): Record<string, unknown> {
  const command = argv[0];
  if (!['inspect', 'dry-run', 'install', 'verify', 'status', 'uninstall', 'restore'].includes(command)) {
    throw new Refusal('command-required-inspect-dry-run-install-verify-status-uninstall-restore');
  }
  const options: Partial<Options> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--offline-copy') options.offlineCopy = true;
    else if (argument === '--recover-pending') options.recoverPending = true;
    else if (argument === '--app' || argument === '--shim-package') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Refusal('option-value-required');
      if (argument === '--app') options.app = value;
      else options.shimPackage = value;
    } else throw new Refusal('unknown-option');
  }
  if (!options.app) throw new Refusal('explicit-app-path-required');
  if (options.recoverPending && command !== 'restore') throw new Refusal('recover-pending-only-for-restore');
  const exact = options as Options;
  if (command === 'install') return install(exact);
  if (command === 'dry-run') return dryRun(exact);
  if (command === 'restore' || command === 'uninstall') return restore(exact);
  return inspect(exact);
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(run(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) {
    process.stdout.write(JSON.stringify({ status: 'refused', changed: false,
      reason: error instanceof Refusal ? error.code : 'filesystem-or-tool-failure' }, null, 2) + '\n');
    process.exitCode = 1;
  }
}
