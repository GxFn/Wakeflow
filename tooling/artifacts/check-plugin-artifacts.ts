import { createHash } from "node:crypto";
import { lstatSync, opendirSync, readFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildWakeflowPluginArtifacts } from "./build-plugin-artifacts.js";
import {
  PLUGIN_NAME,
  expectedClaudeMarketplaceEntry,
  expectedCodexMarketplaceEntry,
  pluginDirectoryName,
  readReleaseVersion,
  type PluginHostId,
} from "./plugin-metadata.js";

/**
 * Wakeflow Tooling / Artifacts：committed 插件制品的校验器，`npm run build:check`（gate-log §13.101
 * D2、D6、D7）。
 *
 * `plugins/<host>/` 是纯生成物：本工具把源码重新装配到一个临时候选根，再逐字节对比 committed
 * 目录——先按 committed 制品自己的清单核对每个文件的字节、摘要与模式，且不得有清单之外的文件，
 * 再核对 committed 清单与刚构建的清单字节相等。任何手工编辑、遗漏重建或多出的文件都在这里
 * 变成稳定错误码。marketplace 条目不是生成物，但它的版本、来源路径与描述必须与元数据一致
 * （能力卡 10 Q5、Q6），所以一并核对。
 */

export const CLAUDE_MARKETPLACE_PATH = ".claude-plugin/marketplace.json";
export const CODEX_MARKETPLACE_PATH = ".agents/plugins/marketplace.json";
const DEFAULT_CANDIDATE_ROOT = ".build/artifacts-check";
const DEFAULT_COMMITTED_ROOT = "plugins";
const MANIFEST_FILE = "artifact-manifest.json";
const MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;
const MAXIMUM_ARTIFACT_FILES = 4096;

export interface CheckPluginArtifactsOptions {
  /** committed 制品根；缺省 `plugins`。 */
  readonly committedRoot?: string;
  /** 临时重建的候选根；必须在 `.build/` 之下，缺省 `.build/artifacts-check`。 */
  readonly candidateRoot?: string;
  /** 两份 marketplace 文件所在的根；缺省仓库根。 */
  readonly marketplaceRoot?: string;
}

export interface CheckedPluginArtifact {
  readonly hostId: PluginHostId;
  readonly directory: string;
  readonly fileCount: number;
  readonly manifestDigest: string;
}

export interface PluginArtifactsCheckResult {
  readonly kind: "WakeflowPluginArtifactsCheckResult";
  readonly schemaVersion: 1;
  readonly version: string;
  readonly releaseEligible: boolean;
  readonly artifacts: readonly Readonly<CheckedPluginArtifact>[];
  readonly marketplaces: Readonly<{ readonly claude: "ok"; readonly codex: "ok" }>;
}

/** committed 制品或 marketplace 与源码不一致时返回的稳定工具错误。 */
export class PluginArtifactCheckError extends Error {
  override readonly name = "PluginArtifactCheckError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new PluginArtifactCheckError(code, message);
}

type JsonRecord = Readonly<Record<string, unknown>>;

function isPlainRecord(value: unknown): value is JsonRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readJsonFile(file: string, label: string): JsonRecord {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (
    stat === undefined ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size > MAXIMUM_JSON_BYTES
  ) {
    fail("wakeflow-artifact-check-missing", `${label} is not one bounded regular file`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail("wakeflow-artifact-check-json", `${label} is not valid JSON`);
  }
  if (!isPlainRecord(parsed)) fail("wakeflow-artifact-check-json", `${label} must be one object`);
  return parsed;
}

/** 结构相等，键序无关：marketplace 文件是手写的，键的顺序不是合同。 */
export function jsonStructurallyEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => jsonStructurallyEqual(entry, right[index]))
    );
  }
  if (isPlainRecord(left) || isPlainRecord(right)) {
    if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
    const leftKeys = Object.keys(left).sort(compareCodeUnits);
    const rightKeys = Object.keys(right).sort(compareCodeUnits);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) => key === rightKeys[index] && jsonStructurallyEqual(left[key], right[key]),
      )
    );
  }
  return left === right;
}

function collectFiles(root: string): readonly string[] {
  const result: string[] = [];
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
      if (entry.isSymbolicLink()) {
        fail(
          "wakeflow-artifact-check-symlink",
          `committed artifact contains a symbolic link: ${relative}`,
        );
      }
      if (entry.isDirectory()) {
        pending.push(relative);
      } else if (entry.isFile()) {
        result.push(relative);
        if (result.length > MAXIMUM_ARTIFACT_FILES) {
          fail("wakeflow-artifact-check-extra", "committed artifact exceeds the file budget");
        }
      } else {
        fail(
          "wakeflow-artifact-check-extra",
          `committed artifact contains a special file: ${relative}`,
        );
      }
    }
  }
  return Object.freeze(result.sort(compareCodeUnits));
}

interface ManifestFileEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly mode: "0644" | "0755";
}

function parseManifestFiles(manifest: JsonRecord): readonly Readonly<ManifestFileEntry>[] {
  if (manifest.kind !== "WakeflowPluginArtifactManifest" || !Array.isArray(manifest.files)) {
    fail(
      "wakeflow-artifact-check-manifest",
      "committed manifest is not one plugin artifact manifest",
    );
  }
  return Object.freeze(
    manifest.files.map((entry: unknown) => {
      if (
        !isPlainRecord(entry) ||
        typeof entry.path !== "string" ||
        typeof entry.bytes !== "number" ||
        typeof entry.sha256 !== "string" ||
        (entry.mode !== "0644" && entry.mode !== "0755")
      ) {
        fail("wakeflow-artifact-check-manifest", "committed manifest lists a malformed file entry");
      }
      return Object.freeze({
        path: entry.path,
        bytes: entry.bytes,
        sha256: entry.sha256,
        mode: entry.mode,
      });
    }),
  );
}

export interface VerifiedArtifact {
  readonly fileCount: number;
  readonly manifestBytes: Buffer;
  readonly manifest: JsonRecord;
}

/**
 * 按 committed 制品自己的清单核对它：文件集合恰好等于清单加清单本身，每个文件的字节数、sha256
 * 与模式与清单一致。导出供校验测试与冒烟复用。
 */
export function verifyArtifactAgainstManifest(artifactRoot: string): Readonly<VerifiedArtifact> {
  const manifestPath = path.join(artifactRoot, MANIFEST_FILE);
  const manifest = readJsonFile(manifestPath, `${artifactRoot}/${MANIFEST_FILE}`);
  const files = parseManifestFiles(manifest);
  const expected = new Map(files.map((entry) => [entry.path, entry]));
  const actual = collectFiles(artifactRoot);
  for (const relative of actual) {
    if (relative === MANIFEST_FILE) continue;
    if (!expected.has(relative)) {
      fail(
        "wakeflow-artifact-check-extra",
        `committed artifact has a file outside its manifest: ${relative}`,
      );
    }
  }
  const present = new Set(actual);
  for (const entry of files) {
    if (!present.has(entry.path)) {
      fail(
        "wakeflow-artifact-check-missing",
        `committed artifact lacks a listed file: ${entry.path}`,
      );
    }
    const absolute = path.join(artifactRoot, entry.path);
    const stat = lstatSync(absolute);
    const bytes = readFileSync(absolute);
    const mode =
      (stat.mode & 0o777) === 0o755 ? "0755" : (stat.mode & 0o777) === 0o644 ? "0644" : "other";
    if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256 || mode !== entry.mode) {
      fail(
        "wakeflow-artifact-check-drift",
        `committed artifact file differs from its manifest: ${entry.path}`,
      );
    }
  }
  return Object.freeze({
    fileCount: files.length,
    manifestBytes: readFileSync(manifestPath),
    manifest,
  });
}

function marketplaceEntries(file: string, label: string): readonly unknown[] {
  const document = readJsonFile(file, label);
  if (!Array.isArray(document.plugins)) {
    fail("wakeflow-artifact-check-marketplace", `${label} has no plugins array`);
  }
  const entries = document.plugins.filter(
    (entry: unknown) => isPlainRecord(entry) && entry.name === PLUGIN_NAME,
  );
  if (entries.length !== 1) {
    fail(
      "wakeflow-artifact-check-marketplace",
      `${label} must list exactly one ${PLUGIN_NAME} entry`,
    );
  }
  return entries;
}

/** 两份 marketplace 的 `wakeflow` 条目必须与元数据结构相等（Codex 无版本字段，Q6）。 */
export function checkMarketplaces(marketplaceRoot: string, version: string): void {
  const [claude] = marketplaceEntries(
    path.join(marketplaceRoot, CLAUDE_MARKETPLACE_PATH),
    CLAUDE_MARKETPLACE_PATH,
  );
  if (!jsonStructurallyEqual(claude, expectedClaudeMarketplaceEntry(version))) {
    fail(
      "wakeflow-artifact-check-marketplace",
      `${CLAUDE_MARKETPLACE_PATH} entry disagrees with the plugin metadata`,
    );
  }
  const [codex] = marketplaceEntries(
    path.join(marketplaceRoot, CODEX_MARKETPLACE_PATH),
    CODEX_MARKETPLACE_PATH,
  );
  if (!jsonStructurallyEqual(codex, expectedCodexMarketplaceEntry())) {
    fail(
      "wakeflow-artifact-check-marketplace",
      `${CODEX_MARKETPLACE_PATH} entry disagrees with the plugin metadata`,
    );
  }
}

/** 逐文件找出 committed 与候选清单的差异路径，让错误信息指向具体文件而不是只说"不一致"。 */
function manifestDifferences(committed: JsonRecord, candidate: JsonRecord): readonly string[] {
  const left = new Map(parseManifestFiles(committed).map((entry) => [entry.path, entry.sha256]));
  const right = new Map(parseManifestFiles(candidate).map((entry) => [entry.path, entry.sha256]));
  const differing = new Set<string>();
  for (const [relative, digest] of left)
    if (right.get(relative) !== digest) differing.add(relative);
  for (const relative of right.keys()) if (!left.has(relative)) differing.add(relative);
  return [...differing].sort(compareCodeUnits);
}

export async function checkWakeflowPluginArtifacts(
  repositoryRootInput: string,
  options: Readonly<CheckPluginArtifactsOptions> = {},
): Promise<Readonly<PluginArtifactsCheckResult>> {
  const repositoryRoot = path.resolve(repositoryRootInput);
  const release = readReleaseVersion(repositoryRoot);
  const committedRoot = path.resolve(
    repositoryRoot,
    options.committedRoot ?? DEFAULT_COMMITTED_ROOT,
  );
  const candidateRoot = options.candidateRoot ?? DEFAULT_CANDIDATE_ROOT;
  const built = await buildWakeflowPluginArtifacts(repositoryRoot, { outputRoot: candidateRoot });
  const candidateAbsolute = path.resolve(repositoryRoot, built.outputRoot);

  const artifacts: Readonly<CheckedPluginArtifact>[] = [];
  for (const artifact of built.artifacts) {
    const directory = pluginDirectoryName(artifact.hostId);
    const committed = verifyArtifactAgainstManifest(path.join(committedRoot, directory));
    const candidateManifestPath = path.join(candidateAbsolute, directory, MANIFEST_FILE);
    const candidateManifestBytes = readFileSync(candidateManifestPath);
    if (!committed.manifestBytes.equals(candidateManifestBytes)) {
      const differing = manifestDifferences(
        committed.manifest,
        readJsonFile(candidateManifestPath, candidateManifestPath),
      );
      fail(
        "wakeflow-artifact-check-drift",
        `${directory} differs from a fresh build: ${differing.slice(0, 8).join(", ")}${differing.length > 8 ? ", …" : ""}`,
      );
    }
    artifacts.push(
      Object.freeze({
        hostId: artifact.hostId,
        directory,
        fileCount: committed.fileCount,
        manifestDigest: sha256(committed.manifestBytes),
      }),
    );
  }
  checkMarketplaces(path.resolve(repositoryRoot, options.marketplaceRoot ?? "."), release.version);

  return Object.freeze({
    kind: "WakeflowPluginArtifactsCheckResult",
    schemaVersion: 1,
    version: release.version,
    releaseEligible: built.releaseEligible,
    artifacts: Object.freeze(artifacts),
    marketplaces: Object.freeze({ claude: "ok", codex: "ok" }),
  });
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && path.resolve(invoked) === fileURLToPath(import.meta.url);
}

async function runAsMain(): Promise<void> {
  try {
    const result = await checkWakeflowPluginArtifacts(process.cwd());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write("wakeflow-artifact-check-unexpected: plugin artifact check failed\n");
    }
    process.exitCode = 1;
  }
}

if (isMainModule()) await runAsMain();
