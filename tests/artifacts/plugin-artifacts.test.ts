import { createHash } from "node:crypto";
import { deepEqual, doesNotMatch, equal, match, ok, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  opendirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import {
  assertRenderedHookFragmentDigest,
  assertSharedClosure,
  buildWakeflowPluginArtifacts,
  type CandidateHostIsolationRule,
} from "../../tooling/artifacts/build-plugin-artifacts.js";
import { resolveRuntimeDependencyClosure } from "../../tooling/artifacts/plugin-dependency-closure.js";
import { pluginManifestPath, readReleaseVersion } from "../../tooling/artifacts/plugin-metadata.js";
import { WAKEFLOW_PUBLIC_TOOL_CATALOG } from "../../src/entrypoints/wakeflow-public-mcp-catalog.js";
import { renderWakeflowConfig } from "../../src/configuration/wakeflow-config-document.js";
import {
  WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT,
  WAKEFLOW_HOOK_OBSERVER_MARKER,
} from "../../src/entrypoints/wakeflow-hook-observer.js";
import {
  CLAUDE_CODE_HOOK_FRAGMENT_DIGEST,
  renderClaudeCodeHooksJson,
} from "../../src/hosts/claude-code/claude-code-hook-fragment.js";
import {
  CODEX_HOOK_FRAGMENT_DIGEST,
  renderCodexHooksJson,
} from "../../src/hosts/codex/codex-hook-fragment.js";
import { hostHookObservationsRootRef } from "../../src/kernel/layout.js";
import { createMinimalWakeflowConfig } from "../configuration/wakeflow-config.fixture.js";

const OUTPUT_RELATIVE = ".build/test-artifacts/plugin-artifacts";
const HOOK_OBSERVER_LAUNCHER = "hooks/observe.mjs";
const HOOKS_JSON = "hooks/hooks.json";
const MCP_LAUNCHER = "mcp/server.mjs";
const SESSION_IDS = Object.freeze({
  codex: "019924aa-0000-7000-8000-00000000c0de",
  "claude-code": "c1a0de00-1111-4222-8333-444455556666",
});
const RECORD_FILE_PATTERN =
  /^\d{8}T\d{9}Z-session-start-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/u;
/** 闭包范围：只有 `lib/` 下的编译文件才带这三个值之一。 */
const CLOSURE_SCOPES: readonly string[] = ["shared", "current-host", "peer-profile"];
/** `lib/` 之外的文件：两个 launcher、宿主配置与元数据、出厂文本、许可证、品牌资产、运行时依赖。 */
const GENERATED_SCOPES: readonly string[] = [
  "entrypoint",
  "metadata",
  "agent-text",
  "license",
  "brand",
  "dependency",
];
const FIXED_CODE_PREFIX = "wakeflow-hook-observer: ";
/**
 * 运行时依赖闭包：直接包加它们在锁文件里的传递依赖（§13.101 现状盘点实测）。`jsonc-parser`
 * 只被 Claude 的可移植设置模块引用，所以只进 Claude 制品——闭包按真实 import 求得，不按根
 * `package.json` 照抄。
 */
function expectedDependencyPackages(hostId: "codex" | "claude-code"): readonly string[] {
  return [
    "@modelcontextprotocol/core",
    "@modelcontextprotocol/server",
    "ajv",
    "canonicalize",
    "fast-deep-equal",
    "fast-uri",
    "json-schema-traverse",
    ...(hostId === "claude-code" ? ["jsonc-parser"] : []),
    "p-limit",
    "require-from-string",
    "yocto-queue",
    "zod",
  ];
}

/** 手搭的隔离规则：守卫只看这四项，测试因此不必复制候选定义的其余部分。 */
const CODEX_ISOLATION_RULE: Readonly<CandidateHostIsolationRule> = Object.freeze({
  hostId: "codex",
  currentHostDirectory: "hosts/codex/",
  peerHostDirectory: "hosts/claude-code/",
  admittedPeerModules: Object.freeze([
    "hosts/claude-code/wakeflow-workspace-host-resource-profile.js",
  ]),
});

/** 稳定工具错误：只暴露 name 与 code，测试按 code 断言而不按消息。 */
function expectErrorCode(name: string, code: string): (error: unknown) => true {
  return (error: unknown): true => {
    ok(error instanceof Error, "抛出的必须是 Error");
    equal(error.name, name);
    equal((error as { readonly code?: unknown }).code, code);
    return true;
  };
}

const expectArtifactErrorCode = (code: string) => expectErrorCode("PluginArtifactBuildError", code);
const expectClosureErrorCode = (code: string) =>
  expectErrorCode("PluginDependencyClosureError", code);

/** stderr 里固定代码形式的行；其余行（例如 Node 默认处理器的堆栈）不计入。 */
function fixedCodeLines(stderr: string): readonly string[] {
  return stderr.split("\n").filter((line) => line.startsWith(FIXED_CODE_PREFIX));
}

interface ManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly mode: "0644" | "0755";
  readonly scope: string;
}

/** 清单里出厂文本面的独立索引条目（§13.99 D9）。 */
interface ManifestAgentTextFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface ManifestRuntimeEntrypoint {
  readonly kind: "mcp" | "hook-observer";
  readonly runtimeEntrypoint: string;
  readonly sourceEntrypoint: string;
}

interface ManifestDependency {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly dependencies: readonly string[];
}

interface PluginManifest {
  readonly kind: "WakeflowPluginArtifactManifest";
  readonly schemaVersion: 1;
  readonly hostId: "codex" | "claude-code";
  readonly pluginName: string;
  readonly packageName: string;
  readonly version: string;
  readonly releaseEligible: boolean;
  readonly generator: string;
  readonly sourceEntrypoint: string;
  readonly runtimeEntrypoint: string;
  readonly runtimeEntrypoints: readonly ManifestRuntimeEntrypoint[];
  readonly externalPackages: readonly string[];
  readonly dependencies: readonly ManifestDependency[];
  readonly agentText: readonly ManifestAgentTextFile[];
  readonly files: readonly ManifestFile[];
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseJsonFile<Value>(file: string): Value {
  return JSON.parse(readFileSync(file, "utf8")) as Value;
}

function collectFiles(root: string): readonly string[] {
  const result: string[] = [];
  function visit(directory: string): void {
    const entries: Dirent[] = [];
    const handle = opendirSync(directory);
    try {
      while (true) {
        const entry = handle.readSync();
        if (entry === null) break;
        entries.push(entry);
      }
    } finally {
      handle.closeSync();
    }
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Plugin artifact cannot contain symbolic links.");
      }
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        result.push(path.relative(root, absolute).split(path.sep).join("/"));
      }
    }
  }
  visit(root);
  return Object.freeze(result.sort());
}

function digest(file: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
}

function outputFixture(t: TestContext): string {
  const repositoryRoot = process.cwd();
  const output = path.join(repositoryRoot, OUTPUT_RELATIVE);
  t.after(() => {
    const stat = lstatSync(output, { throwIfNoEntry: false });
    if (stat !== undefined && !stat.isSymbolicLink() && stat.isDirectory()) {
      rmSync(output, { recursive: true, force: false });
    }
  });
  return output;
}

async function buildCandidates() {
  return buildWakeflowPluginArtifacts(process.cwd(), { outputRoot: OUTPUT_RELATIVE });
}

/** 手搭的最小工作区：配置由渲染器写出，两个支持面目录存在；仓库 `../ProductA` 缺席不影响根匹配。 */
function workspaceFixture(t: TestContext): string {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-artifact-hook-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspace = path.join(base, "Wakeflow");
  mkdirSync(path.join(workspace, "Design"), { recursive: true });
  mkdirSync(path.join(workspace, "Test"), { recursive: true });
  writeFileSync(
    path.join(workspace, "wakeflow.config.json"),
    renderWakeflowConfig(createMinimalWakeflowConfig()),
    { mode: 0o644 },
  );
  return workspace;
}

function observationsDirectory(workspace: string, hostId: "codex" | "claude-code"): string {
  return path.join(workspace, ...hostHookObservationsRootRef(hostId).split("/"));
}

interface SpawnedObserver {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** 以宿主 hook 的方式启动制品 launcher：固定 argv、payload 走 stdin、不继承本进程的 hook 环境。 */
function spawnHookObserver(
  launcher: string,
  hostId: "codex" | "claude-code",
  workspace: string,
): SpawnedObserver {
  const payload = JSON.stringify({
    session_id: SESSION_IDS[hostId],
    cwd: workspace,
    transcript_path: path.join(workspace, "transcript.jsonl"),
    hook_event_name: "SessionStart",
  });
  const result = spawnSync(
    process.execPath,
    [launcher, WAKEFLOW_HOOK_OBSERVER_MARKER, WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT, hostId],
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
  if (result.error !== undefined) throw result.error;
  return Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

/**
 * 把制品的 launcher 原样搬进一个临时根，并在它期望的位置放一个"求值即抛出、但先排下一次
 * 稍后故障"的假入口：launcher 会先走 catch 打出 `launcher`，随后那次故障才发生。守卫仍在位
 * 时它会打出第二行 `internal`；守卫已卸下时它落回 Node 默认处理器，不可能再打出固定代码行。
 * 真实制品的这条路径（模块缺失）之后没有任何待办，所以这个假入口只是把第二次故障做成可观察的。
 */
function launcherWithLateFaultFixture(t: TestContext, launcher: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-artifact-guard-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "hooks"), { recursive: true });
  mkdirSync(path.join(root, "lib", "entrypoints"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), '{ "type": "module" }\n', { mode: 0o644 });
  writeFileSync(path.join(root, "hooks", "observe.mjs"), readFileSync(launcher), { mode: 0o755 });
  writeFileSync(
    path.join(root, "lib", "entrypoints", "wakeflow-hook-observer.js"),
    [
      "setTimeout(() => {",
      '  throw new Error("late fault");',
      "}, 25);",
      'throw new Error("module evaluation failed");',
      "",
    ].join("\n"),
    { mode: 0o644 },
  );
  return path.join(root, "hooks", "observe.mjs");
}

/** 制品在仓库之外的一份副本：Node 从这里向上找不到仓库根的 `node_modules/`，闭包必须自足。 */
function outsideRepositoryCopy(t: TestContext, artifactRoot: string): string {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-artifact-install-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const copy = path.join(base, path.basename(artifactRoot));
  cpSync(artifactRoot, copy, { recursive: true, errorOnExist: true, force: false });
  equal(path.relative(process.cwd(), copy).startsWith(".."), true, "副本必须在仓库之外");
  return copy;
}

test("双宿主插件制品由确定性的闭合文件清单生成：编译闭包、两个 launcher、宿主配置、元数据、出厂文本、许可证、品牌资产与运行时依赖闭包", async (t) => {
  const output = outputFixture(t);
  const first = await buildCandidates();
  const second = await buildCandidates();
  // 两次构建字节相同——清单记录每个文件的 sha256，清单摘要相等即全部文件字节相等（D6）。
  deepEqual(second, first);
  const release = readReleaseVersion(process.cwd());
  equal(first.version, release.version);
  equal(first.releaseEligible, true);
  equal(first.artifacts.length, 2);
  const rootLicense = readFileSync(path.join(process.cwd(), "LICENSE"));

  for (const artifact of first.artifacts) {
    const artifactRoot = path.join(output, artifact.outputDirectory);
    const manifestPath = path.join(artifactRoot, "artifact-manifest.json");
    const manifest = parseJsonFile<PluginManifest>(manifestPath);
    equal(manifest.kind, "WakeflowPluginArtifactManifest");
    equal(manifest.schemaVersion, 1);
    equal(manifest.releaseEligible, true);
    equal(manifest.version, release.version);
    equal(manifest.pluginName, "wakeflow");
    equal(manifest.packageName, artifact.hostId === "codex" ? "wakeflow" : "claude-code-wakeflow");
    equal(manifest.hostId, artifact.hostId);
    equal(manifest.generator, "tooling/artifacts/build-plugin-artifacts.ts");
    equal(digest(manifestPath), artifact.manifestDigest);
    deepEqual(manifest.externalPackages, artifact.externalPackages);
    equal(manifest.dependencies.length, artifact.dependencyPackageCount);

    const expectedFiles = [
      ...manifest.files.map((file) => file.path),
      "artifact-manifest.json",
    ].sort();
    deepEqual(collectFiles(artifactRoot), expectedFiles);
    for (const file of manifest.files) {
      const absolute = path.join(artifactRoot, file.path);
      equal(readFileSync(absolute).byteLength, file.bytes);
      equal(digest(absolute), file.sha256);
      equal(lstatSync(absolute).mode & 0o777, file.mode === "0755" ? 0o755 : 0o644);
      equal(/\.(?:ts|cts|mts|map)$/u.test(file.path), false, file.path);
    }
    const byPath = new Map(manifest.files.map((file) => [file.path, file]));

    // 元数据（D3、D4）：`package.json` 不再是 private 的骨干候选，版本来自唯一输入，运行时依赖
    // 按锁文件精确版本声明；插件清单在宿主各自的位置，名字沿用 `wakeflow`。
    const packageDocument = parseJsonFile<{
      readonly name: string;
      readonly version: string;
      readonly private?: boolean;
      readonly engines: { readonly node: string };
      readonly dependencies: Readonly<Record<string, string>>;
    }>(path.join(artifactRoot, "package.json"));
    equal(packageDocument.private, undefined);
    equal(packageDocument.name, manifest.packageName);
    equal(packageDocument.version, release.version);
    equal(packageDocument.engines.node, ">=24.19.0 <25");
    deepEqual(
      Object.keys(packageDocument.dependencies).sort(),
      [...manifest.externalPackages].sort(),
    );
    equal(packageDocument.dependencies["@modelcontextprotocol/server"], "2.0.0");
    const manifestFile = pluginManifestPath(artifact.hostId);
    equal(byPath.get(manifestFile)?.scope, "metadata");
    const pluginManifest = parseJsonFile<{
      readonly name: string;
      readonly version: string;
      readonly mcpServers: string;
      readonly skills?: string;
      readonly interface?: { readonly defaultPrompt: readonly string[] };
    }>(path.join(artifactRoot, manifestFile));
    equal(pluginManifest.name, "wakeflow");
    equal(pluginManifest.version, release.version);
    equal(pluginManifest.mcpServers, "./.mcp.json");
    if (artifact.hostId === "codex") {
      equal(pluginManifest.skills, "./skills/");
      equal(pluginManifest.interface?.defaultPrompt.length, 3);
      ok(pluginManifest.interface?.defaultPrompt.every((prompt) => prompt.length <= 128));
    } else {
      equal(pluginManifest.skills, undefined);
      equal(pluginManifest.interface, undefined);
    }

    // 静态资产：LICENSE 与根文件逐字节相同，品牌 SVG 来自 `assets/brand/`。
    equal(byPath.get("LICENSE")?.scope, "license");
    ok(readFileSync(path.join(artifactRoot, "LICENSE")).equals(rootLicense));
    for (const name of ["wakeflow-logo.svg", "wakeflow-mark.svg"]) {
      equal(byPath.get(`assets/${name}`)?.scope, "brand", name);
      ok(
        readFileSync(path.join(artifactRoot, "assets", name)).equals(
          readFileSync(path.join(process.cwd(), "assets", "brand", name)),
        ),
        name,
      );
    }

    // D5：运行时依赖闭包随制品发出。闭包是闭合的（每个包声明的依赖都在闭包里），每个包的
    // `package.json` 在制品里且版本等于清单版本，完整性值来自锁文件；类型、source map 与
    // Markdown 不进制品。
    deepEqual(
      manifest.dependencies.map((entry) => entry.name),
      expectedDependencyPackages(artifact.hostId),
    );
    const dependencyNames = new Set(manifest.dependencies.map((entry) => entry.name));
    for (const entry of manifest.dependencies) {
      match(entry.integrity, /^sha512-/u);
      for (const dependency of entry.dependencies) ok(dependencyNames.has(dependency), dependency);
      const vendoredPackage = byPath.get(`node_modules/${entry.name}/package.json`);
      equal(vendoredPackage?.scope, "dependency", entry.name);
      equal(
        parseJsonFile<{ readonly version: string }>(
          path.join(artifactRoot, "node_modules", entry.name, "package.json"),
        ).version,
        entry.version,
        entry.name,
      );
    }
    for (const name of manifest.externalPackages) ok(dependencyNames.has(name), name);
    for (const file of manifest.files) {
      if (!file.path.startsWith("node_modules/")) continue;
      equal(file.scope, "dependency", file.path);
      equal(file.mode, "0644", file.path);
      doesNotMatch(file.path, /\.(?:md|markdown)$/u);
      equal(/\/\.[^/]+$/u.test(file.path), false, file.path);
    }

    // D8：清单的 runtimeEntrypoint 仍指向 MCP，runtimeEntrypoints[] 列出两个 launcher（MCP 在前）。
    const mcpSource =
      artifact.hostId === "codex"
        ? "src/entrypoints/codex-wakeflow-mcp.ts"
        : "src/entrypoints/claude-code-wakeflow-mcp.ts";
    equal(manifest.runtimeEntrypoint, MCP_LAUNCHER);
    equal(manifest.sourceEntrypoint, mcpSource);
    deepEqual(manifest.runtimeEntrypoints, [
      { kind: "mcp", runtimeEntrypoint: MCP_LAUNCHER, sourceEntrypoint: mcpSource },
      {
        kind: "hook-observer",
        runtimeEntrypoint: HOOK_OBSERVER_LAUNCHER,
        sourceEntrypoint: "src/entrypoints/wakeflow-hook-observer.ts",
      },
    ]);
    // MCP launcher 把发布版本交给组合根。
    ok(
      readFileSync(path.join(artifactRoot, MCP_LAUNCHER), "utf8").includes(
        `(${JSON.stringify(release.version)});`,
      ),
    );

    // D8：两个 hooks 文件在文件集合里，模式与范围固定；观察脚本的闭包根随并集进了 lib/。
    equal(byPath.get(MCP_LAUNCHER)?.mode, "0755");
    equal(byPath.get(MCP_LAUNCHER)?.scope, "entrypoint");
    equal(byPath.get(HOOK_OBSERVER_LAUNCHER)?.mode, "0755");
    equal(byPath.get(HOOK_OBSERVER_LAUNCHER)?.scope, "entrypoint");
    equal(byPath.get(HOOKS_JSON)?.mode, "0644");
    equal(byPath.get(HOOKS_JSON)?.scope, "metadata");
    equal(byPath.get("lib/entrypoints/wakeflow-hook-observer.js")?.scope, "shared");

    // 范围陈述文件在制品里的层次：`lib/` 下的编译文件带闭包范围，其余是生成文件、静态资产
    // 与依赖；两个 launcher 都是 `entrypoint`，所以按范围选 launcher 的消费者两个都看得见（D8）。
    for (const file of manifest.files) {
      const compiled = file.path.startsWith("lib/");
      equal(CLOSURE_SCOPES.includes(file.scope), compiled, file.path);
      if (!compiled) ok(GENERATED_SCOPES.includes(file.scope), file.path);
    }
    deepEqual(
      manifest.files
        .filter((file) => file.scope === "entrypoint")
        .map((file) => file.path)
        .sort(),
      [...manifest.runtimeEntrypoints.map((entry) => entry.runtimeEntrypoint)].sort(),
    );
    // 片段模块只在构建时动态 import，不进任何闭包（D8）。
    equal(byPath.has("lib/hosts/codex/codex-hook-fragment.js"), false);
    equal(byPath.has("lib/hosts/claude-code/claude-code-hook-fragment.js"), false);

    // D6：hooks.json 的字节就是该宿主片段模块渲染函数的输出，且等于片段自己导出的摘要——
    // 构建器在写出前核对了这一点，清单里的 sha256 是同一事实的第三方记录。
    equal(
      readFileSync(path.join(artifactRoot, HOOKS_JSON), "utf8"),
      artifact.hostId === "codex" ? renderCodexHooksJson() : renderClaudeCodeHooksJson(),
    );
    equal(
      byPath.get(HOOKS_JSON)?.sha256,
      artifact.hostId === "codex" ? CODEX_HOOK_FRAGMENT_DIGEST : CLAUDE_CODE_HOOK_FRAGMENT_DIGEST,
    );

    // D1：launcher 用动态 import 加 try/catch，登记两个进程守卫；不含静态 import。
    const launcherText = readFileSync(path.join(artifactRoot, HOOK_OBSERVER_LAUNCHER), "utf8");
    ok(launcherText.startsWith("#!/usr/bin/env node\n"));
    ok(launcherText.includes('await import("../lib/entrypoints/wakeflow-hook-observer.js")'));
    ok(launcherText.includes('"uncaughtException"'));
    ok(launcherText.includes('"unhandledRejection"'));
    doesNotMatch(launcherText, /^import\s/mu);
    doesNotMatch(launcherText, /^export\s/mu);

    // 对端宿主目录只准入两份纯数据 profile（资源与窗口宿主身份）；状态栏资产、维护与
    // 设置等对端执行内容不得进入本宿主闭包（§13.94 D1 与制品隔离规则）。
    const peerDirectory =
      artifact.hostId === "codex" ? "lib/hosts/claude-code/" : "lib/hosts/codex/";
    const peerIdentityProfile =
      artifact.hostId === "codex"
        ? `${peerDirectory}claude-code-window-host-identity-profile.js`
        : `${peerDirectory}codex-window-host-identity-profile.js`;
    const peerResourceProfile = `${peerDirectory}wakeflow-workspace-host-resource-profile.js`;
    const peerFiles = manifest.files.filter((file) => file.path.startsWith(peerDirectory));
    deepEqual(
      peerFiles.map((file) => file.path),
      [peerIdentityProfile, peerResourceProfile],
    );
    deepEqual(
      peerFiles.map((file) => file.scope),
      ["peer-profile", "peer-profile"],
    );
    equal(
      manifest.files.some((file) => file.path.includes("statusline")),
      artifact.hostId === "claude-code",
    );

    // §13.99 D3、D9：整棵 `assets/agent-text/` 按该宿主的取值表渲染进制品。`agentText[]` 是
    // 这批文本的独立索引，与 `files` 里同名条目逐字节相等；渲染后不留占位符；`commands/`
    // 只进 Claude 制品（D2）；共享文本里只出现本宿主的指令文件名，不出现对端的。
    const agentTextPaths = manifest.agentText.map((file) => file.path);
    deepEqual([...agentTextPaths].sort(compareCodeUnits), agentTextPaths);
    for (const relative of [
      "README.md",
      "README.zh-CN.md",
      "skills/wakeflow-controller/SKILL.md",
    ]) {
      ok(agentTextPaths.includes(relative), relative);
    }
    for (const entry of manifest.agentText) {
      const listed = byPath.get(entry.path);
      equal(listed?.scope, "agent-text", entry.path);
      equal(listed?.mode, "0644", entry.path);
      equal(listed?.sha256, entry.sha256, entry.path);
      equal(listed?.bytes, entry.bytes, entry.path);
      const rendered = readFileSync(path.join(artifactRoot, entry.path), "utf8");
      equal(rendered.includes("{{"), false, entry.path);
      equal(Buffer.byteLength(rendered, "utf8"), entry.bytes, entry.path);
    }
    const agentTextCorpus = manifest.agentText
      .map((entry) => readFileSync(path.join(artifactRoot, entry.path), "utf8"))
      .join("\n");
    const isCodex = artifact.hostId === "codex";
    ok(agentTextCorpus.includes(isCodex ? "AGENTS.md" : "CLAUDE.md"));
    equal(agentTextCorpus.includes(isCodex ? "CLAUDE.md" : "AGENTS.md"), false);
    equal(
      agentTextPaths.some((file) => file.startsWith("commands/")),
      artifact.hostId === "claude-code",
    );
    // 文本 profile 与 hook 片段同类：只在构建时动态 import，不进任何闭包。
    equal(byPath.has("lib/hosts/codex/codex-agent-text-profile.js"), false);
    equal(byPath.has("lib/hosts/claude-code/claude-code-agent-text-profile.js"), false);
  }
});

test("制品搬到仓库之外后，两个 MCP 入口仍经官方 stdio Client 发布公共目录的全部工具：依赖闭包自足（D5）", {
  timeout: 40_000,
}, async (t) => {
  const output = outputFixture(t);
  const built = await buildCandidates();
  const expectedTools = WAKEFLOW_PUBLIC_TOOL_CATALOG.tools.map((tool) => tool.name).sort();

  for (const artifact of built.artifacts) {
    const installed = outsideRepositoryCopy(t, path.join(output, artifact.outputDirectory));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(installed, MCP_LAUNCHER)],
      cwd: installed,
      env: { PATH: process.env.PATH ?? "" },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const client = new Client({
      name: `wakeflow-${artifact.hostId}-artifact-test`,
      version: "1.0.0-test",
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      deepEqual(listed.tools.map((tool) => tool.name).sort(), expectedTools);
      equal(listed.tools.length, 20);
    } finally {
      await Promise.allSettled([client.close(), transport.close()]);
    }
    equal(stderr, "", artifact.hostId);
  }
});

test("两个制品的 hooks/observe.mjs 以宿主 SessionStart payload 把记录写进手搭工作区；观察目录被文件顶替时退出 0、stdout 空、stderr 恰好一行固定代码；报告固定代码后守卫已卸下，同一次运行的第二次故障不追加第二行", {
  timeout: 60_000,
}, async (t) => {
  const output = outputFixture(t);
  const built = await buildCandidates();

  for (const artifact of built.artifacts) {
    const launcher = path.join(output, artifact.outputDirectory, HOOK_OBSERVER_LAUNCHER);
    const workspace = workspaceFixture(t);
    const directory = observationsDirectory(workspace, artifact.hostId);

    // D4：成功路径退出 0、stdout 与 stderr 都为空；D8：记录落在该宿主的 hooks 观察目录。
    const landed = spawnHookObserver(launcher, artifact.hostId, workspace);
    equal(landed.status, 0, artifact.hostId);
    equal(landed.stdout, "", artifact.hostId);
    equal(landed.stderr, "", artifact.hostId);
    const records = readdirSync(directory).filter((name) => name.endsWith(".json"));
    equal(records.length, 1, artifact.hostId);
    match(records[0] ?? "", RECORD_FILE_PATTERN);

    // 观察目录的路径被普通文件顶替：内核的目录物化失败，launcher 仍退出 0、stdout 空，
    // stderr 恰好一行固定代码（D4、D8）——整行相等即证明不含根、cwd、句柄与 transcript 路径。
    rmSync(directory, { recursive: true, force: true });
    writeFileSync(directory, "not a directory\n", { mode: 0o600 });
    const failed = spawnHookObserver(launcher, artifact.hostId, workspace);
    equal(failed.status, 0, artifact.hostId);
    equal(failed.stdout, "", artifact.hostId);
    equal(failed.stderr, "wakeflow-hook-observer: write-failed\n", artifact.hostId);

    // D4：launcher 打出固定代码后卸下自己的进程守卫——同一次运行里随后再发生一次故障也
    // 不会追加第二行固定代码。假入口先排一次稍后故障再在求值时抛出，故障必定发生在 catch
    // 打出 `launcher` 之后（微任务先于定时器），所以这里不依赖机器快慢。
    const isolated = launcherWithLateFaultFixture(t, launcher);
    const guarded = spawnHookObserver(isolated, artifact.hostId, workspace);
    equal(guarded.stdout, "", artifact.hostId);
    deepEqual(fixedCodeLines(guarded.stderr), [`${FIXED_CODE_PREFIX}launcher`], artifact.hostId);
  }
});

test("hooks.json 的渲染字节必须等于片段模块自己声明的摘要：不一致或缺席时构建器以稳定错误码失败", () => {
  // 生产路径：构建器写出 hooks.json 前调用的就是这一道核对，两宿主的片段各自自洽。
  assertRenderedHookFragmentDigest(renderCodexHooksJson(), CODEX_HOOK_FRAGMENT_DIGEST);
  assertRenderedHookFragmentDigest(renderClaudeCodeHooksJson(), CLAUDE_CODE_HOOK_FRAGMENT_DIGEST);

  // 摘要与渲染字节脱节（这里用另一宿主的摘要制造不一致）即失败，而不是把字节写进制品。
  throws(
    () =>
      assertRenderedHookFragmentDigest(renderCodexHooksJson(), CLAUDE_CODE_HOOK_FRAGMENT_DIGEST),
    expectArtifactErrorCode("wakeflow-artifact-hook-fragment-digest"),
  );
  throws(
    () => assertRenderedHookFragmentDigest(renderClaudeCodeHooksJson(), CODEX_HOOK_FRAGMENT_DIGEST),
    expectArtifactErrorCode("wakeflow-artifact-hook-fragment-digest"),
  );
  // 片段模块没有导出摘要：同一个错误码，不是 TypeError。
  throws(
    () => assertRenderedHookFragmentDigest(renderCodexHooksJson(), undefined),
    expectArtifactErrorCode("wakeflow-artifact-hook-fragment-digest"),
  );
});

test("宿主中立闭包守卫拒绝任何 hosts/ 模块：本宿主模块与对端准入 profile 都以稳定错误码失败，纯 foundation/kernel 闭包通过", () => {
  // D1/D8：观察脚本的闭包只许 foundation 与 kernel。
  assertSharedClosure(CODEX_ISOLATION_RULE, [
    "entrypoints/wakeflow-hook-observer.js",
    "foundation/crypto/sha256.js",
    "kernel/hook-observations.js",
    "kernel/layout.js",
  ]);

  // 本宿主的实现模块混进来：一份宿主中立的脚本会带着宿主实现进制品。
  throws(
    () =>
      assertSharedClosure(CODEX_ISOLATION_RULE, [
        "kernel/layout.js",
        "hosts/codex/codex-hook-fragment.js",
      ]),
    expectArtifactErrorCode("wakeflow-artifact-hook-observer-scope"),
  );
  // 对端准入的纯数据 profile 是制品整体的准入，宿主中立的 launcher 仍然不许带上它。
  throws(
    () =>
      assertSharedClosure(CODEX_ISOLATION_RULE, [
        "hosts/claude-code/wakeflow-workspace-host-resource-profile.js",
      ]),
    expectArtifactErrorCode("wakeflow-artifact-hook-observer-scope"),
  );
  // 对端未准入的执行模块先被隔离规则拦下，错误码因此不同。
  throws(
    () =>
      assertSharedClosure(CODEX_ISOLATION_RULE, [
        "hosts/claude-code/claude-code-maintenance-execution.js",
      ]),
    expectArtifactErrorCode("wakeflow-artifact-host-isolation"),
  );
});

test("运行时依赖闭包按锁文件求传递闭包：直接包展开为已排序的精确版本集合；未安装、开发依赖与工作区链接各以稳定错误码拒绝", () => {
  const closure = resolveRuntimeDependencyClosure(process.cwd(), ["ajv"]);
  deepEqual(
    closure.map((entry) => entry.name),
    ["ajv", "fast-deep-equal", "fast-uri", "json-schema-traverse", "require-from-string"],
  );
  const ajv = closure.find((entry) => entry.name === "ajv");
  equal(ajv?.version, "8.20.0");
  deepEqual(ajv?.dependencies, [
    "fast-deep-equal",
    "fast-uri",
    "json-schema-traverse",
    "require-from-string",
  ]);
  for (const entry of closure) match(entry.integrity, /^sha512-/u);

  // 锁文件里没有的包、只在开发时安装的包、npm 工作区的符号链接，都不能成为运行时闭包。
  throws(
    () => resolveRuntimeDependencyClosure(process.cwd(), ["wakeflow-not-installed"]),
    expectClosureErrorCode("wakeflow-artifact-dependency-missing"),
  );
  throws(
    () => resolveRuntimeDependencyClosure(process.cwd(), ["typescript"]),
    expectClosureErrorCode("wakeflow-artifact-dependency-dev"),
  );
  throws(
    () => resolveRuntimeDependencyClosure(process.cwd(), ["wakeflow"]),
    expectClosureErrorCode("wakeflow-artifact-dependency-link"),
  );
});
