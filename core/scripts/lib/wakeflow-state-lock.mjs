import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const ACQUIRE_TIMEOUT_MS = 2000;
const STALE_LOCK_MS = 30000;
const RETRY_DELAY_MS = 25;

export class WakeflowStateLockTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.code = "WAKEFLOW_STATE_LOCK_TIMEOUT";
  }
}

// The lock file lives BESIDE the state root (<root>.state-lock), never inside it:
// archive-demand stages, renames, and removes the root while holding the lock, and
// the P1-0 redaction scan must never see lock tokens inside the tree it audits.
export function stateRootLockFile(stateRoot) {
  const resolved = path.resolve(stateRoot);
  return path.join(path.dirname(resolved), `${path.basename(resolved)}.state-lock`);
}

export function withStateRootLock(stateRoot, fn, options = {}) {
  return withFileLock(stateRootLockFile(stateRoot), fn, options);
}

// Cross-PROCESS mutex for a read-modify-write critical section, via an O_EXCL lock
// file. Sync on purpose: every wakeflow-state command is synchronous, and the MCP
// layer runs each command as its own child process, so parallel tool calls from one
// controller turn are exactly the racers this must serialize. Callers must resolve
// and validate the guarded path BEFORE locking (the lock file's parent directory is
// not created here).
export function withFileLock(lockFile, fn, { acquireTimeoutMs = ACQUIRE_TIMEOUT_MS, staleMs = STALE_LOCK_MS, onWarn } = {}) {
  const token = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const deadline = Date.now() + acquireTimeoutMs;
  for (;;) {
    try {
      writeFileSync(
        lockFile,
        `${JSON.stringify({ kind: "WakeflowStateLock", version: 1, pid: process.pid, token, createdAt: new Date().toISOString() })}\n`,
        { flag: "wx" },
      );
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const holder = readLock(lockFile);
      const ageMs = holder?.createdAt ? Date.now() - Date.parse(holder.createdAt) : Number.POSITIVE_INFINITY;
      // NaN age (garbage createdAt) must count as stale, hence the negated form.
      if (!(ageMs <= staleMs)) {
        // The fixed stale threshold cannot tell a crash from a legitimate long
        // hold (archive-demand staging a large state root). A LIVE holder pid
        // gets 4x patience before the lock is stolen; a dead pid is residue.
        if (pidAlive(holder?.pid) && ageMs <= staleMs * 4) {
          if (Date.now() >= deadline) {
            throw new WakeflowStateLockTimeoutError(
              `state root is locked by a LIVE long-running Wakeflow process (pid ${holder.pid}, since ${holder.createdAt}); retry after it finishes — do not remove ${lockFile} while that pid is alive`,
            );
          }
          sleep(RETRY_DELAY_MS + Math.floor(Math.random() * RETRY_DELAY_MS));
          continue;
        }
        // Crash residue or an unreadable lock: break it. Re-check the holder just
        // before unlink so two concurrent breakers cannot free each other's FRESH
        // lock; the remaining microsecond TOCTOU only exists on the 30s-stuck
        // recovery path, never in normal contention.
        const recheck = readLock(lockFile);
        if ((recheck?.token ?? null) === (holder?.token ?? null)) {
          onWarn?.(`breaking stale state lock ${lockFile} (held by pid ${holder?.pid ?? "unknown"}${pidAlive(holder?.pid) ? " STILL ALIVE past 4x stale age" : ""} since ${holder?.createdAt ?? "unknown"})`);
          try {
            unlinkSync(lockFile);
          } catch {
            // already freed by a concurrent breaker
          }
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new WakeflowStateLockTimeoutError(
          `state root is locked by another Wakeflow process (pid ${holder?.pid ?? "unknown"}, since ${holder?.createdAt ?? "unknown"}); retry after it finishes, or remove ${lockFile} if that process is gone`,
        );
      }
      sleep(RETRY_DELAY_MS + Math.floor(Math.random() * RETRY_DELAY_MS));
    }
  }
  try {
    return fn();
  } finally {
    releaseOwnLock(lockFile, token);
  }
}

function readLock(lockFile) {
  try {
    return JSON.parse(readFileSync(lockFile, "utf8"));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseOwnLock(lockFile, token) {
  // Release only a lock this process still owns: after a stale-break by another
  // process the file may already carry someone else's token, or be gone.
  try {
    if (JSON.parse(readFileSync(lockFile, "utf8"))?.token !== token) return;
  } catch {
    return;
  }
  try {
    unlinkSync(lockFile);
  } catch {
    // already freed
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
