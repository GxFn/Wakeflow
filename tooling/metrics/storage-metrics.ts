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
 * Wakeflow Tooling / Storage metrics：一次公共工具调用让服务进程调用了多少次 `node:fs` 的接口（ADR-0032）。
 *
 * 对一份制品副本起一个新的 stdio 进程，进程里预加载一段计数脚本：它包住 `node:fs` 的 Promise 接口、
 * 同步接口、文件句柄与目录句柄的方法，记下每一种调用的次数与耗时。每调用一次工具取一次计数并清零。结果只有计数与
 * 毫秒，没有路径与内容。和 `mcp call` 一样调用的是新进程；变更类工具会真的改工作区，只对可丢弃工作区使用。
 *
 * 数的是接口调用，不是系统调用：Node 替调用方在内部做的不单独计数（`readFile(path)` 自己的打开与关闭、递归 `rm`
 * 里的逐项删除都只算这一次）；一个包住的调用在另一个包住的调用里同步发生时只记外层一次（`Dir.close` 经 promisify
 * 再调自己、`readFileSync` 调 `openSync`）；`Dir.read` 多数从 Node 的目录项缓冲里取。例外是 `for await` 遍历目录：
 * 遍历结束时迭代器经构造时取下的、已被包住的 `close` 关闭目录，所以一次遍历记 `dir.entries` 与 `dir.close` 各一次。
 * 预加载脚本列出的名字有一个不是函数时进程起不来，不会静默地少数一类；工具抛出的错误带上预加载脚本自己那一行
 * 报错（只有方法名，没有路径）。
 *
 * 只数这一个服务进程：hook 观察器进程与发布到工作区的脚本不在内。被量的服务以制品目录为工作目录启动，而
 * Controller 窗口里的服务以工作区根启动；`root` 与工作目录不同时调用方角色检查要读一次配置，所以每次被量的调用
 * 比 Controller 窗口里的同一调用多这一次配置读取。耗时是各次调用耗时之和，调用并行时会超过墙钟——用来比较
 * 前后，不当作墙钟的分解。
 */

export interface StorageCallCounters {
  readonly fileSystemCalls: number;
  /** lstat 与 realpath：逐段核对路径的那一部分。 */
  readonly pathChecks: number;
  readonly opens: number;
  readonly reads: number;
  readonly writes: number;
  /** 列目录：`opendir` 与 `readdir` 的调用次数。 */
  readonly directoryReads: number;
  /**
   * 目录句柄上的逐项读取：每次 `Dir.read` 记一次，用它把一个目录列举到底是项数加一（一个目录被列举两次就是两倍）；
   * `for await` 遍历整个目录在这里只记一次（`dir.entries`），遍历结束时迭代器自己的 `dir.close` 另记一次，只进
   * 总数。多数 `Dir.read` 由 Node 的缓冲供给，不是一次系统调用。
   */
  readonly directoryEntryReads: number;
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
/** 被量的进程从这个环境变量读转储目录。 */
export const STORAGE_COUNTER_DUMP_VARIABLE = "WAKEFLOW_STORAGE_METRICS_DIR";
/** 服务进程起不来时在 stderr 尾部找预加载脚本的报错行；只留这么多字符。 */
const STDERR_TAIL_CHARACTERS = 65_536;
const PRELOAD_FAILURE_LINE = /^Error: (Storage metrics preload: [\w.]+ is not a function\.)$/gmu;
const PATH_CHECK_KEYS = ["lstat", "realpath", "lstatSync", "realpathSync"] as const;
const SYNC_KEYS = ["handle.sync", "handle.datasync", "fsyncSync", "fdatasyncSync"] as const;

/**
 * 预加载脚本：只统计，不改变任何调用的行为；收到 SIGUSR2 把计数写成一个文件并清零。列出的名字有一个不是函数
 * 就在启动时抛错，进程起不来。FileHandle 的 `close` 是每个实例自己的属性（类字段），原型上没有，所以包住
 * `open` 交出的每个句柄。
 */
const COUNTER_PRELOAD = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
const counters = new Map();
let depth = 0;
function bump(label, started) {
  const entry = counters.get(label) ?? { n: 0, ms: 0 };
  entry.n += 1;
  entry.ms += performance.now() - started;
  counters.set(label, entry);
}
function wrap(target, name, label, adopt) {
  const original = target[name];
  if (typeof original !== "function") throw new Error("Storage metrics preload: " + label + " is not a function.");
  const wrapped = function (...args) {
    if (depth > 0) return original.apply(this, args);
    const started = performance.now();
    let result;
    depth += 1;
    try {
      result = original.apply(this, args);
    } catch (error) {
      bump(label, started);
      throw error;
    } finally {
      depth -= 1;
    }
    if (result !== null && typeof result === "object" && typeof result.then === "function") {
      return result.then(
        (value) => { bump(label, started); if (adopt !== undefined) adopt(value); return value; },
        (error) => { bump(label, started); throw error; },
      );
    }
    bump(label, started);
    return result;
  };
  Object.defineProperty(target, name, { value: wrapped, writable: true, configurable: true });
}
const countHandleClose = (handle) => wrap(handle, "close", "handle.close");
for (const name of ["lstat", "stat", "realpath", "readdir", "opendir", "rename", "link", "unlink", "mkdir", "rmdir", "rm", "readFile", "writeFile", "appendFile", "chmod", "access", "utimes", "copyFile", "mkdtemp", "readlink", "symlink", "truncate"]) wrap(fs.promises, name, name);
wrap(fs.promises, "open", "open", countHandleClose);
for (const name of ["lstatSync", "statSync", "openSync", "realpathSync", "readdirSync", "renameSync", "linkSync", "unlinkSync", "mkdirSync", "rmSync", "readFileSync", "writeFileSync", "fsyncSync", "fdatasyncSync", "existsSync", "closeSync", "readSync", "writeSync", "fstatSync", "chmodSync", "accessSync"]) wrap(fs, name, name);
const probe = await fs.promises.open(import.meta.filename, "r");
const handlePrototype = Object.getPrototypeOf(probe);
await probe.close();
for (const name of ["stat", "read", "write", "sync", "datasync", "chmod", "truncate", "readFile", "writeFile", "appendFile", "utimes"]) wrap(handlePrototype, name, "handle." + name);
const directoryProbe = await fs.promises.opendir(path.dirname(import.meta.filename));
const directoryPrototype = Object.getPrototypeOf(directoryProbe);
await directoryProbe.close();
for (const name of ["read", "readSync", "close", "closeSync", "entries"]) wrap(directoryPrototype, name, "dir." + name);
wrap(directoryPrototype, Symbol.asyncIterator, "dir.entries");
syncBuiltinESMExports();
counters.clear();
let sequence = 0;
process.on("SIGUSR2", () => {
  const directory = process.env.${STORAGE_COUNTER_DUMP_VARIABLE};
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

/** 把预加载脚本写进一个一次性目录，返回它的路径；被量的进程用 `--import` 加载它。 */
export function writeStorageCounterPreload(directory: string): string {
  const preload = path.join(directory, "counter.mjs");
  writeFileSync(preload, COUNTER_PRELOAD, { mode: 0o600 });
  return preload;
}

/** stderr 里预加载脚本自己的最后一条报错（去掉 `Error: `）；这一行只有方法名，没有路径。没有为 undefined。 */
export function preloadFailureLine(stderr: string): string | undefined {
  return [...stderr.matchAll(PRELOAD_FAILURE_LINE)].at(-1)?.[1];
}

/**
 * 连接被量的服务。连不上、而它的 stderr 尾部有预加载脚本的报错行时，把那一行写进错误（原错误留作
 * `cause`）：否则调用方只看到"连接已关闭"，不知道是计数脚本列的方法在这版 Node 里不存在。
 */
export async function connectReportingPreloadFailure(
  connect: () => Promise<void>,
  stderrTail: () => string,
): Promise<void> {
  try {
    await connect();
  } catch (error: unknown) {
    const failure = preloadFailureLine(stderrTail());
    if (failure === undefined) throw error;
    throw new Error(`The measured server did not start: ${failure}`, { cause: error });
  }
}

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
    directoryEntryReads: sum(["dir.read", "dir.readSync", "dir.entries"]),
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
  const preload = writeStorageCounterPreload(scratch);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", preload, path.join(candidate, "mcp/server.mjs")],
    cwd: candidate,
    env: { PATH: process.env.PATH ?? "", [STORAGE_COUNTER_DUMP_VARIABLE]: scratch },
    stderr: "pipe",
  });
  // 读空 stderr，只留尾部给起不来时找预加载脚本的报错行；服务打印的内容不进结果。
  let stderrTail = "";
  transport.stderr?.on("data", (chunk: unknown) => {
    stderrTail = (stderrTail + String(chunk)).slice(-STDERR_TAIL_CHARACTERS);
  });
  const client = new Client({ name: "wakeflow-storage-metrics", version: "1.0.0" });
  const calls: Readonly<StorageMetricsCall>[] = [];
  try {
    await connectReportingPreloadFailure(
      () => client.connect(transport, { timeout: 60_000 }),
      () => stderrTail,
    );
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
