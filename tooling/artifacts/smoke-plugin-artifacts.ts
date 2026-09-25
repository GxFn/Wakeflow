import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  opendirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { type PluginHostId, pluginDirectoryName } from "./plugin-metadata.js";

/**
 * Wakeflow Tooling / Artifacts：插件制品的冒烟，`npm run smoke:artifacts`（能力卡 10 Q8，gate-log
 * §13.101 F3、D7）。
 *
 * 冒烟把制品搬到仓库之外的临时目录再启动——Node 从那里向上找不到仓库根的 `node_modules/`，
 * 所以只有制品自带的依赖闭包成立时它才跑得起来。五幕加一幕 hook：(1) 经官方 stdio Client 列出的
 * 工具恰好是制品自己的公共目录；(2) 一次性工作区上 fresh-initialize 的 preview 零写、apply
 * `completed`；(3) 刚初始化的工作区 reconcile preview 零步、apply `no-op`，两者零写；(4) 一次观察
 * 下 `wakeflow_status` 有总体状态、`wakeflow_verify` 全部通过；(5) pod create 的 preview `ready`
 * 且零写；(6) `hooks/observe.mjs` 以宿主 SessionStart payload 在该工作区落一条记录。临时树总被
 * 删除，清理失败把成功降为失败。它不替代场景验收：场景验收在仓库内经组合根跑二十个场景，
 * 冒烟只证明"装到别处的这份制品能跑"。
 */

const DEFAULT_ARTIFACTS_ROOT = "plugins";
const MCP_LAUNCHER = "mcp/server.mjs";
const HOOK_OBSERVER_LAUNCHER = "hooks/observe.mjs";
const CATALOG_MODULE = "lib/entrypoints/wakeflow-public-mcp-catalog.js";
const LAYOUT_MODULE = "lib/kernel/layout.js";
const HOOK_OBSERVER_MARKER = "--wakeflow-hook-observer-v1";
const HOOK_OBSERVER_HOST_ARGUMENT = "--host";
const MAINTENANCE_TOOL = "wakeflow_maintain_workspace";
const STATUS_TOOL = "wakeflow_status";
const VERIFY_TOOL = "wakeflow_verify";
const POD_TOOL = "wakeflow_pod";
/** 零写判定忽略的前缀：Git 元数据与维护事务的锁与日志（场景验收用同一份清单）。 */
const SNAPSHOT_SKIPPED_PREFIXES: readonly string[] = Object.freeze([
  ".git",
  ".wakeflow-local/runtime/maintenance",
]);
const SESSION_IDS: Readonly<Record<PluginHostId, string>> = Object.freeze({
  codex: "019924aa-0000-7000-8000-00000000c0de",
  "claude-code": "c1a0de00-1111-4222-8333-444455556666",
});

export interface SmokePluginArtifactsOptions {
  /** 制品所在根（每个宿主一个子目录）；缺省 committed 根 `plugins`。 */
  readonly artifactsRoot?: string;
}

export interface PluginArtifactSmokeActs {
  readonly tools: number;
  readonly freshInitialize: "completed";
  readonly reconcile: "no-op";
  readonly status: string;
  readonly verify: "ok";
  readonly podCreatePreview: "ready";
  readonly hookObserver: "landed";
}

export interface PluginArtifactSmokeRecord {
  readonly hostId: PluginHostId;
  readonly directory: string;
  readonly acts: Readonly<PluginArtifactSmokeActs>;
}

export interface PluginArtifactsSmokeResult {
  readonly kind: "WakeflowPluginArtifactsSmokeResult";
  readonly schemaVersion: 1;
  readonly artifacts: readonly Readonly<PluginArtifactSmokeRecord>[];
}

/** 冒烟任何一幕不成立时返回的稳定工具错误。 */
export class PluginArtifactSmokeError extends Error {
  override readonly name = "PluginArtifactSmokeError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new PluginArtifactSmokeError(code, message);
}

type JsonRecord = Readonly<Record<string, unknown>>;

function isPlainRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 整树快照：相对路径到内容摘要，符号链接与特殊文件即失败；用于"零写"判定。 */
function snapshotTree(root: string): ReadonlyMap<string, string> {
  const snapshot = new Map<string, string>();
  const pending: string[] = [""];
  while (pending.length > 0) {
    const directory = pending.pop() ?? "";
    const entries: Dirent[] = [];
    const handle = opendirSync(path.join(root, directory));
    try {
      for (;;) {
        const entry = handle.readSync();
        if (entry === null) break;
        entries.push(entry);
      }
    } finally {
      handle.closeSync();
    }
    for (const entry of entries) {
      const relative = directory === "" ? entry.name : `${directory}/${entry.name}`;
      if (
        SNAPSHOT_SKIPPED_PREFIXES.some(
          (prefix) => relative === prefix || relative.startsWith(`${prefix}/`),
        )
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        pending.push(relative);
      } else if (entry.isFile()) {
        snapshot.set(relative, sha256(readFileSync(path.join(root, relative))));
      } else {
        fail("wakeflow-smoke-workspace", `workspace contains a special file: ${relative}`);
      }
    }
  }
  return snapshot;
}

function changedPaths(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): readonly string[] {
  const changed = new Set<string>();
  for (const [relative, digest] of before)
    if (after.get(relative) !== digest) changed.add(relative);
  for (const relative of after.keys()) if (!before.has(relative)) changed.add(relative);
  return [...changed].sort(compareCodeUnits);
}

function assertZeroWrite(root: string, before: ReadonlyMap<string, string>, act: string): void {
  const changed = changedPaths(before, snapshotTree(root));
  if (changed.length > 0) {
    fail("wakeflow-smoke-zero-write", `${act} wrote: ${changed.slice(0, 6).join(", ")}`);
  }
}

function git(cwd: string, ...args: readonly string[]): void {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    shell: false,
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error !== undefined || result.status !== 0) {
    fail("wakeflow-smoke-git", `git ${args[0] ?? ""} failed in the disposable fixture`);
  }
}

/** 公共 fresh selection：一个产品仓库、Design 与 Test 两个 Wakeflow 管理的支持面、四个窗口、外部 ledger。 */
function freshSelection(): JsonRecord {
  return {
    program: { displayName: "Smoke Program" },
    presentation: {},
    topology: {
      repositories: [
        {
          selectionKey: "repository-1",
          path: "../ProductA",
          displayName: "Product A",
          instructionManagement: "owner-managed",
        },
      ],
      supportSurfaces: [
        {
          selectionKey: "design",
          capability: "design",
          path: "Design",
          displayName: "Design",
          ownership: "wakeflow-managed",
        },
        {
          selectionKey: "test",
          capability: "test",
          path: "Test",
          displayName: "Test",
          ownership: "wakeflow-managed",
        },
      ],
      windows: [
        {
          selectionKey: "window-1",
          role: "controller",
          displayName: "Controller",
          root: { kind: "program" },
        },
        {
          selectionKey: "window-2",
          role: "design",
          displayName: "Design",
          root: { kind: "support-surface", selectionKey: "design" },
        },
        {
          selectionKey: "window-3",
          role: "test",
          displayName: "Test",
          root: { kind: "support-surface", selectionKey: "test" },
        },
        {
          selectionKey: "window-4",
          role: "product",
          displayName: "Product A",
          root: { kind: "repository", selectionKey: "repository-1" },
        },
      ],
    },
    storage: { ledgerRoot: "../wakeflow-ledger" },
    governance: {},
    hosts: {},
  };
}

interface SmokeFixture {
  readonly base: string;
  readonly artifactRoot: string;
  readonly workspace: string;
}

/** 仓库之外的一次性目录：制品副本、工作区与产品仓库（都 `git init`），ledger 由初始化创建。 */
function createFixture(
  repositoryRoot: string,
  artifactSource: string,
  directory: string,
): SmokeFixture {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-smoke-")));
  if (!path.relative(repositoryRoot, base).startsWith("..")) {
    fail("wakeflow-smoke-fixture", "the disposable directory must lie outside the repository");
  }
  const artifactRoot = path.join(base, directory);
  cpSync(artifactSource, artifactRoot, { recursive: true, errorOnExist: true, force: false });
  const workspace = path.join(base, "WakeWorkspace", "Workspace");
  const product = path.join(base, "WakeWorkspace", "ProductA");
  mkdirSync(workspace, { recursive: true, mode: 0o755 });
  mkdirSync(product, { recursive: true, mode: 0o755 });
  git(workspace, "init", "--quiet");
  git(product, "init", "--quiet");
  return Object.freeze({ base, artifactRoot, workspace });
}

interface Connection {
  readonly client: Client;
  readonly transport: StdioClientTransport;
  readonly stderr: () => string;
  /** 任何工具结果里都不得出现的私有文本：一次性目录的根（工作区、ledger 与产品仓库都在它下面）。 */
  readonly forbidden: readonly string[];
}

async function connect(
  artifactRoot: string,
  hostId: PluginHostId,
  forbidden: readonly string[],
): Promise<Connection> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(artifactRoot, MCP_LAUNCHER)],
    cwd: artifactRoot,
    env: { PATH: process.env.PATH ?? "" },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const client = new Client({ name: `wakeflow-${hostId}-smoke`, version: "1.0.0-smoke" });
  await client.connect(transport);
  return Object.freeze({ client, transport, stderr: () => stderr, forbidden });
}

async function callTool(
  connection: Connection,
  name: string,
  args: JsonRecord,
): Promise<JsonRecord> {
  const result = await connection.client.callTool({ name, arguments: { ...args } });
  if (result.isError === true) {
    const first = result.content[0];
    fail(
      "wakeflow-smoke-tool",
      `${name} failed: ${first?.type === "text" ? first.text : "<no text>"}`,
    );
  }
  if (!isPlainRecord(result.structuredContent)) {
    fail("wakeflow-smoke-tool", `${name} returned no structured content`);
  }
  // 旧实现 T10 的私有路径门：公共结果里出现一次性目录的根就是脱敏边界失守（§13.129）。
  const encoded = JSON.stringify(result.structuredContent);
  for (const text of connection.forbidden) {
    if (encoded.includes(text)) {
      fail("wakeflow-smoke-tool", `${name} returned a private path in its result`);
    }
  }
  return result.structuredContent;
}

async function expectedToolNames(artifactRoot: string): Promise<readonly string[]> {
  const namespace: unknown = await import(
    pathToFileURL(path.join(artifactRoot, CATALOG_MODULE)).href
  );
  const catalog = isPlainRecord(namespace) ? namespace.WAKEFLOW_PUBLIC_TOOL_CATALOG : undefined;
  if (!isPlainRecord(catalog) || !Array.isArray(catalog.tools)) {
    fail("wakeflow-smoke-catalog", "the artifact exposes no public tool catalog");
  }
  return catalog.tools
    .map((tool: unknown) => (isPlainRecord(tool) && typeof tool.name === "string" ? tool.name : ""))
    .sort(compareCodeUnits);
}

async function hookObservationsDirectory(
  artifactRoot: string,
  hostId: PluginHostId,
): Promise<string> {
  const namespace: unknown = await import(
    pathToFileURL(path.join(artifactRoot, LAYOUT_MODULE)).href
  );
  const ref = isPlainRecord(namespace) ? namespace.hostHookObservationsRootRef : undefined;
  if (typeof ref !== "function")
    fail("wakeflow-smoke-catalog", "the artifact exposes no hook layout");
  const value: unknown = ref(hostId);
  if (typeof value !== "string") fail("wakeflow-smoke-catalog", "hook layout returned no path");
  return value;
}

async function actTools(connection: Connection, artifactRoot: string): Promise<number> {
  const listed = (await connection.client.listTools()).tools
    .map((tool) => tool.name)
    .sort(compareCodeUnits);
  const expected = await expectedToolNames(artifactRoot);
  if (listed.length === 0 || listed.join("\n") !== expected.join("\n")) {
    fail("wakeflow-smoke-tools", "listed tools differ from the artifact's own public catalog");
  }
  return listed.length;
}

async function actFreshInitialize(connection: Connection, workspace: string): Promise<"completed"> {
  const selection = freshSelection();
  const before = snapshotTree(workspace);
  const preview = await callTool(connection, MAINTENANCE_TOOL, {
    root: workspace,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection },
  });
  if (preview.status !== "ready" || typeof preview.planDigest !== "string") {
    fail("wakeflow-smoke-fresh", `fresh-initialize preview is ${String(preview.status)}`);
  }
  assertZeroWrite(workspace, before, "fresh-initialize preview");
  const applied = await callTool(connection, MAINTENANCE_TOOL, {
    root: workspace,
    action: "fresh-initialize",
    mode: "apply",
    request: { selection },
    planDigest: preview.planDigest,
  });
  if (applied.status !== "completed") {
    fail("wakeflow-smoke-fresh", `fresh-initialize apply is ${String(applied.status)}`);
  }
  if (
    !existsSync(path.join(workspace, "wakeflow.config.json")) ||
    !existsSync(path.join(workspace, ".wakeflow-active"))
  ) {
    fail("wakeflow-smoke-fresh", "fresh-initialize apply left no config or active root");
  }
  return "completed";
}

async function actReconcile(connection: Connection, workspace: string): Promise<"no-op"> {
  const before = snapshotTree(workspace);
  const preview = await callTool(connection, MAINTENANCE_TOOL, {
    root: workspace,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  const steps =
    isPlainRecord(preview.plan) && Array.isArray(preview.plan.steps) ? preview.plan.steps : [];
  if (preview.status !== "ready" || steps.length !== 0) {
    fail(
      "wakeflow-smoke-reconcile",
      `reconcile preview is ${String(preview.status)} with ${steps.length} steps`,
    );
  }
  assertZeroWrite(workspace, before, "reconcile preview");
  const applied = await callTool(connection, MAINTENANCE_TOOL, {
    root: workspace,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: preview.planDigest,
  });
  if (applied.status !== "no-op" || applied.operationId !== null) {
    fail("wakeflow-smoke-reconcile", `reconcile apply is ${String(applied.status)}`);
  }
  assertZeroWrite(workspace, before, "reconcile apply");
  return "no-op";
}

async function actObserve(
  connection: Connection,
  workspace: string,
): Promise<{ status: string; verify: "ok" }> {
  const status = await callTool(connection, STATUS_TOOL, { root: workspace });
  if (typeof status.overall !== "string" || status.overall.length === 0) {
    fail("wakeflow-smoke-status", "status reports no overall state");
  }
  const verify = await callTool(connection, VERIFY_TOOL, { root: workspace });
  const summary = isPlainRecord(verify.summary) ? verify.summary : {};
  if (verify.ok !== true || summary.fail !== 0 || summary.unavailable !== 0) {
    fail("wakeflow-smoke-verify", `verify is not ok: ${JSON.stringify(summary)}`);
  }
  return { status: status.overall, verify: "ok" };
}

async function actPodCreatePreview(connection: Connection, workspace: string): Promise<"ready"> {
  const before = snapshotTree(workspace);
  const preview = await callTool(connection, POD_TOOL, {
    root: workspace,
    mode: "preview",
    intent: { kind: "create", name: "smoke-pod", idempotencyKey: "smoke-pod-1" },
  });
  const plan = isPlainRecord(preview.plan) ? preview.plan : {};
  if (preview.status !== "ready" || plan.kind !== "create") {
    fail("wakeflow-smoke-pod", `pod create preview is ${String(preview.status)}`);
  }
  assertZeroWrite(workspace, before, "pod create preview");
  return "ready";
}

async function actHookObserver(
  artifactRoot: string,
  hostId: PluginHostId,
  workspace: string,
): Promise<"landed"> {
  const directory = path.join(
    workspace,
    ...(await hookObservationsDirectory(artifactRoot, hostId)).split("/"),
  );
  const payload = JSON.stringify({
    session_id: SESSION_IDS[hostId],
    cwd: workspace,
    transcript_path: path.join(workspace, "transcript.jsonl"),
    hook_event_name: "SessionStart",
  });
  const result = spawnSync(
    process.execPath,
    [
      path.join(artifactRoot, HOOK_OBSERVER_LAUNCHER),
      HOOK_OBSERVER_MARKER,
      HOOK_OBSERVER_HOST_ARGUMENT,
      hostId,
    ],
    {
      cwd: workspace,
      input: payload,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
      shell: false,
      windowsHide: true,
      timeout: 20_000,
    },
  );
  if (
    result.error !== undefined ||
    result.status !== 0 ||
    result.stdout !== "" ||
    result.stderr !== ""
  ) {
    fail("wakeflow-smoke-hook", "hook observer did not exit 0 with empty stdout and stderr");
  }
  const records = existsSync(directory)
    ? readdirSync(directory).filter((name) => name.endsWith(".json"))
    : [];
  if (records.length !== 1)
    fail("wakeflow-smoke-hook", `hook observer landed ${records.length} records`);
  return "landed";
}

async function smokeArtifact(
  repositoryRoot: string,
  artifactSource: string,
  hostId: PluginHostId,
): Promise<Readonly<PluginArtifactSmokeRecord>> {
  const directory = pluginDirectoryName(hostId);
  const stat = lstatSync(artifactSource, { throwIfNoEntry: false });
  if (stat === undefined || stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-smoke-artifact", `${directory} is not one real artifact directory`);
  }
  const fixture = createFixture(repositoryRoot, artifactSource, directory);
  let acts: Readonly<PluginArtifactSmokeActs>;
  try {
    const connection = await connect(fixture.artifactRoot, hostId, [fixture.base]);
    try {
      const tools = await actTools(connection, fixture.artifactRoot);
      const freshInitialize = await actFreshInitialize(connection, fixture.workspace);
      const reconcile = await actReconcile(connection, fixture.workspace);
      const observed = await actObserve(connection, fixture.workspace);
      const podCreatePreview = await actPodCreatePreview(connection, fixture.workspace);
      const hookObserver = await actHookObserver(fixture.artifactRoot, hostId, fixture.workspace);
      acts = Object.freeze({
        tools,
        freshInitialize,
        reconcile,
        status: observed.status,
        verify: observed.verify,
        podCreatePreview,
        hookObserver,
      });
    } finally {
      await Promise.allSettled([connection.client.close(), connection.transport.close()]);
    }
    if (connection.stderr() !== "") {
      fail("wakeflow-smoke-stderr", "the MCP server wrote to stderr during the smoke");
    }
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
    if (existsSync(fixture.base))
      fail("wakeflow-smoke-cleanup", "the disposable directory survived cleanup");
  }
  return Object.freeze({ hostId, directory, acts });
}

export async function smokeWakeflowPluginArtifacts(
  repositoryRootInput: string,
  options: Readonly<SmokePluginArtifactsOptions> = {},
): Promise<Readonly<PluginArtifactsSmokeResult>> {
  const repositoryRoot = path.resolve(repositoryRootInput);
  const artifactsRoot = path.resolve(
    repositoryRoot,
    options.artifactsRoot ?? DEFAULT_ARTIFACTS_ROOT,
  );
  const artifacts: Readonly<PluginArtifactSmokeRecord>[] = [];
  for (const hostId of ["codex", "claude-code"] as const) {
    artifacts.push(
      await smokeArtifact(
        repositoryRoot,
        path.join(artifactsRoot, pluginDirectoryName(hostId)),
        hostId,
      ),
    );
  }
  return Object.freeze({
    kind: "WakeflowPluginArtifactsSmokeResult",
    schemaVersion: 1,
    artifacts: Object.freeze(artifacts),
  });
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && path.resolve(invoked) === fileURLToPath(import.meta.url);
}

async function runAsMain(): Promise<void> {
  try {
    const result = await smokeWakeflowPluginArtifacts(process.cwd());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write("wakeflow-smoke-unexpected: plugin artifact smoke failed\n");
    }
    process.exitCode = 1;
  }
}

if (isMainModule()) await runAsMain();
