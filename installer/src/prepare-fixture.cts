#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { inspect, isLiveAppPath, Refusal } from './installer.cts';
import { digest } from './asar.cts';

export function prepareFixture(sourceApp: string, output: string): Record<string, unknown> {
  const source = fs.realpathSync(sourceApp);
  const verified = inspect({ app: source });
  if (verified.status !== 'supported-original') throw new Refusal('fixture-source-must-be-supported-original');
  const parent = fs.realpathSync(path.dirname(path.resolve(output)));
  const target = path.join(parent, path.basename(output));
  if (isLiveAppPath(target) || target === source || fs.existsSync(target)) throw new Refusal('fixture-output-must-be-new-offline-path');
  fs.mkdirSync(target, { mode: 0o700 });
  try {
    fs.mkdirSync(path.join(target, 'Contents/Resources'), { recursive: true });
    fs.copyFileSync(path.join(source, 'Contents/Resources/app.asar'), path.join(target, 'Contents/Resources/app.asar'));
    fs.copyFileSync(path.join(source, 'Contents/Info.plist'), path.join(target, 'Contents/Info.plist'));
    const result = { status: 'fixture-created', target, runnableApp: false,
      archiveSha256: digest(fs.readFileSync(path.join(target, 'Contents/Resources/app.asar'))),
      plistSha256: digest(fs.readFileSync(path.join(target, 'Contents/Info.plist'))),
      scope: 'ASAR and Info.plist only; no executables, app data, or credentials' };
    fs.writeFileSync(path.join(target, '.grokbot-offline-fixture.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return result;
  } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
}
if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    if (argv.length !== 4 || argv[0] !== '--source-app' || argv[2] !== '--out') throw new Refusal('usage-source-app-path-out-new-path');
    process.stdout.write(JSON.stringify(prepareFixture(argv[1], argv[3]), null, 2) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: 'refused', changedSource: false,
      reason: error instanceof Refusal ? error.code : 'fixture-filesystem-failure' }, null, 2) + '\n');
    process.exitCode = 1;
  }
}
