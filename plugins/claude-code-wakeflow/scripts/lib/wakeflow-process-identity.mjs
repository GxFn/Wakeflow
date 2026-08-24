/**
 * Wakeflow跨领域进程生命周期观察器。
 *
 * 能力导航：
 * - `inspectWakeflowProcessSnapshot()`采集当前OS可验证的生命周期、父进程、可执行文件与argv摘要；
 * - `captureWakeflowProcessIdentity()`为短时锁记录当前调用进程身份；
 * - `probeWakeflowProcessIdentity()`只比较PID生命周期；
 * - `probeWakeflowProcessSubject()`进一步比较可执行文件、argv和父进程。
 *
 * PID只是查询定位器，不能单独证明原进程仍存在。本文件不发送信号、不回收锁，也不决定任何领域状态迁移。
 */
import { createHash } from "node:crypto";
import {
  readFileSync,
  readlinkSync,
} from "node:fs";

import { runSync } from "../../lib/wakeflow-process.mjs";

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;

// ===== 错误与无行为输入归一化 =====

export class WakeflowProcessIdentityError extends Error {
  constructor(code, message, { cause, details = {} } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowProcessIdentityError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}, cause = undefined) {
  throw new WakeflowProcessIdentityError(code, message, { cause, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function exactObject(value, fields, label) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail("wakeflow-process-identity-contract", `${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length
    || actual.some((field) => typeof field !== "string" || !fields.includes(field))
  ) {
    fail("wakeflow-process-identity-contract", `${label} has an invalid field set`, {
      actual: actual.map(String).sort(),
      expected,
    });
  }
  const snapshot = {};
  for (const field of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-process-identity-contract",
        `${label}.${field} must be an enumerable data property`,
      );
    }
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safePid(value, label = "pid") {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("wakeflow-process-identity-contract", `${label} must be a positive safe integer`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-process-identity-contract", `${label} must be a sha256 digest`);
  }
  return value;
}

function normalizeIdentity(value, label = "process identity") {
  const input = exactObject(value, ["platform", "pid", "startIdentity"], label);
  if (input.platform !== "darwin" && input.platform !== "linux") {
    fail("wakeflow-process-identity-contract", `${label}.platform is unsupported`);
  }
  return deepFreeze({
    platform: input.platform,
    pid: safePid(input.pid, `${label}.pid`),
    startIdentity: digest(input.startIdentity, `${label}.startIdentity`),
  });
}

function normalizeSubject(value, label = "process subject") {
  const input = exactObject(
    value,
    ["identity", "parentPid", "executableDigest", "argvDigest"],
    label,
  );
  return deepFreeze({
    identity: normalizeIdentity(input.identity, `${label}.identity`),
    parentPid: safePid(input.parentPid, `${label}.parentPid`),
    executableDigest: digest(input.executableDigest, `${label}.executableDigest`),
    argvDigest: digest(input.argvDigest, `${label}.argvDigest`),
  });
}

// ===== Linux /proc观察 =====

// 从boot id、PID与启动tick建立生命周期身份，同时读取父进程字段。
function linuxStat(pid) {
  let bootId;
  let statLine;
  try {
    bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    statLine = readFileSync(`/proc/${pid}/stat`, "utf8").trim();
  } catch (cause) {
    if (cause?.code === "ENOENT" || cause?.code === "ESRCH") return null;
    throw cause;
  }
  const closeParen = statLine.lastIndexOf(")");
  if (!bootId || closeParen < 0) {
    fail("wakeflow-process-identity-observation", "Linux process stat is malformed");
  }
  const fields = statLine.slice(closeParen + 2).split(" ");
  const parentPid = Number(fields[1]);
  const startTicks = fields[19];
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0 || !/^[0-9]+$/u.test(startTicks ?? "")) {
    fail("wakeflow-process-identity-observation", "Linux process identity fields are malformed");
  }
  return Object.freeze({
    bootId,
    parentPid,
    startTicks,
  });
}

// 将/proc暴露的路径和NUL分隔argv压成可持久化摘要，避免把本机命令内容写入协议文件。
function linuxSnapshot(pid) {
  const stat = linuxStat(pid);
  if (stat === null) return null;
  let executable;
  let argv;
  try {
    executable = readlinkSync(`/proc/${pid}/exe`);
    argv = readFileSync(`/proc/${pid}/cmdline`);
  } catch (cause) {
    if (cause?.code === "ENOENT" || cause?.code === "ESRCH") return null;
    throw cause;
  }
  if (!executable || argv.length === 0) {
    fail("wakeflow-process-identity-observation", "Linux executable or argv observation is empty");
  }
  return deepFreeze({
    identity: {
      platform: "linux",
      pid,
      startIdentity: digestBytes(Buffer.from(
        `linux\0${pid}\0${stat.bootId}\0${stat.startTicks}`,
        "utf8",
      )),
    },
    parentPid: stat.parentPid,
    executableDigest: digestBytes(Buffer.from(executable, "utf8")),
    argvDigest: digestBytes(argv),
  });
}

// ===== Darwin ps观察 =====

// 每次调用使用固定locale、无shell和超时，只把指定字段作为观察证据返回。
function darwinPsField(pid, field) {
  const result = runSync("/bin/ps", ["-o", `${field}=`, "-p", String(pid)], {
    encoding: "utf8",
    env: {
      LANG: "C",
      LC_ALL: "C",
      TZ: "UTC",
    },
    shell: false,
    timeout: 2_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const output = String(result.stdout ?? "").trim();
  if (result.status !== 0 || !output) return null;
  return output;
}

// Darwin快照保留启动身份、父进程与命令摘要；这些事实仍需后续probe重新观察才能判定当前性。
function darwinSnapshot(pid) {
  const start = darwinPsField(pid, "lstart");
  if (start === null) return null;
  const parent = darwinPsField(pid, "ppid");
  const executable = darwinPsField(pid, "comm");
  const command = darwinPsField(pid, "command");
  if (parent === null || executable === null || command === null) return null;
  const parentPid = Number(parent);
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) {
    fail("wakeflow-process-identity-observation", "Darwin parent pid is malformed");
  }
  const normalizedStart = start.replace(/\s+/gu, " ");
  return deepFreeze({
    identity: {
      platform: "darwin",
      pid,
      startIdentity: digestBytes(Buffer.from(`darwin\0${pid}\0${normalizedStart}`, "utf8")),
    },
    parentPid,
    executableDigest: digestBytes(Buffer.from(executable, "utf8")),
    argvDigest: digestBytes(Buffer.from(command, "utf8")),
  });
}

// ===== 公共观察与比较入口 =====

/**
 * 为一个正PID采集当前平台快照；进程已消失返回null，平台或观察错误则fail closed。
 */
export function inspectWakeflowProcessSnapshot(pid) {
  safePid(pid);
  if (process.platform !== "darwin" && process.platform !== "linux") {
    fail(
      "wakeflow-process-identity-platform",
      `unsupported process identity platform: ${process.platform}`,
    );
  }
  try {
    return process.platform === "linux" ? linuxSnapshot(pid) : darwinSnapshot(pid);
  } catch (cause) {
    if (cause instanceof WakeflowProcessIdentityError) throw cause;
    fail(
      "wakeflow-process-identity-observation",
      "cannot inspect process lifetime identity",
      {},
      cause,
    );
  }
}

/**
 * 捕获当前Node进程的生命周期身份，供workspace gate和领域短锁记录所有者。
 */
export function captureWakeflowProcessIdentity() {
  const snapshot = inspectWakeflowProcessSnapshot(process.pid);
  if (snapshot === null) {
    fail("wakeflow-process-identity-observation", "self process lifetime identity disappeared");
  }
  return snapshot.identity;
}

/**
 * 重查记录中的PID，并区分同一生命周期、旧身份已消失或复用、以及无法验证三类结论。
 */
export function probeWakeflowProcessIdentity(value) {
  const identity = normalizeIdentity(value);
  if (identity.platform !== process.platform) return "unverifiable";
  let snapshot;
  try {
    snapshot = inspectWakeflowProcessSnapshot(identity.pid);
  } catch {
    return "unverifiable";
  }
  if (snapshot === null || snapshot.identity.startIdentity !== identity.startIdentity) {
    return "old-identity-gone-or-reused";
  }
  return "same-live";
}

/**
 * 在生命周期相同后继续核对可执行文件、argv和父进程；调用者据此决定能否复用或操作该主体。
 */
export function probeWakeflowProcessSubject(value) {
  const subject = normalizeSubject(value);
  if (subject.identity.platform !== process.platform) return "unverifiable";
  let snapshot;
  try {
    snapshot = inspectWakeflowProcessSnapshot(subject.identity.pid);
  } catch {
    return "unverifiable";
  }
  if (
    snapshot === null
    || snapshot.identity.startIdentity !== subject.identity.startIdentity
  ) {
    return "old-identity-gone-or-reused";
  }
  if (snapshot.executableDigest !== subject.executableDigest) return "executable-mismatch";
  if (snapshot.argvDigest !== subject.argvDigest) return "argv-mismatch";
  if (snapshot.parentPid !== subject.parentPid) return "parent-mismatch";
  return "same-live";
}
