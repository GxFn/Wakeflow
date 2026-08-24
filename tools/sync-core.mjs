#!/usr/bin/env node

/**
 * Sync the shared Wakeflow core into every plugin artifact.
 *
 * `core/` is the source of truth for host-neutral runtime files. Each plugin
 * artifact (plugins/codex-wakeflow, plugins/claude-code-wakeflow) is a
 * self-contained marketplace install surface, so synced files are committed
 * inside each artifact as plain copies.
 *
 * Usage:
 *   node tools/sync-core.mjs            # copy core files into all targets
 *   node tools/sync-core.mjs --check    # fail when any target drifts from core
 *
 * Host-layer files are never written by this script. Shared files use one of
 * two explicit source classes: copy members are mirrored byte-for-byte, while
 * core/template-sources is materialized into one generated install asset
 * bundle per artifact. Host profiles, adapters, entry skills, manifests,
 * READMEs and memory files remain host contracts.
 */

import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildWakeflowAssetBundleBytes,
  WAKEFLOW_ASSET_BUNDLE_RELATIVE_PATH,
} from "./build-asset-bundle.mjs";

const defaultRepoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = parseCliArgs(process.argv.slice(2));
const repoRoot = path.resolve(cli.repoRoot ?? defaultRepoRoot);
const coreRoot = path.join(repoRoot, "core");
const check = cli.check;
const CORE_MANIFEST = "scripts/wakeflow-core-manifest.json";
const TEMPLATE_SOURCE_DIRECTORY = "template-sources";
const MAX_SYNC_FILE_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_CORE_ENTRIES = 10_000;
let temporarySequence = 0;

const TARGETS = [
  {
    dir: "plugins/codex-wakeflow",
    manifest: ".codex-plugin/plugin.json",
    memoryFile: "AGENTS.md",
  },
  {
    dir: "plugins/claude-code-wakeflow",
    manifest: ".claude-plugin/plugin.json",
    memoryFile: "CLAUDE.md",
  },
];

const HOST_CONTRACT_FILES = (target) => [
  target.manifest,
  ".mcp.json",
  target.memoryFile,
  "README.md",
  "README.zh-CN.md",
  "package.json",
  "scripts/README.md",
  "scripts/lib/wakeflow-host-profile.mjs",
  "scripts/lib/wakeflow-host-artifact-checks.mjs",
  "skills/wakeflow-controller/SKILL.md",
  "skills/wakeflow-target/SKILL.md",
  "skills/wakeflow-governance/SKILL.md",
];

const HOST_LOCAL_CORE_FILES = new Set([
  "scripts/lib/wakeflow-host-profile.mjs",
]);

const HOST_PROTECTED_FILES = new Set([
  ".mcp.json",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "README.zh-CN.md",
  "package.json",
  CORE_MANIFEST,
  WAKEFLOW_ASSET_BUNDLE_RELATIVE_PATH,
  "scripts/README.md",
  "scripts/lib/wakeflow-host-artifact-checks.mjs",
  "scripts/lib/wakeflow-host-profile.mjs",
  "scripts/lib/wakeflow-host-send-adapter.mjs",
  "skills/wakeflow-governance/SKILL.md",
  "skills/wakeflow-governance/references/agents-rule-map.md",
  "skills/wakeflow-governance/references/direct-thread-window-config.md",
  "skills/wakeflow-governance/references/script-pipeline.md",
  "skills/wakeflow-governance/references/stage-route-map.md",
  "skills/wakeflow-governance/references/wakeflow-architecture.md",
  "skills/wakeflow-governance/references/wakeflow-delivery.md",
  "skills/wakeflow-governance/references/wakeflow-ledgers.md",
  "skills/wakeflow-governance/references/window-dispatch.md",
]);

function parseCliArgs(args) {
  const parsed = { check: false, repoRoot: null };
  let seenCheck = false;
  let seenRepoRoot = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") {
      if (seenCheck) cliFailure("--check may be provided only once");
      seenCheck = true;
      parsed.check = true;
      continue;
    }
    if (arg === "--repo-root" || arg.startsWith("--repo-root=")) {
      if (seenRepoRoot) cliFailure("--repo-root may be provided only once");
      seenRepoRoot = true;
      const value = arg === "--repo-root" ? args[++index] : arg.slice("--repo-root=".length);
      if (!value || value.startsWith("--")) cliFailure("--repo-root requires one non-option path");
      parsed.repoRoot = value;
      continue;
    }
    cliFailure(`unknown argument: ${arg}`);
  }
  return parsed;
}

function cliFailure(message) {
  console.error(JSON.stringify({
    ok: false,
    error: { code: "wakeflow-sync-core-argv", message },
  }));
  process.exit(64);
}

function portableRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function lstatOrNull(file, options = undefined) {
  try {
    return lstatSync(file, options);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertRealDirectory(directory, label) {
  const stat = lstatOrNull(directory);
  if (!stat) throw new Error(`${label} is missing`);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be one real directory, not a symbolic link or special entry`);
  }
}

/**
 * 逐层验证目标目录链。同步模式只创建缺失的真实目录；任何已存在的链接或特殊
 * 节点都会失败关闭，避免 mkdir/read/write 经由宿主层链接逃出插件制品。
 */
function ensureRealDirectoryUnder(root, relative, { create }) {
  assertRealDirectory(root, portableRelative(repoRoot, root) || "repository root");
  const normalized = relative === "." ? "" : relative.split(path.sep).join("/");
  const parts = normalized.split("/").filter(Boolean);
  let current = root;
  for (const part of parts) {
    if (part === "." || part === "..") throw new Error(`unsafe directory component: ${relative}`);
    current = path.join(current, part);
    let stat = lstatOrNull(current);
    if (!stat) {
      if (!create) return false;
      try {
        mkdirSync(current);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      stat = lstatOrNull(current);
    }
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${portableRelative(repoRoot, current)} must be one real directory`);
    }
  }
  return true;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

/** 读取一个稳定的单链接普通文件；路径、打开句柄或内容读取期间发生替换即失败。 */
function readStableRegularFile(file, { allowMissing = false, label, maxBytes = MAX_SYNC_FILE_BYTES } = {}) {
  const before = lstatOrNull(file, { bigint: true });
  if (!before) {
    if (allowMissing) return null;
    throw new Error(`${label} is missing`);
  }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n) {
    throw new Error(`${label} must be one regular non-symlink single-link file`);
  }
  if (before.size > BigInt(maxBytes)) throw new Error(`${label} exceeds ${maxBytes} bytes`);

  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFileIdentity(before, opened)) {
      throw new Error(`${label} changed before it could be read`);
    }
    const bytes = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatOrNull(file, { bigint: true });
    if (!afterPath || !sameFileIdentity(opened, afterRead) || !sameFileIdentity(opened, afterPath)) {
      throw new Error(`${label} changed while it was being read`);
    }
    return { bytes, mode: Number(opened.mode & 0o777n) };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function inspectWritableDestination(file, label) {
  const stat = lstatOrNull(file, { bigint: true });
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1n) {
    throw new Error(`${label} must be one regular non-symlink single-link file before replacement`);
  }
}

/** 同目录临时文件 + rename，永不通过已有 destination inode 原地覆盖。 */
function writeAtomicFile(file, bytes, mode, label) {
  inspectWritableDestination(file, label);
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.wakeflow-sync-${process.pid}-${temporarySequence += 1}`,
  );
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      mode,
    );
    writeFileSync(descriptor, bytes);
    fchmodSync(descriptor, mode);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
}

function removeManagedFile(file, label) {
  inspectWritableDestination(file, label);
  unlinkSync(file);
}

function boundedDirectoryEntries(directory) {
  const entries = [];
  let handle;
  try {
    handle = opendirSync(directory);
    while (true) {
      const entry = handle.readSync();
      if (entry === null) break;
      entries.push(entry);
      if (entries.length > MAX_CORE_ENTRIES) {
        throw new Error(`core directory exceeds ${MAX_CORE_ENTRIES} entries`);
      }
    }
  } finally {
    handle?.closeSync();
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function listCoreFiles(directory = coreRoot, state = { entries: 0 }) {
  const files = [];
  for (const entry of boundedDirectoryEntries(directory)) {
    if (entry.name === ".DS_Store") continue;
    state.entries += 1;
    if (state.entries > MAX_CORE_ENTRIES) {
      throw new Error(`core tree exceeds ${MAX_CORE_ENTRIES} entries`);
    }
    const absolute = path.join(directory, entry.name);
    const relative = portableRelative(coreRoot, absolute);
    if (entry.isSymbolicLink()) throw new Error(`core/${relative} cannot be a symbolic link`);
    if (entry.isDirectory()) {
      if (relative === TEMPLATE_SOURCE_DIRECTORY) continue;
      files.push(...listCoreFiles(absolute, state));
    } else if (entry.isFile()) {
      if (HOST_LOCAL_CORE_FILES.has(relative)) continue;
      files.push(relative);
    } else {
      throw new Error(`core/${relative} has an unsupported filesystem type`);
    }
  }
  return files.sort();
}

function validManagedPath(relative) {
  return typeof relative === "string"
    && Boolean(relative)
    && relative === relative.trim()
    && !relative.includes("\\")
    && !relative.includes("\0")
    && !path.posix.isAbsolute(relative)
    && path.posix.normalize(relative) === relative
    && relative.split("/").every((part) => part && part !== "." && part !== "..");
}

function knownSharedManagedPath(relative) {
  if (HOST_PROTECTED_FILES.has(relative)) return false;
  if (relative.startsWith(".codex-plugin/") || relative.startsWith(".claude-plugin/")) return false;
  if (relative.startsWith("commands/") || relative.startsWith("schemas/wakeflow-claude-host/")) return false;
  if (/^scripts\/lib\/wakeflow-(?:codex|claude)-/u.test(relative)) return false;
  if (relative.startsWith("skills/wakeflow-controller/") || relative.startsWith("skills/wakeflow-target/")) return false;
  return relative === "LICENSE"
    || relative === "wakeflow.config.json"
    || relative === "wakeflow.config.example.json"
    || /^assets\/wakeflow-[^/]+$/u.test(relative)
    || /^bin\/wakeflow-[^/]+$/u.test(relative)
    || /^lib\/wakeflow-[^/]+\.mjs$/u.test(relative)
    || relative === "mcp/server.cjs"
    || /^schemas\/wakeflow-[^/]+\/.+/u.test(relative)
    || relative === "schemas/wakeflow-config.schema.json"
    || /^scripts\/wakeflow-[^/]+\.mjs$/u.test(relative)
    || /^scripts\/lib\/wakeflow-[^/]+\.mjs$/u.test(relative)
    || /^scripts\/data\/wakeflow-[^/]+\.json$/u.test(relative)
    || /^skills\/wakeflow-(?:design|test|target-craft)\//u.test(relative)
    || /^skills\/wakeflow-governance\/references\/[^/]+\.md$/u.test(relative);
}

function readManagedManifest(targetRoot) {
  const file = path.join(targetRoot, CORE_MANIFEST);
  try {
    const record = readStableRegularFile(file, {
      allowMissing: true,
      label: portableRelative(repoRoot, file),
      maxBytes: MAX_MANIFEST_BYTES,
    });
    if (!record) {
      return { file, value: null, missing: true, issue: `${portableRelative(repoRoot, file)} is missing` };
    }
    const value = JSON.parse(record.bytes.toString("utf8"));
    if (value?.schemaVersion !== 1 || value?.source !== "core" || !Array.isArray(value.files)) {
      return { file, value: null, missing: false, issue: `${portableRelative(repoRoot, file)} has an invalid shape` };
    }
    if (value.files.some((relative) => !validManagedPath(relative)) || new Set(value.files).size !== value.files.length) {
      return { file, value: null, missing: false, issue: `${portableRelative(repoRoot, file)} contains an unsafe or duplicate managed path` };
    }
    return { file, value, missing: false, issue: null };
  } catch (error) {
    return {
      file,
      value: null,
      missing: false,
      issue: `${portableRelative(repoRoot, file)} is unreadable: ${error.message}`,
    };
  }
}

function expectedManifest(coreFiles) {
  return {
    schemaVersion: 1,
    source: "core",
    files: coreFiles,
  };
}

function emitResult({ coreFiles = [], issues, copied = 0, materialized = 0 }) {
  const payload = {
    ok: issues.length === 0,
    mode: check ? "check" : "sync",
    coreFiles: coreFiles.length,
    targets: TARGETS.map((target) => target.dir),
    copied: check ? undefined : copied,
    materialized: check ? undefined : materialized,
    assetBundle: WAKEFLOW_ASSET_BUNDLE_RELATIVE_PATH,
    issues,
  };
  if (issues.length > 0) {
    console.error(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}

function runSyncCore() {
  const issues = [];
  let coreFiles = [];
  const coreRecords = new Map();
  let copied = 0;
  let materialized = 0;
  let assetBundleBytes;

  try {
    assertRealDirectory(repoRoot, "repository root");
    assertRealDirectory(coreRoot, "core/");
    coreFiles = listCoreFiles();
    for (const relative of coreFiles) {
      coreRecords.set(relative, readStableRegularFile(path.join(coreRoot, relative), {
        label: `core/${relative}`,
      }));
    }
  } catch (error) {
    issues.push(error.message);
    emitResult({ coreFiles, issues, copied, materialized });
    return;
  }

  try {
    assetBundleBytes = buildWakeflowAssetBundleBytes({
      sourceRoot: path.join(coreRoot, TEMPLATE_SOURCE_DIRECTORY),
    });
  } catch (error) {
    issues.push(`core/${TEMPLATE_SOURCE_DIRECTORY} cannot build the install asset bundle: ${error.message}`);
  }

  if (assetBundleBytes) for (const target of TARGETS) {
    const targetRoot = path.join(repoRoot, target.dir);
    try {
      const targetReady = ensureRealDirectoryUnder(repoRoot, target.dir, { create: !check });
      if (!targetReady) {
        issues.push(`${target.dir}: target artifact directory is missing`);
        continue;
      }
    } catch (error) {
      issues.push(`${target.dir}: ${error.message}`);
      continue;
    }

    const managed = readManagedManifest(targetRoot);
    if (managed.issue && (check || !managed.missing)) issues.push(managed.issue);

    const stale = (managed.value?.files ?? []).filter((relative) => !coreFiles.includes(relative));
    for (const relative of stale) {
      const destination = path.join(targetRoot, relative);
      const label = `${target.dir}/${relative}`;
      try {
        const parentReady = ensureRealDirectoryUnder(targetRoot, path.posix.dirname(relative), { create: false });
        if (!parentReady || !lstatOrNull(destination)) continue;
        if (!knownSharedManagedPath(relative)) {
          issues.push(`${label} is protected from stale-manifest deletion because it is not a known shared-core path`);
          continue;
        }
        if (check) {
          issues.push(`${label} is a stale core-managed file`);
        } else {
          removeManagedFile(destination, label);
        }
      } catch (error) {
        issues.push(`${label} cannot be removed safely: ${error.message}`);
      }
    }

    if (check) {
      const expected = JSON.stringify(expectedManifest(coreFiles));
      const actual = managed.value ? JSON.stringify(managed.value) : null;
      if (managed.value && actual !== expected) {
        issues.push(`${target.dir}/${CORE_MANIFEST} does not match the current core file set`);
      }
    }

    for (const relative of coreFiles) {
      const destination = path.join(targetRoot, relative);
      const label = `${target.dir}/${relative}`;
      const sourceRecord = coreRecords.get(relative);
      try {
        const parentReady = ensureRealDirectoryUnder(targetRoot, path.posix.dirname(relative), { create: !check });
        const destinationRecord = parentReady
          ? readStableRegularFile(destination, { allowMissing: true, label })
          : null;
        if (destinationRecord?.bytes.equals(sourceRecord.bytes) && destinationRecord.mode === sourceRecord.mode) continue;
        if (check) {
          issues.push(`${label} drifts from core/${relative}`);
          continue;
        }
        writeAtomicFile(destination, sourceRecord.bytes, sourceRecord.mode, label);
        copied += 1;
      } catch (error) {
        issues.push(`${label} cannot be synchronized safely: ${error.message}`);
      }
    }

    if (assetBundleBytes) {
      const destination = path.join(targetRoot, WAKEFLOW_ASSET_BUNDLE_RELATIVE_PATH);
      const label = `${target.dir}/${WAKEFLOW_ASSET_BUNDLE_RELATIVE_PATH}`;
      try {
        const parentReady = ensureRealDirectoryUnder(
          targetRoot,
          path.posix.dirname(WAKEFLOW_ASSET_BUNDLE_RELATIVE_PATH),
          { create: !check },
        );
        const current = parentReady
          ? readStableRegularFile(destination, { allowMissing: true, label })
          : null;
        if (!current?.bytes.equals(assetBundleBytes) || current.mode !== 0o644) {
          if (check) {
            issues.push(`${label} drifts from core/${TEMPLATE_SOURCE_DIRECTORY}`);
          } else {
            writeAtomicFile(destination, assetBundleBytes, 0o644, label);
            materialized += 1;
          }
        }
      } catch (error) {
        issues.push(`${label} cannot be materialized safely: ${error.message}`);
      }
    }

    for (const relative of HOST_CONTRACT_FILES(target)) {
      const required = path.join(targetRoot, relative);
      const label = `${target.dir}/${relative}`;
      try {
        const parentReady = ensureRealDirectoryUnder(targetRoot, path.posix.dirname(relative), { create: false });
        const stat = parentReady ? lstatOrNull(required, { bigint: true }) : null;
        if (!stat) {
          issues.push(`${label} is missing (host contract file)`);
        } else if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1n) {
          issues.push(`${label} must be one regular non-symlink single-link host contract file`);
        }
      } catch (error) {
        issues.push(`${label} cannot be inspected safely: ${error.message}`);
      }
    }

    if (!check) {
      const manifestBytes = Buffer.from(`${JSON.stringify(expectedManifest(coreFiles), null, 2)}\n`);
      const label = `${target.dir}/${CORE_MANIFEST}`;
      try {
        ensureRealDirectoryUnder(targetRoot, path.posix.dirname(CORE_MANIFEST), { create: true });
        writeAtomicFile(managed.file, manifestBytes, 0o644, label);
      } catch (error) {
        issues.push(`${label} cannot be written safely: ${error.message}`);
      }
    }
  }

  emitResult({ coreFiles, issues, copied, materialized });
}

runSyncCore();
