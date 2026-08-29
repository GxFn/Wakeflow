import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initSync, parse } from "es-module-lexer";

/**
 * Wakeflow Tooling / Artifacts：TypeScript 技术骨干的双宿主候选制品装配器。
 *
 * 本工具以已编译宿主入口为唯一根，使用成熟ES module lexer求取真实静态依赖
 * 闭包，只把可达 JavaScript、精确 npm 依赖和最小 MCP 启动资产写入 `.build`。它不会
 * 读取旧 JS 运行时来补能力，也不会更新 `plugins/`、安装缓存或任何发布版本来源。
 *
 * 候选制品明确标记为不可发布；它只验证 TS 单一源码能够形成 Codex 与 Claude Code
 * 两个隔离闭包。完整 Skills、模板、业务工具和最终插件 manifest 留到整体切换阶段。
 */

const DEFAULT_OUTPUT_ROOT = ".build/artifacts";
const COMPILED_SOURCE_ROOT = ".build/src";
const MAXIMUM_MODULE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_COMPILED_MODULES = 1024;
const CANDIDATE_VERSION = "0.0.0-technical-skeleton";

type CandidateHostId = "codex" | "claude-code";
type CompiledFileScope = "shared" | "current-host" | "peer-profile";

interface CandidateDefinition {
  readonly hostId: CandidateHostId;
  readonly directoryName: "codex-wakeflow" | "claude-code-wakeflow";
  readonly referencePackagePath: string;
  readonly entrypoint: string;
  readonly runExport:
    | "runCodexWakeflowMcpStdio"
    | "runClaudeCodeWakeflowMcpStdio";
  readonly currentHostDirectory: string;
  readonly peerHostDirectory: string;
  readonly admittedPeerProfile: string;
}

const CANDIDATES = Object.freeze([
  Object.freeze({
    hostId: "codex",
    directoryName: "codex-wakeflow",
    referencePackagePath: "plugins/codex-wakeflow/package.json",
    entrypoint: "entrypoints/codex-wakeflow-mcp.js",
    runExport: "runCodexWakeflowMcpStdio",
    currentHostDirectory: "hosts/codex/",
    peerHostDirectory: "hosts/claude-code/",
    admittedPeerProfile:
      "hosts/claude-code/wakeflow-workspace-host-resource-profile.js",
  }),
  Object.freeze({
    hostId: "claude-code",
    directoryName: "claude-code-wakeflow",
    referencePackagePath: "plugins/claude-code-wakeflow/package.json",
    entrypoint: "entrypoints/claude-code-wakeflow-mcp.js",
    runExport: "runClaudeCodeWakeflowMcpStdio",
    currentHostDirectory: "hosts/claude-code/",
    peerHostDirectory: "hosts/codex/",
    admittedPeerProfile:
      "hosts/codex/wakeflow-workspace-host-resource-profile.js",
  }),
] as const satisfies readonly Readonly<CandidateDefinition>[]);

interface JsonRecord {
  readonly [key: string]: unknown;
}

interface CompiledClosure {
  readonly files: readonly string[];
  readonly externalPackages: readonly string[];
}

interface TypescriptArtifactCandidateBuildRecord {
  readonly hostId: CandidateHostId;
  readonly outputDirectory: string;
  readonly compiledFileCount: number;
  readonly externalPackages: readonly string[];
  readonly manifestDigest: string;
}

interface TypescriptArtifactCandidatesBuildResult {
  readonly kind: "WakeflowTypescriptArtifactCandidatesBuildResult";
  readonly schemaVersion: 1;
  readonly releaseEligible: false;
  readonly outputRoot: string;
  readonly artifacts: readonly Readonly<TypescriptArtifactCandidateBuildRecord>[];
}

/** 候选制品输入、闭包或物理输出不满足约束时返回的稳定工具错误。 */
class TypescriptArtifactCandidateBuildError extends Error {
  override readonly name = "TypescriptArtifactCandidateBuildError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new TypescriptArtifactCandidateBuildError(code, message);
}

function isPlainRecord(value: unknown): value is JsonRecord {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function lstatOrNull(target: string): Stats | null {
  try {
    return lstatSync(target);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function repositoryRelative(repositoryRoot: string, absolute: string): string {
  return path.relative(repositoryRoot, absolute).split(path.sep).join("/") || ".";
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertBelow(parent: string, child: string, code: string): void {
  const relative = path.relative(parent, child);
  if (
    relative.length === 0
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    fail(code, "artifact path escaped its declared parent");
  }
}

function assertRealDirectory(directory: string, label: string): void {
  const stat = lstatOrNull(directory);
  if (stat === null || stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-artifact-directory", `${label} must be one real directory`);
  }
}

function ensureRealDirectoryPath(root: string, directory: string): void {
  const relative = path.relative(root, directory);
  if (
    relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    fail("wakeflow-artifact-output-scope", "output directory escaped repository root");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatOrNull(current);
    if (stat === null) {
      mkdirSync(current, { mode: 0o755 });
    } else if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(
        "wakeflow-artifact-directory",
        `${repositoryRelative(root, current)} must be one real directory`,
      );
    }
  }
}

function readBoundedRegularFile(file: string): Buffer {
  const stat = lstatOrNull(file);
  if (
    stat === null
    || stat.isSymbolicLink()
    || !stat.isFile()
    || stat.nlink !== 1
    || stat.size > MAXIMUM_MODULE_BYTES
  ) {
    fail("wakeflow-artifact-source-file", "artifact source must be one bounded regular file");
  }
  return readFileSync(file);
}

function readJsonRecord(file: string): JsonRecord {
  let value: unknown;
  try {
    value = JSON.parse(readBoundedRegularFile(file).toString("utf8"));
  } catch {
    fail("wakeflow-artifact-json", "artifact metadata input is not valid JSON");
  }
  if (!isPlainRecord(value)) {
    fail("wakeflow-artifact-json", "artifact metadata input must be one JSON object");
  }
  return value;
}

function packageRoot(specifier: string): string {
  if (specifier.startsWith("@")) {
    const segments = specifier.split("/");
    if (segments.length < 2 || segments[1]?.length === 0) {
      fail("wakeflow-artifact-dependency", "scoped package specifier is invalid");
    }
    return `${segments[0]}/${segments[1]}`;
  }
  const root = specifier.split("/")[0];
  if (root === undefined || root.length === 0) {
    fail("wakeflow-artifact-dependency", "package specifier is invalid");
  }
  return root;
}

function compiledModuleClosure(
  compiledRoot: string,
  entrypoint: string,
): Readonly<CompiledClosure> {
  initSync();
  const pending = [entrypoint];
  const visited = new Set<string>();
  const externalPackages = new Set<string>();

  while (pending.length > 0) {
    const relative = pending.pop();
    if (relative === undefined || visited.has(relative)) continue;
    if (visited.size >= MAXIMUM_COMPILED_MODULES) {
      fail(
        "wakeflow-artifact-module-count",
        `compiled closure exceeds ${MAXIMUM_COMPILED_MODULES} modules`,
      );
    }
    const absolute = path.resolve(compiledRoot, relative);
    assertBelow(compiledRoot, absolute, "wakeflow-artifact-module-scope");
    if (path.extname(absolute) !== ".js") {
      fail("wakeflow-artifact-module-type", "compiled closure may contain only JavaScript modules");
    }
    const source = readBoundedRegularFile(absolute).toString("utf8");
    visited.add(relative);

    const [imports] = parse(source, relative);
    for (const imported of imports) {
      if (imported.d === -2) continue;
      const specifier = imported.n;
      if (specifier === undefined) {
        fail(
          "wakeflow-artifact-dynamic-import",
          "compiled closure contains a non-literal dynamic import",
        );
      }
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".")) {
        externalPackages.add(packageRoot(specifier));
        continue;
      }
      const resolved = path.resolve(path.dirname(absolute), specifier);
      assertBelow(compiledRoot, resolved, "wakeflow-artifact-module-scope");
      const importedRelative = repositoryRelative(compiledRoot, resolved);
      if (!visited.has(importedRelative)) pending.push(importedRelative);
    }
  }

  return Object.freeze({
    files: Object.freeze([...visited].sort()),
    externalPackages: Object.freeze([...externalPackages].sort()),
  });
}

function compiledFileScope(
  definition: Readonly<CandidateDefinition>,
  relative: string,
): CompiledFileScope {
  if (relative.startsWith(definition.currentHostDirectory)) {
    return "current-host";
  }
  if (relative.startsWith(definition.peerHostDirectory)) {
    if (relative !== definition.admittedPeerProfile) {
      fail(
        "wakeflow-artifact-host-isolation",
        `${definition.hostId} closure reached a peer-host execution module`,
      );
    }
    return "peer-profile";
  }
  return "shared";
}

function directDependencyVersions(rootPackage: JsonRecord): Readonly<Record<string, string>> {
  if (!isPlainRecord(rootPackage.dependencies)) {
    fail("wakeflow-artifact-dependency", "root package dependencies are missing");
  }
  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(rootPackage.dependencies)) {
    if (typeof version !== "string" || version.length === 0) {
      fail("wakeflow-artifact-dependency", "root runtime dependency version is invalid");
    }
    result[name] = version;
  }
  return Object.freeze(result);
}

function dependenciesForClosure(
  closure: Readonly<CompiledClosure>,
  directDependencies: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of closure.externalPackages) {
    const version = directDependencies[name];
    if (version === undefined) {
      fail(
        "wakeflow-artifact-dependency",
        `compiled runtime imports undeclared package ${name}`,
      );
    }
    result[name] = version;
  }
  return Object.freeze(result);
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function writeExclusive(
  outputRoot: string,
  relative: string,
  bytes: Uint8Array,
  mode: 0o644 | 0o755 = 0o644,
): void {
  const destination = path.resolve(outputRoot, relative);
  assertBelow(outputRoot, destination, "wakeflow-artifact-output-scope");
  ensureRealDirectoryPath(outputRoot, path.dirname(destination));
  writeFileSync(destination, bytes, { flag: "wx", mode });
  chmodSync(destination, mode);
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function compiledArtifactBytes(source: Buffer): Buffer {
  const text = source.toString("utf8").replace(
    /\n\/\/# sourceMappingURL=[^\r\n]+(?:\r?\n)?$/u,
    "\n",
  );
  return Buffer.from(text, "utf8");
}

function launcherBytes(definition: Readonly<CandidateDefinition>): Buffer {
  return Buffer.from([
    "#!/usr/bin/env node",
    "// 此文件由 Wakeflow TypeScript 候选制品装配器生成，禁止手工修改。",
    `import { ${definition.runExport} } from \"../lib/${definition.entrypoint}\";`,
    "",
    `${definition.runExport}(${JSON.stringify(CANDIDATE_VERSION)});`,
    "",
  ].join("\n"), "utf8");
}

function mcpConfiguration(definition: Readonly<CandidateDefinition>): JsonRecord {
  return definition.hostId === "codex"
    ? {
        mcpServers: {
          wakeflow: {
            command: "node",
            args: ["./mcp/server.mjs"],
            cwd: ".",
          },
        },
      }
    : {
        mcpServers: {
          wakeflow: {
            command: "node",
            args: ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"],
          },
        },
      };
}

function packageMetadata(
  referencePackage: JsonRecord,
  dependencies: Readonly<Record<string, string>>,
): JsonRecord {
  if (typeof referencePackage.name !== "string") {
    fail("wakeflow-artifact-package", "reference package name is invalid");
  }
  if (
    typeof referencePackage.version !== "string"
    || referencePackage.version.length === 0
  ) {
    fail("wakeflow-artifact-package", "reference package version is invalid");
  }
  return {
    name: referencePackage.name,
    version: CANDIDATE_VERSION,
    private: true,
    type: "module",
    description: "Non-release Wakeflow TypeScript technical-skeleton artifact candidate.",
    license: referencePackage.license,
    homepage: referencePackage.homepage,
    repository: referencePackage.repository,
    bin: {
      "wakeflow-mcp": "./mcp/server.mjs",
    },
    scripts: {
      mcp: "node ./mcp/server.mjs",
    },
    engines: {
      node: ">=24.19.0 <25",
    },
    dependencies,
  };
}

function assembleCandidate(
  repositoryRoot: string,
  compiledRoot: string,
  stageRoot: string,
  definition: Readonly<CandidateDefinition>,
  directDependencies: Readonly<Record<string, string>>,
): Readonly<TypescriptArtifactCandidateBuildRecord> {
  const closure = compiledModuleClosure(compiledRoot, definition.entrypoint);
  const dependencies = dependenciesForClosure(closure, directDependencies);
  const referencePackage = readJsonRecord(path.join(
    repositoryRoot,
    definition.referencePackagePath,
  ));
  const candidateRoot = path.join(stageRoot, definition.directoryName);
  mkdirSync(candidateRoot, { mode: 0o755 });

  const payload: Array<Readonly<{
    path: string;
    bytes: number;
    sha256: string;
    mode: "0644" | "0755";
    scope: CompiledFileScope | "entrypoint" | "metadata";
  }>> = [];

  for (const relative of closure.files) {
    const bytes = compiledArtifactBytes(readBoundedRegularFile(path.join(
      compiledRoot,
      relative,
    )));
    const destination = `lib/${relative}`;
    writeExclusive(candidateRoot, destination, bytes);
    payload.push(Object.freeze({
      path: destination,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      mode: "0644",
      scope: compiledFileScope(definition, relative),
    }));
  }

  const generatedFiles = [
    Object.freeze({
      path: "mcp/server.mjs",
      bytes: launcherBytes(definition),
      mode: 0o755 as const,
      scope: "entrypoint" as const,
    }),
    Object.freeze({
      path: ".mcp.json",
      bytes: jsonBytes(mcpConfiguration(definition)),
      mode: 0o644 as const,
      scope: "metadata" as const,
    }),
    Object.freeze({
      path: "package.json",
      bytes: jsonBytes(packageMetadata(referencePackage, dependencies)),
      mode: 0o644 as const,
      scope: "metadata" as const,
    }),
  ];
  for (const file of generatedFiles) {
    writeExclusive(candidateRoot, file.path, file.bytes, file.mode);
    payload.push(Object.freeze({
      path: file.path,
      bytes: file.bytes.byteLength,
      sha256: sha256(file.bytes),
      mode: file.mode === 0o755 ? "0755" : "0644",
      scope: file.scope,
    }));
  }

  payload.sort((left, right) => compareCodeUnits(left.path, right.path));
  const manifest = {
    kind: "WakeflowTypescriptArtifactCandidateManifest",
    schemaVersion: 1,
    releaseEligible: false,
    scope: "maintenance-and-window-identity-technical-skeleton",
    hostId: definition.hostId,
    candidateVersion: CANDIDATE_VERSION,
    referenceArtifactVersion: referencePackage.version,
    sourceEntrypoint: `src/${definition.entrypoint.replace(/\.js$/u, ".ts")}`,
    runtimeEntrypoint: "mcp/server.mjs",
    externalPackages: closure.externalPackages,
    files: payload,
  } as const;
  const manifestBytes = jsonBytes(manifest);
  writeExclusive(candidateRoot, "artifact-manifest.json", manifestBytes);

  return Object.freeze({
    hostId: definition.hostId,
    outputDirectory: definition.directoryName,
    compiledFileCount: closure.files.length,
    externalPackages: closure.externalPackages,
    manifestDigest: sha256(manifestBytes),
  });
}

function removeRealDirectory(directory: string): void {
  const stat = lstatOrNull(directory);
  if (stat === null) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-artifact-output-type", "artifact output must be one real directory");
  }
  rmSync(directory, { recursive: true, force: false });
}

function replaceOutputAtomically(
  repositoryRoot: string,
  stage: string,
  output: string,
): void {
  const backup = path.join(
    path.dirname(output),
    `.${path.basename(output)}.backup-${process.pid}-${randomUUID()}`,
  );
  const previous = lstatOrNull(output);
  if (previous !== null) {
    if (previous.isSymbolicLink() || !previous.isDirectory()) {
      fail("wakeflow-artifact-output-type", "artifact output must be one real directory");
    }
    renameSync(output, backup);
  }
  try {
    renameSync(stage, output);
  } catch (error: unknown) {
    if (lstatOrNull(backup) !== null && lstatOrNull(output) === null) {
      renameSync(backup, output);
    }
    throw error;
  }
  if (lstatOrNull(backup) !== null) removeRealDirectory(backup);
  assertBelow(repositoryRoot, output, "wakeflow-artifact-output-scope");
}

/** 从一次共享 TS 编译结果装配两份隔离、不可发布的宿主候选制品。 */
export function buildTypescriptArtifactCandidates(
  repositoryRootInput: string,
  outputRootInput = DEFAULT_OUTPUT_ROOT,
): Readonly<TypescriptArtifactCandidatesBuildResult> {
  const repositoryRoot = path.resolve(repositoryRootInput);
  assertRealDirectory(repositoryRoot, "repository root");
  const rootPackage = readJsonRecord(path.join(repositoryRoot, "package.json"));
  if (rootPackage.name !== "wakeflow-repo") {
    fail("wakeflow-artifact-repository", "current directory is not the Wakeflow source repository");
  }
  const compiledRoot = path.join(repositoryRoot, COMPILED_SOURCE_ROOT);
  assertRealDirectory(compiledRoot, COMPILED_SOURCE_ROOT);

  const output = path.resolve(repositoryRoot, outputRootInput);
  const buildRoot = path.join(repositoryRoot, ".build");
  assertBelow(buildRoot, output, "wakeflow-artifact-output-scope");
  ensureRealDirectoryPath(repositoryRoot, path.dirname(output));
  const stage = path.join(
    path.dirname(output),
    `.${path.basename(output)}.stage-${process.pid}-${randomUUID()}`,
  );
  assertBelow(buildRoot, stage, "wakeflow-artifact-output-scope");
  if (lstatOrNull(stage) !== null) {
    fail("wakeflow-artifact-stage", "artifact stage already exists");
  }
  mkdirSync(stage, { mode: 0o755 });

  const directDependencies = directDependencyVersions(rootPackage);
  const artifacts: TypescriptArtifactCandidateBuildRecord[] = [];
  try {
    for (const definition of CANDIDATES) {
      artifacts.push(assembleCandidate(
        repositoryRoot,
        compiledRoot,
        stage,
        definition,
        directDependencies,
      ));
    }
    replaceOutputAtomically(repositoryRoot, stage, output);
  } catch (error: unknown) {
    if (lstatOrNull(stage) !== null) removeRealDirectory(stage);
    throw error;
  }

  return Object.freeze({
    kind: "WakeflowTypescriptArtifactCandidatesBuildResult",
    schemaVersion: 1,
    releaseEligible: false,
    outputRoot: repositoryRelative(repositoryRoot, output),
    artifacts: Object.freeze(artifacts),
  });
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined
    && path.resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    const result = buildTypescriptArtifactCandidates(process.cwd());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error: unknown) {
    if (error instanceof TypescriptArtifactCandidateBuildError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write("wakeflow-artifact-unexpected: candidate build failed\n");
    }
    process.exitCode = 1;
  }
}
