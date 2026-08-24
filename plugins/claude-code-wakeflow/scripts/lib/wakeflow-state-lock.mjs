import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Wakeflow共享同步进程锁primitive。
 *
 * 阅读地图：stateRootLockFile把同一physical state root映射到旁路锁；withFileLock以O_EXCL
 * 创建短命owner记录并串行执行同步critical section；reader以bounded no-follow稳定读取判断live、
 * stale或unsafe。它不持久化业务状态，也不能跨Promise、替代domain transaction或证明host liveness。
 */

const ACQUIRE_TIMEOUT_MS = 2000;
const STALE_LOCK_MS = 30000;
const RETRY_DELAY_MS = 25;
const LOCK_RECORD_MAX_BYTES = 4096;
const LOCK_OPTION_FIELDS = new Set(["acquireTimeoutMs", "onWarn", "staleMs"]);
const LOCK_RECORD_FIELDS = ["createdAt", "kind", "pid", "token", "version"];
const TOKEN_PATTERN = /^[1-9][0-9]*-[0-9a-z-]+$/u;
const UTF8_FATAL_DECODER = new TextDecoder("utf-8", { fatal: true });
const ASYNC_CALLBACK_PROTOTYPES = new Set([
  Object.getPrototypeOf(async function () {}),
  Object.getPrototypeOf(function* () {}),
  Object.getPrototypeOf(async function* () {}),
]);

export class WakeflowStateLockTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.code = "WAKEFLOW_STATE_LOCK_TIMEOUT";
  }
}

export class WakeflowStateLockUnsafeError extends WakeflowStateLockTimeoutError {
  constructor(message, lockFile) {
    super(message);
    this.name = "WakeflowStateLockUnsafeError";
    this.code = "WAKEFLOW_STATE_LOCK_UNSAFE";
    this.path = lockFile;
  }
}

// 锁文件位于state root旁边而不是内部，使archive可在持锁时整体移动root，也避免token进入审计树。
export function stateRootLockFile(stateRoot) {
  if (
    typeof stateRoot !== "string"
    || !stateRoot.trim()
    || stateRoot !== stateRoot.trim()
    || !path.isAbsolute(stateRoot)
    || path.resolve(stateRoot) !== stateRoot
    || /[\u0000-\u001f\u007f-\u009f]/u.test(stateRoot)
  ) {
    throw invalidLockInput("state root must be one normalized absolute path", "stateRoot");
  }
  let resolved = path.resolve(stateRoot);
  try {
    // Symlinked spellings of the same root (macOS /tmp -> /private/tmp) must
    // map to ONE lock file, or two processes hold two "different" locks.
    resolved = realpathSync(resolved);
  } catch {
    // root not created yet or racing a removal: the resolve() spelling stands
  }
  return path.join(path.dirname(resolved), `${path.basename(resolved)}.state-lock`);
}

export function withStateRootLock(stateRoot, fn, options = {}) {
  return withFileLock(stateRootLockFile(stateRoot), fn, options);
}

// ==================== 一、同步文件锁入口 ====================

// O_EXCL锁只串行化同步read-modify-write；caller必须先准入guarded path，本模块不创建父目录。
export function withFileLock(lockFile, fn, options = undefined) {
  const { acquireTimeoutMs, staleMs, onWarn } = normalizeLockInputs(lockFile, fn, options);
  const token = `${process.pid}-${randomUUID()}`;
  const deadline = Date.now() + acquireTimeoutMs;
  for (;;) {
    try {
      createOwnLockFile(lockFile, token);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const lockStat = inspectLockFile(lockFile);
      if (!lockStat) continue;
      const holder = readLock(lockFile);
      // Unreadable/mid-write lock: writeFileSync(wx) is open-then-write, so a
      // contender can read the file EMPTY inside the acquirer's gap. Treating
      // that as infinitely stale would break a FRESH lock in normal contention;
      // age it by file mtime instead. A non-finite age from malformed metadata
      // is bounded by the acquisition deadline rather than treated as stale.
      const ageMs = holder?.createdAt
        ? Date.now() - Date.parse(holder.createdAt)
        : lockFileAgeMs(lockFile);
      // The holder may release the lock between EEXIST/readLock/stat. In that
      // case there is no stale artifact to break: retry acquisition. Treating
      // the vanished file as infinitely old lets this contender race with the
      // next owner and unlink that owner's just-created, not-yet-written lock.
      if (!Number.isFinite(ageMs)) {
        if (!inspectLockFile(lockFile)) continue;
        if (Date.now() >= deadline) {
          throw new WakeflowStateLockTimeoutError(
            `state root lock ${lockFile} exists but cannot be read safely; retry after verifying the lock artifact`,
          );
        }
        sleep(RETRY_DELAY_MS + Math.floor(Math.random() * RETRY_DELAY_MS));
        continue;
      }
      if (!(ageMs <= staleMs)) {
        // The fixed stale threshold cannot tell a crash from a legitimate long
        // hold (archive-demand staging a large state root). A LIVE holder pid
        // is NEVER auto-stolen (H-10 revised): ageMs runs on wall clocks, so a
        // suspend/NTP jump > the old 4x grace would have let a contender break
        // a lock whose holder was mid-critical-section — two writers on one
        // state root. A truly wedged live holder is a human call; the timeout
        // message says exactly what to check.
        if (pidAlive(holder?.pid)) {
          if (Date.now() >= deadline) {
            throw new WakeflowStateLockTimeoutError(
              `state root is locked by a LIVE Wakeflow process (pid ${holder?.pid}, since ${holder?.createdAt ?? "unknown"}); retry after it finishes — remove ${lockFile} only if you have confirmed that pid is wedged`,
            );
          }
          sleep(RETRY_DELAY_MS + Math.floor(Math.random() * RETRY_DELAY_MS));
          continue;
        }
        // Crash residue (dead pid) or an unreadable lock: break it. Re-check
        // the holder just before unlink so two concurrent breakers cannot free
        // each other's FRESH lock; the remaining microsecond TOCTOU only
        // exists on the 30s-stuck recovery path, never in normal contention.
        const recheck = readLock(lockFile);
        const recheckAgeMs = recheck?.createdAt
          ? Date.now() - Date.parse(recheck.createdAt)
          : lockFileAgeMs(lockFile);
        if (
          Number.isFinite(recheckAgeMs)
          && recheckAgeMs > staleMs
          && (recheck?.token ?? null) === (holder?.token ?? null)
        ) {
          let removed = false;
          try {
            unlinkSync(lockFile);
            removed = true;
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
            // already freed by a concurrent breaker
          }
          // 告警回调不是删除授权。必须在旧路径已经移除后调用，避免回调写入的新owner
          // 被当前contender随后误删。
          if (removed) {
            onWarn?.(`breaking stale state lock ${lockFile} (held by dead pid ${holder?.pid ?? "unknown"} since ${holder?.createdAt ?? "unknown"})`);
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
    const result = fn();
    if (hasThenableContract(result)) {
      throw invalidLockInput(
        "state lock critical section must finish synchronously and cannot return a Promise or thenable",
      );
    }
    return result;
  } finally {
    releaseOwnLock(lockFile, token);
  }
}

function createOwnLockFile(lockFile, token) {
  let descriptor = null;
  let opened = null;
  try {
    descriptor = openSync(
      lockFile,
      fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    opened = fstatSync(descriptor, { bigint: true });
    fchmodSync(descriptor, 0o600);
    writeFileSync(
      descriptor,
      `${JSON.stringify({ kind: "WakeflowStateLock", version: 1, pid: process.pid, token, createdAt: new Date().toISOString() })}\n`,
    );
    const written = fstatSync(descriptor, { bigint: true });
    assertSafeLockStat(lockFile, written);
    const pathStat = lstatSync(lockFile, { bigint: true });
    assertSafeLockStat(lockFile, pathStat);
    if (!sameLockIdentity(written, pathStat)) {
      throw unsafeLockPath(lockFile, "changed while the owner record was written");
    }
  } catch (error) {
    // openSync(EEXIST) did not create anything. A later failure cleans only the
    // inode opened by this attempt; it never guesses from a semantic filename.
    if (descriptor !== null && opened !== null) {
      try {
        const current = lstatSync(lockFile, { bigint: true });
        if (current.dev === opened.dev && current.ino === opened.ino) unlinkSync(lockFile);
      } catch {
        // preserve the creation failure as primary
      }
    }
    throw error;
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // creation/read error remains primary; a verified path record is handled by normal recovery
      }
    }
  }
}

// ==================== 二、被动输入与同步生命周期合同 ====================

function normalizeLockInputs(lockFile, fn, options) {
  if (
    typeof lockFile !== "string"
    || !lockFile.trim()
    || lockFile !== lockFile.trim()
    || !path.isAbsolute(lockFile)
    || path.resolve(lockFile) !== lockFile
    || /[\u0000-\u001f\u007f-\u009f]/u.test(lockFile)
  ) {
    throw invalidLockInput("state lock path must be one normalized absolute path", "lockFile");
  }
  if (typeof fn !== "function" || ASYNC_CALLBACK_PROTOTYPES.has(Object.getPrototypeOf(fn))) {
    throw invalidLockInput("state lock critical section must be one synchronous function", "fn");
  }
  const value = options === undefined ? {} : options;
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw invalidLockInput("state lock options must be one plain data object", "options");
  }
  const normalized = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !LOCK_OPTION_FIELDS.has(key)) {
      throw invalidLockInput(
        "state lock options contain an unknown field",
        typeof key === "string" ? key : "<symbol>",
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw invalidLockInput("state lock options require enumerable data properties", key);
    }
    normalized[key] = descriptor.value;
  }
  const acquireTimeoutMs = normalized.acquireTimeoutMs ?? ACQUIRE_TIMEOUT_MS;
  const staleMs = normalized.staleMs ?? STALE_LOCK_MS;
  const onWarn = normalized.onWarn;
  if (!Number.isSafeInteger(acquireTimeoutMs) || acquireTimeoutMs <= 0) {
    throw invalidLockInput("state lock acquireTimeoutMs must be a positive safe integer", "acquireTimeoutMs");
  }
  if (!Number.isSafeInteger(staleMs) || staleMs <= 0) {
    throw invalidLockInput("state lock staleMs must be a positive safe integer", "staleMs");
  }
  if (onWarn !== undefined && typeof onWarn !== "function") {
    throw invalidLockInput("state lock onWarn must be a function when supplied", "onWarn");
  }
  return Object.freeze({ acquireTimeoutMs, staleMs, onWarn });
}

function invalidLockInput(message, field = null) {
  const error = new TypeError(message);
  error.code = "WAKEFLOW_STATE_LOCK_INPUT";
  if (field !== null) error.field = field;
  return error;
}

function hasThenableContract(value) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  let current = value;
  const visited = new Set();
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, "then");
    if (descriptor) {
      return !Object.hasOwn(descriptor, "value") || typeof descriptor.value === "function";
    }
    current = Object.getPrototypeOf(current);
  }
  return false;
}

// ==================== 三、锁记录稳定读取与陈旧判定 ====================

function readLock(lockFile) {
  const before = inspectLockFile(lockFile);
  if (!before) return null;
  let descriptor;
  try {
    descriptor = openSync(lockFile, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error?.code === "ELOOP") throw unsafeLockPath(lockFile, "cannot be a symlink");
    return null;
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    assertSafeLockStat(lockFile, opened);
    if (!sameLockIdentity(before, opened)) return null;
    const buffer = Buffer.allocUnsafe(Number(opened.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > LOCK_RECORD_MAX_BYTES) {
      throw unsafeLockPath(lockFile, `cannot exceed ${LOCK_RECORD_MAX_BYTES} bytes`);
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const after = inspectLockFile(lockFile);
    if (
      !after
      || offset !== Number(opened.size)
      || !sameLockIdentity(opened, afterDescriptor)
      || !sameLockIdentity(opened, after)
    ) return null;
    let content;
    try {
      content = UTF8_FATAL_DECODER.decode(buffer.subarray(0, offset));
    } catch {
      return null;
    }
    return parseLockRecord(content);
  } catch (error) {
    if (error instanceof WakeflowStateLockUnsafeError) throw error;
    return null;
  } finally {
    try {
      closeSync(descriptor);
    } catch {
      // read-only descriptor cleanup cannot make an untrusted record authoritative
    }
  }
}

function parseLockRecord(content) {
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== LOCK_RECORD_FIELDS.length) return null;
  if (keys.some((key, index) => key !== [...LOCK_RECORD_FIELDS].sort()[index])) return null;
  if (
    value.kind !== "WakeflowStateLock"
    || value.version !== 1
    || !Number.isSafeInteger(value.pid)
    || value.pid <= 0
    || typeof value.token !== "string"
    || !TOKEN_PATTERN.test(value.token)
    || typeof value.createdAt !== "string"
  ) return null;
  const createdAtMs = Date.parse(value.createdAt);
  if (!Number.isFinite(createdAtMs) || new Date(createdAtMs).toISOString() !== value.createdAt) return null;
  return Object.freeze({
    kind: "WakeflowStateLock",
    version: 1,
    pid: value.pid,
    token: value.token,
    createdAt: value.createdAt,
  });
}

function lockFileAgeMs(lockFile) {
  const stat = inspectLockFile(lockFile);
  return stat ? Date.now() - Number(stat.mtimeNs / 1_000_000n) : Number.POSITIVE_INFINITY;
}

function unsafeLockPath(lockFile, expectation) {
  return new WakeflowStateLockUnsafeError(
    `state root lock ${lockFile} ${expectation}; refusing to follow or replace it`,
    lockFile,
  );
}

function inspectLockFile(lockFile) {
  let stat;
  try {
    stat = lstatSync(lockFile, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  assertSafeLockStat(lockFile, stat, { allowCreationGap: true });
  return stat;
}

function assertSafeLockStat(lockFile, stat, { allowCreationGap = false } = {}) {
  if (stat.isSymbolicLink()) throw unsafeLockPath(lockFile, "cannot be a symlink");
  if (!stat.isFile()) throw unsafeLockPath(lockFile, "must be a regular file");
  if (stat.nlink !== 1n) throw unsafeLockPath(lockFile, "must have exactly one link");
  if (stat.size > BigInt(LOCK_RECORD_MAX_BYTES)) {
    throw unsafeLockPath(lockFile, `cannot exceed ${LOCK_RECORD_MAX_BYTES} bytes`);
  }
  const mode = Number(stat.mode & 0o777n);
  const creationMode = stat.size === 0n && (mode & ~0o600) === 0;
  if (
    process.platform !== "win32"
    && mode !== 0o600
    && !(allowCreationGap && creationMode)
  ) {
    throw unsafeLockPath(lockFile, "must have mode 0600");
  }
  if (
    typeof process.geteuid === "function"
    && stat.uid !== BigInt(process.geteuid())
  ) throw unsafeLockPath(lockFile, "must belong to the current effective user");
}

function sameLockIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = the pid exists but belongs to another user: that is ALIVE.
    return error?.code === "EPERM";
  }
}

function releaseOwnLock(lockFile, token) {
  // Release only a lock this process still owns: after a stale-break by another
  // process the file may already carry someone else's token, or be gone.
  try {
    if (readLock(lockFile)?.token !== token) return;
  } catch {
    return;
  }
  try {
    unlinkSync(lockFile);
  } catch {
    // already freed
  }
}

// ==================== 四、同步退避 ====================

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
