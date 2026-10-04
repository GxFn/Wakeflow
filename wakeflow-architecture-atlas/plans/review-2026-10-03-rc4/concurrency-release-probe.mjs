import { equal, rejects } from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RootedDirectory } from '../../../.build/src/foundation/filesystem/rooted-directory.js';
import { RootedResourceParentHandle, RootedResourceParentHandleError } from '../../../.build/src/foundation/filesystem/rooted-resource-parent-handle.js';
import { inspectRootedExclusiveFileLock } from '../../../.build/src/foundation/filesystem/rooted-exclusive-file-lock.js';
import { withRootedReadWriteScope } from '../../../.build/src/foundation/filesystem/rooted-read-write-scope.js';

// Explicitly disposable fixture; no installed workspace or product repository is opened.
const absolute = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'wakeflow-atlas-release-probe-')));
mkdirSync(path.join(absolute, 'admission'), { mode: 0o700 });
const root = await RootedDirectory.open(absolute);
const originalSync = RootedResourceParentHandle.prototype.sync;
let injected = false;
let callbackEntered = false;
const facts = {};
try {
  RootedResourceParentHandle.prototype.sync = async function (...args) {
    if (!injected && this.resourceAbsolutePath === path.join(absolute, 'admission/latch.lock') &&
        !existsSync(this.resourceAbsolutePath)) {
      injected = true;
      throw new RootedResourceParentHandleError('sync-failure', '$probe');
    }
    return originalSync.apply(this, args);
  };
  let firstFailure;
  try {
    await withRootedReadWriteScope(root, 'admission', 'exclusive', async () => { callbackEntered = true; });
  } catch (error) { firstFailure = { name: error.name, reason: error.reason }; }
  finally { RootedResourceParentHandle.prototype.sync = originalSync; }
  const firstEntries = readdirSync(path.join(absolute, 'admission'));
  const writer = await inspectRootedExclusiveFileLock(root, 'admission/writer.lock');
  let retryFailure;
  await rejects(withRootedReadWriteScope(root, 'admission', 'shared', async () => {
    throw new Error('Unexpected admission after leaked writer.');
  }, { acquireTimeoutMilliseconds: 500 }), (error) => {
    retryFailure = { name: error.name, reason: error.reason };
    return error.reason === 'timeout';
  });
  equal(injected, true);
  equal(callbackEntered, false);
  equal(firstFailure?.reason, 'release-failure');
  equal(writer.status, 'held');
  equal(writer.ownerState, 'active');
  equal(firstEntries.join(','), 'writer.lock');
  Object.assign(facts, { injectedBoundary: 'latch unlink succeeded; parent sync failed once',
    callbackEntered, firstFailure, remainingNames: firstEntries,
    writerOwnerState: writer.ownerState, retryFailure,
    conclusion: 'The latch failure prevented assignment of the already acquired writer lease; same-process admission remains blocked.' });
} finally {
  RootedResourceParentHandle.prototype.sync = originalSync;
  await root.close();
  rmSync(absolute, { recursive: true, force: true });
}
console.log(JSON.stringify(facts, null, 2));
