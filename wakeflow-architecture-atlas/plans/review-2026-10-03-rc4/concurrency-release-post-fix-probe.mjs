import { deepEqual, equal, rejects } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { threadId } from 'node:worker_threads';
import { RootedDirectory } from '../../../.build/src/foundation/filesystem/rooted-directory.js';
import { RootedResourceParentHandle, RootedResourceParentHandleError } from '../../../.build/src/foundation/filesystem/rooted-resource-parent-handle.js';
import { inspectRootedExclusiveFileLock } from '../../../.build/src/foundation/filesystem/rooted-exclusive-file-lock.js';
import { withRootedReadWriteScope } from '../../../.build/src/foundation/filesystem/rooted-read-write-scope.js';
import { rootedExclusiveFileLockRecordTextForTest } from '../../../.build/tests/foundation/filesystem/rooted-exclusive-file-lock-test-support.js';

const scenarios = [
  ['shared', 1, false], ['exclusive', 1, false], ['exclusive', 2, false],
  ['shared', 1, true], ['exclusive', 1, true],
];
const cases = [];
for (const [mode, releaseNumber, replaceLease] of scenarios) {
  // Each case owns a separate disposable fixture. It never opens an installed workspace.
  const absolute = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'wakeflow-atlas-post-fix-probe-')));
  mkdirSync(path.join(absolute, 'admission'), { mode: 0o700 });
  const root = await RootedDirectory.open(absolute);
  const originalSync = RootedResourceParentHandle.prototype.sync;
  const unknownBytes = rootedExclusiveFileLockRecordTextForTest({ pid: process.pid, threadId,
    tokenUuid: '33333333-3333-4333-8333-333333333333' });
  let settlements = 0;
  let injected = false;
  let entered = false;
  let replacedName;
  try {
    RootedResourceParentHandle.prototype.sync = async function (...args) {
      if (this.resourceAbsolutePath === path.join(absolute, 'admission/latch.lock') &&
          !existsSync(this.resourceAbsolutePath)) {
        settlements++;
        if (settlements === releaseNumber) {
          injected = true;
          if (replaceLease) {
            replacedName = readdirSync(path.join(absolute, 'admission'))
              .find((name) => name === 'writer.lock' || name.startsWith('reader-'));
            if (replacedName === undefined) throw new Error('Missing acquired lease.');
            const file = path.join(absolute, 'admission', replacedName);
            rmSync(file);
            writeFileSync(file, unknownBytes, { mode: 0o600 });
          }
          throw new RootedResourceParentHandleError('sync-failure', '$probe');
        }
      }
      return originalSync.apply(this, args);
    };
    let failure;
    await rejects(withRootedReadWriteScope(root, 'admission', mode, async () => { entered = true; }),
      (error) => {
        failure = { name: error.name, reason: error.reason, path: error.path };
        return error.reason === 'release-failure';
      });
    RootedResourceParentHandle.prototype.sync = originalSync;
    equal(injected, true);
    equal(entered, false);
    if (!replaceLease) {
      deepEqual(readdirSync(path.join(absolute, 'admission')), []);
      // Cleanup succeeded, so the original latch durability failure remains the result.
      equal(failure.path, '$lock/durability-failure');
      for (const next of ['shared', 'exclusive']) {
        equal(await withRootedReadWriteScope(root, 'admission', next, async () => 'entered',
          { acquireTimeoutMilliseconds: 1000 }), 'entered');
      }
      deepEqual(readdirSync(path.join(absolute, 'admission')), []);
      cases.push({ mode, latchReleaseNumber: releaseNumber, replacement: false,
        callbackEntered: entered, failure, remainingLeaseKinds: [],
        sameProcessReadmission: ['shared', 'exclusive'], originalLatchErrorPreserved: true });
    } else {
      const file = path.join(absolute, 'admission', replacedName);
      equal(readFileSync(file, 'utf8'), unknownBytes);
      const observation = await inspectRootedExclusiveFileLock(root, `admission/${replacedName}`);
      equal(observation.status, 'held');
      equal(observation.ownerState, 'unknown');
      // The outer finally's failed exact cleanup replaces the earlier latch error.
      equal(failure.path, '$lock/source-changed');
      let retryFailure;
      await rejects(withRootedReadWriteScope(root, 'admission', 'exclusive', async () => { entered = true; }),
        (error) => { retryFailure = { name: error.name, reason: error.reason }; return error.reason === 'recovery-required'; });
      equal(entered, false);
      equal(readFileSync(file, 'utf8'), unknownBytes);
      cases.push({ mode, latchReleaseNumber: releaseNumber, replacement: true,
        callbackEntered: entered, failure, remainingLeaseKinds: [mode === 'shared' ? 'reader' : 'writer'],
        replacementOwnerState: observation.ownerState, replacementBytesPreserved: true,
        retryFailure, originalLatchErrorPreserved: false,
        errorPrecedence: 'The failed outer cleanup replaces the earlier latch failure; no compound error is retained.' });
    }
  } finally {
    RootedResourceParentHandle.prototype.sync = originalSync;
    await root.close();
    rmSync(absolute, { recursive: true, force: true });
  }
}
const digest = (file) => createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex');
console.log(JSON.stringify({ kind: 'AtlasConcurrencyPostFixProbe', cases,
  sourceSha256: digest('../../../src/foundation/filesystem/rooted-read-write-scope.ts'),
  compiledSha256: digest('../../../.build/src/foundation/filesystem/rooted-read-write-scope.js'),
  fixture: 'Separate explicitly disposable temporary directories; all removed in finally',
  productionFilesModified: false,
  scope: 'Five deterministic filesystem fault-injection cases; not a live-host test or exhaustive fault model',
}, null, 2));
