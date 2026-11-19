import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { verifyArtifactAgainstManifest } from "../artifacts/check-plugin-artifacts.js";
import { isRecord, sha256 } from "../verification/files.js";

/**
 * Wakeflow Tooling / Storage metrics：一次公共工具调用让服务进程做了多少次文件系统调用（ADR-0032）。
 *
 * 对一份制品副本起一个新的 stdio 进程，进程里预加载一段计数脚本：它包住 `node:fs` 的 Promise 接口、
 * 同步接口与文件句柄的方法，记下每一种调用的次数与耗时。每调用一次工具取一次计数并清零。结果只有计数与
 * 毫秒，没有路径与内容。和 `mcp call` 一样调用的是新进程；变更类工具会真的改工作区，只对可丢弃工作区使用。
 * 耗时是各次调用耗时之和，调用并行时会超过墙钟——用来比较前后，不当作墙钟的分解。
 */

export interface StorageCallCounters {
  readonly fileSystemCalls: number;
  /** lstat 与 realpath：逐段核对路径的那一部分。 */
  readonly pathChecks: number;
  readonly opens: number;
  readonly reads: number;
  readonly writes: number;
  readonly directoryReads: number;
  /** 落盘同步（文件与目录的 fsync、fdatasync）的次数与耗时。 */
  readonly syncs: number;
  readonly syncMs: number;
  readonly renames: number;
  readonly links: number;
  readonly unlinks: number;
  readonly fileSystemMs: number;
}

export interface StorageMetricsCall extends StorageCallCounters {
  readonly tool: string;
  readonly wallMs: number;
  readonly toolStatus: "passed" | "failed";
}

export interface StorageMetrics {
  readonly kind: "WakeflowStorageMetrics";
  readonly schemaVersion: 1;
  readonly status: "passed";
  readonly candidate: Readonly<{ hostId: string; version: string; manifestDigest: string }>;
  readonly calls: readonly Readonly<StorageMetricsCall>[];
  readonly runtime: "generated-stdio-new-process";
}

export interface StorageMetricsRequest {
  readonly candidate: string;
  readonly workspace: string;
  readonly tool: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly repeat: number;
}

const TOOL_NAME_PATTERN = /^wakeflow_[a-z_]{1,64}$/u;
const MAXIMUM_REPEAT = 20;
const DUMP_ENVIRONMENT_NAME = "WAKEFLOW_STORAGE_METRICS_DIR";
const PATH_CHECK_KEYS = ["lstat", "realpath", "lstatSync", "realpathSync"] as const;
const SYNC_KEYS = ["handle.sync", "handle.datasync", "fsyncSync", "fdatasyncSync"] as const;

/** 预加载脚本：只统计，不改变任何调用的行为；收到 SIGUSR2 把计数写成一个文件并清零。 */
const COUNTER_PRELOAD = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
const counters = new Map();
function bump(label, started) {
  const entry = counters.get(label) ?? { n: 0, ms: 0 };
  entry.n += 1;
  entry.ms += performance.now() - started;
  counters.set(label, entry);
}
function wrap(target, name, label) {
  const original = target[name];
  if (typeof original !== "function") return;
  const wrapped = function (...args) {
    const started = performance.now();
    let result;
    try {
      result = original.apply(this, args);
    } catch (error) {
      bump(label, started);
      throw error;
    }
    if (result !== null && typeof result === "object" && typeof result.then === "function") {
      return result.then(
        (value) => { bump(label, started); return value; },
        (error) => { bump(label, started); throw error; },
      );
    }
    bump(label, started);
    return result;
  };
  Object.defineProperty(target, name, { value: wrapped, writable: true, configurable: true });
}
for (const name of ["lstat", "stat", "open", "realpath", "readdir", "opendir", "rename", "link", "unlink", "mkdir", "rmdir", "rm", "readFile", "writeFile", "appendFile", "chmod", "access", "utimes", "copyFile", "mkdtemp", "readlink", "symlink", "truncate"]) wrap(fs.promises, name, name);
for (const name of ["lstatSync", "statSync", "openSync", "realpathSync", "readdirSync", "renameSync", "linkSync", "unlinkSync", "mkdirSync", "rmSync", "readFileSync", "writeFileSync", "fsyncSync", "fdatasyncSync", "existsSync", "closeSync", "readSync", "writeSync", "fstatSync", "chmodSync", "accessSync"]) wrap(fs, name, name);
const probe = await fs.promises.open(import.meta.filename, "r");
const handlePrototype = Object.getPrototypeOf(probe);
await probe.close();
for (const name of ["stat", "read", "write", "sync", "datasync", "close", "chmod", "truncate", "readFile", "writeFile", "appendFile", "utimes"]) wrap(handlePrototype, name, "handle." + name);
syncBuiltinESMExports();
counters.clear();
let sequence = 0;
process.on("SIGUSR2", () => {
  const directory = process.env.${DUMP_ENVIRONMENT_NAME};
  if (typeof directory !== "string") return;
  sequence += 1;
  const body = JSON.stringify(Object.fromEntries([...counters.entries()].map(([key, value]) => [key, { n: value.n, ms: value.ms }])));
  counters.clear();
  const target = path.join(directory, "dump-" + String(sequence) + ".json");
  fs.writeFileSync(target + ".tmp", body);
  fs.renameSync(target + ".tmp", target);
  counters.clear();
});
`;

function realDirectory(value: string, label: string): string {
  const resolved = path.resolve(value);
  const stat = lstatSync(resolved, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`${label} must be one real directory.`);
  const real = realpathSync(resolved);
  if (real !== resolved) throw new Error(`${label} must be given by its real path.`);
  return real;
}

function count(counters: Readonly<Record<string, unknown>>, key: string): number {
  const entry = counters[key];
  return isRecord(entry) && typeof entry.n === "number" ? entry.n : 0;
}

function milliseconds(counters: Readonly<Record<string, unknown>>, key: string): number {
  const entry = counters[key];
  return isRecord(entry) && typeof entry.ms === "number" ? entry.ms : 0;
}

/** 把预加载脚本的一次计数归成几类；不认识的调用名只进总数。 */
export function summarizeStorageCounters(
  counters: Readonly<Record<string, unknown>>,
): Readonly<StorageCallCounters> {
  const keys = Object.keys(counters);
  const sum = (names: readonly string[]) =>
    names.reduce((total, name) => total + count(counters, name), 0);
  return Object.freeze({
    fileSystemCalls: sum(keys),
    pathChecks: sum(PATH_CHECK_KEYS),
    opens: sum(["open", "openSync"]),
    reads: sum(["handle.read", "handle.readFile", "readFile", "readFileSync", "readSync"]),
    writes: sum(["handle.write", "handle.writeFile", "writeFile", "writeFileSync", "writeSync"]),
    directoryReads: sum(["readdir", "opendir", "readdirSync"]),
    syncs: sum(SYNC_KEYS),
    syncMs: Math.round(SYNC_KEYS.reduce((total, name) => total + milliseconds(counters, name), 0)),
    renames: sum(["rename", "renameSync"]),
    links: sum(["link", "linkSync"]),
    unlinks: sum(["unlink", "unlinkSync"]),
    fileSystemMs: Math.round(keys.reduce((total, name) => total + milliseconds(counters, name), 0)),
  });
}

async function takeDump(
  pid: number,
  directory: string,
  sequence: number,
): Promise<Readonly<Record<string, unknown>>> {
  const file = path.join(directory, `dump-${sequence}.json`);
  process.kill(pid, "SIGUSR2");
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!isRecord(parsed)) throw new Error("Storage counter dump is not an object.");
      return parsed;
    }
    await delay(10);
  }
  throw new Error("The measured server did not write its counters.");
}

export async function measureStorageCalls(
  request: Readonly<StorageMetricsRequest>,
): Promise<Readonly<StorageMetrics>> {
  const candidate = realDirectory(request.candidate, "candidate artifact");
  const workspace = realDirectory(request.workspace, "workspace root");
  if (!TOOL_NAME_PATTERN.test(request.tool))
    throw new Error("Tool name must be one wakeflow_* public tool.");
  if (!Number.isInteger(request.repeat) || request.repeat < 1 || request.repeat > MAXIMUM_REPEAT)
    throw new Error(`Repeat must be an integer from 1 to ${MAXIMUM_REPEAT}.`);
  const artifact = verifyArtifactAgainstManifest(candidate);
  const { hostId, version } = artifact.manifest;
  if ((hostId !== "codex" && hostId !== "claude-code") || typeof version !== "string")
    throw new Error("Candidate artifact identity is unavailable.");

  const scratch = mkdtempSync(path.join(os.tmpdir(), "wakeflow-storage-metrics-"));
  const preload = path.join(scratch, "counter.mjs");
  writeFileSync(preload, COUNTER_PRELOAD, { mode: 0o600 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", preload, path.join(candidate, "mcp/server.mjs")],
    cwd: candidate,
    env: { PATH: process.env.PATH ?? "", [DUMP_ENVIRONMENT_NAME]: scratch },
    stderr: "pipe",
  });
  transport.stderr?.on("data", () => {
    /* Drain; nothing the server prints is copied into the result. */
  });
  const client = new Client({ name: "wakeflow-storage-metrics", version: "1.0.0" });
  const calls: Readonly<StorageMetricsCall>[] = [];
  try {
    await client.connect(transport, { timeout: 60_000 });
    const pid = transport.pid;
    if (pid === null) throw new Error("The measured server has no process id.");
    let dumps = 0;
    for (let round = 0; round < request.repeat; round += 1) {
      dumps += 1;
      await takeDump(pid, scratch, dumps); // 两次调用之间发生的不算在这一次头上
      const started = performance.now();
      const result = await client.callTool(
        { name: request.tool, arguments: { root: workspace, ...request.arguments } },
        { timeout: 120_000 },
      );
      const wallMs = Math.round(performance.now() - started);
      dumps += 1;
      const counters = await takeDump(pid, scratch, dumps);
      calls.push(
        Object.freeze({
          tool: request.tool,
          wallMs,
          toolStatus: result.isError === true ? "failed" : "passed",
          ...summarizeStorageCounters(counters),
        }),
      );
    }
  } finally {
    try {
      await client.close();
    } finally {
      await transport.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return Object.freeze({
    kind: "WakeflowStorageMetrics",
    schemaVersion: 1,
    status: "passed",
    candidate: Object.freeze({ hostId, version, manifestDigest: sha256(artifact.manifestBytes) }),
    calls: Object.freeze(calls),
    runtime: "generated-stdio-new-process",
  });
}
