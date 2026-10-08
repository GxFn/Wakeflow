import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  PLUGIN_NAME,
  isReleaseSeries,
  parseSemanticVersion,
  pluginDirectoryName,
  pluginManifestPath,
  readReleaseVersion,
} from "../artifacts/plugin-metadata.js";

/**
 * Wakeflow Tooling / Release：版本号准备（`wf release bump --version X [--apply]`）。
 *
 * 唯一版本输入是 `assets/release/version.json`；Claude marketplace 的 `wakeflow` 条目是手工维护的
 * 第二处。两个插件的 `package.json` 与清单由构建器从版本输入渲染，所以本命令只改前两处，并列出
 * 重建后才会跟上的生成文件。版本修改、重建、提交、推送、打 tag 与缓存刷新仍是各自独立的动作
 * （CLAUDE.md），`--apply` 只完成第一步；`release:check` 仍是提交后的严格门。
 */

const VERSION_PATH = "assets/release/version.json";
const CLAUDE_MARKETPLACE_PATH = ".claude-plugin/marketplace.json";
const MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;

export interface VersionBumpEdit {
  readonly path: string;
  readonly from: string;
  readonly to: string;
}

export interface VersionBumpPlan {
  readonly kind: "WakeflowVersionBumpPlan";
  readonly schemaVersion: 1;
  readonly status: "passed";
  readonly version: string;
  readonly edits: readonly Readonly<VersionBumpEdit>[];
  /** 由 `npm run build:artifacts:committed` 重新渲染的版本源及其当前值。 */
  readonly generated: readonly Readonly<{
    readonly path: string;
    readonly version: string | null;
  }>[];
  readonly changesApplied: boolean;
  readonly nextSteps: readonly string[];
}

type JsonRecord = Record<string, unknown>;

function readJson(root: string, relative: string): JsonRecord {
  const file = path.join(root, relative);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (
    stat === undefined ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size > MAXIMUM_JSON_BYTES
  )
    throw new Error(`${relative} is not one bounded regular file.`);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${relative} must be one JSON object.`);
  return parsed as JsonRecord;
}

function writeJson(root: string, relative: string, value: JsonRecord): void {
  writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
}

function marketplaceEntry(document: JsonRecord): JsonRecord {
  const plugins = Array.isArray(document.plugins) ? document.plugins : [];
  const entries = plugins.filter(
    (entry: unknown): entry is JsonRecord =>
      entry !== null && typeof entry === "object" && (entry as JsonRecord).name === PLUGIN_NAME,
  );
  const [entry] = entries;
  if (entries.length !== 1 || entry === undefined)
    throw new Error(`${CLAUDE_MARKETPLACE_PATH} must list exactly one ${PLUGIN_NAME} entry.`);
  return entry;
}

function generatedVersion(root: string, relative: string): string | null {
  try {
    const version = readJson(root, relative).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

export function planVersionBump(
  rootInput: string,
  requested: string,
  options: Readonly<{ apply?: boolean }> = {},
): Readonly<VersionBumpPlan> {
  const root = path.resolve(rootInput);
  const version = parseSemanticVersion(requested, "requested version");
  if (!isReleaseSeries(version))
    throw new Error(`${version} is not in the release series (major >= 1).`);
  const current = readReleaseVersion(root);
  if (current.version === version) throw new Error(`${VERSION_PATH} already carries ${version}.`);
  const marketplace = readJson(root, CLAUDE_MARKETPLACE_PATH);
  const entry = marketplaceEntry(marketplace);
  const entryVersion = parseSemanticVersion(entry.version, "claude marketplace");
  const edits: VersionBumpEdit[] = [
    { path: VERSION_PATH, from: current.version, to: version },
    { path: CLAUDE_MARKETPLACE_PATH, from: entryVersion, to: version },
  ];
  const generated = (["codex", "claude-code"] as const).flatMap((hostId) => {
    const directory = `plugins/${pluginDirectoryName(hostId)}`;
    return [`${directory}/package.json`, `${directory}/${pluginManifestPath(hostId)}`].map(
      (relative) => ({
        path: relative,
        version: generatedVersion(root, relative),
      }),
    );
  });
  if (options.apply === true) {
    const versionDocument = readJson(root, VERSION_PATH);
    writeJson(root, VERSION_PATH, { ...versionDocument, version });
    entry.version = version;
    writeJson(root, CLAUDE_MARKETPLACE_PATH, marketplace);
  }
  return Object.freeze({
    kind: "WakeflowVersionBumpPlan",
    schemaVersion: 1,
    status: "passed",
    version,
    edits: Object.freeze(edits),
    generated: Object.freeze(generated),
    changesApplied: options.apply === true,
    nextSteps: Object.freeze([
      options.apply === true
        ? "run `npm run build:artifacts:committed` to re-render the plugin versions"
        : "re-run with --apply to write the two version sources",
      "run `npm test` and `npm run smoke:artifacts` on the rebuilt bytes",
      "commit, push, tag and refresh caches as separate, explicitly requested actions; `npm run release:check` gates the result",
    ]),
  });
}
