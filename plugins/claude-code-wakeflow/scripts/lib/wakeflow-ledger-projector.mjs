/**
 * durable ledger 的唯一 Markdown 投影 owner。
 *
 * 本文件严格枚举 records owner 已定义的三类 immutable authority，确定性渲染四个
 * index，并以独立 ledger 锁和原子文件写入修复投影。索引只是导航视图：投影失败不会
 * 回滚已提交 record，也不能由索引存在推断 requirement、confirmation 或 archive 有效。
 *
 * 阅读地图：build/inspect 入口负责零写入来源快照；writeLedgerProjection 负责四文件
 * 收敛；commitLedgerRecordAndProject 只组合“先 authority、后 projection”的既有顺序。
 */
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

import { atomicWriteFile, sha256Bytes } from "./wakeflow-atomic-write.mjs";
import { canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  createLedgerRecord,
  ledgerMutationLockPath,
  loadLedgerRecord,
} from "./wakeflow-ledger-records.mjs";
import { withFileLock } from "./wakeflow-state-lock.mjs";

export const LEDGER_PROJECTION_PATHS = Object.freeze([
  "requirement-designs/index.md",
  "goal-stage-confirmation/index.md",
  "workspace/workspace-record-map.md",
  "workspace/archive/index.md",
]);

const YEAR_MONTH_RE = /^[0-9]{4}-(?:0[1-9]|1[0-2])$/u;
const UNSAFE_HUMAN_TEXT_CONTROL_RE = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const LEDGER_AUTHORITY_DIRECTORY_MODE = 0o755;
const LEDGER_PROJECTION_MODE = 0o644;
const MAX_LEDGER_PROJECTION_BYTES = 256 * 1024 * 1024;
const ATOMIC_STAGE_SUFFIX_RE = /^(?:0|[1-9][0-9]*)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

// ==================== 一、输入准入与投影文件物理信任 ====================

/**
 * projector 的稳定领域错误；changed 等诊断只描述投影，不改变 record 提交结论。
 */
export class WakeflowLedgerProjectionError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowLedgerProjectionError";
    this.code = code;
    this.path = errorPath;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, errorPath, message, details = {}, cause = undefined) {
  throw new WakeflowLedgerProjectionError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
    cause,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function passiveDataObject(value, { allowed, required = allowed, label = "$options" }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-ledger-input", label, `${label} must be one passive plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-ledger-input", label, `${label} must be one passive plain object`);
  }
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      fail("wakeflow-ledger-input", label, `${label} has an invalid field set`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-ledger-input", `${label}/${String(key)}`, `${label} fields must be enumerable data properties`);
    }
    result[key] = descriptor.value;
  }
  for (const key of required) {
    if (!Object.hasOwn(result, key)) {
      fail("wakeflow-ledger-input", `${label}/${key}`, `${label} is missing ${key}`);
    }
  }
  return result;
}

function statMode(stat) {
  return Number(stat.mode & (typeof stat.mode === "bigint" ? 0o777n : 0o777));
}

function statHasSingleLink(stat) {
  return stat.nlink === (typeof stat.nlink === "bigint" ? 1n : 1);
}

function assertCurrentOwner(stat, errorPath, label) {
  if (typeof process.geteuid !== "function") return;
  const expected = typeof stat.uid === "bigint" ? BigInt(process.geteuid()) : process.geteuid();
  if (stat.uid !== expected) {
    fail("wakeflow-ledger-owner", errorPath, `${label} must belong to the current effective user`);
  }
}

function assertAuthorityDirectoryStat(stat, errorPath, candidate, { checkMode = true } = {}) {
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-ledger-path-type", errorPath, `ledger directory must be one real directory: ${candidate}`);
  }
  assertCurrentOwner(stat, errorPath, "ledger directory");
  if (checkMode && process.platform !== "win32" && statMode(stat) !== LEDGER_AUTHORITY_DIRECTORY_MODE) {
    fail("wakeflow-ledger-mode", errorPath, `ledger authority directory must use mode 0755: ${candidate}`);
  }
}

function inspectDirectory(candidate, errorPath, options = {}) {
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch (cause) {
    fail("wakeflow-ledger-path-type", errorPath, `required ledger directory is missing: ${candidate}`, {}, cause);
  }
  if (stat.isSymbolicLink()) fail("wakeflow-ledger-symlink", errorPath, `ledger directory cannot be a symlink: ${candidate}`);
  assertAuthorityDirectoryStat(stat, errorPath, candidate, options);
  return candidate;
}

function assertProjectionFileStat(stat, errorPath, candidate) {
  if (stat.isSymbolicLink()) fail("wakeflow-ledger-symlink", errorPath, `projection cannot be a symlink: ${candidate}`);
  if (!stat.isFile()) fail("wakeflow-ledger-path-type", errorPath, `projection must be a regular file: ${candidate}`);
  assertCurrentOwner(stat, errorPath, "ledger projection");
  if (!statHasSingleLink(stat)) {
    fail("wakeflow-ledger-hardlink", errorPath, `projection must have exactly one filesystem link: ${candidate}`);
  }
  if (process.platform !== "win32" && statMode(stat) !== LEDGER_PROJECTION_MODE) {
    fail(
      "wakeflow-ledger-mode",
      errorPath,
      `projection must use mode 0644: ${candidate}`,
      { mode: statMode(stat) },
    );
  }
}

function sameProjectionSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

// 只确认已知投影节点是稳定的单链接普通文件，不把它的内容当作 authority source。
function inspectKnownProjection(candidate, errorPath) {
  let before;
  try {
    before = lstatSync(candidate, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  assertProjectionFileStat(before, errorPath, candidate);
  let descriptor;
  try {
    descriptor = openSync(candidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    if (cause?.code === "ELOOP") fail("wakeflow-ledger-symlink", errorPath, `projection cannot be a symlink: ${candidate}`, {}, cause);
    fail("wakeflow-ledger-projection-race", errorPath, `projection changed before safe inspection: ${candidate}`, {}, cause);
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    assertProjectionFileStat(opened, errorPath, candidate);
    if (!sameProjectionSnapshot(before, opened)) {
      fail("wakeflow-ledger-projection-race", errorPath, `projection changed while opening: ${candidate}`);
    }
    if (opened.size > BigInt(MAX_LEDGER_PROJECTION_BYTES)) {
      fail("wakeflow-ledger-size", errorPath, `projection exceeds the supported capacity: ${candidate}`);
    }
    let after;
    try {
      after = lstatSync(candidate, { bigint: true });
    } catch (cause) {
      fail("wakeflow-ledger-projection-race", errorPath, `projection changed during inspection: ${candidate}`, {}, cause);
    }
    assertProjectionFileStat(after, errorPath, candidate);
    if (!sameProjectionSnapshot(opened, after)) {
      fail("wakeflow-ledger-projection-race", errorPath, `projection changed during inspection: ${candidate}`);
    }
    return Object.freeze({
      dev: after.dev,
      ino: after.ino,
      uid: after.uid,
      gid: after.gid,
      mode: after.mode,
      nlink: after.nlink,
      size: after.size,
      mtimeNs: after.mtimeNs,
      ctimeNs: after.ctimeNs,
    });
  } finally {
    closeSync(descriptor);
  }
}

// 冻结 stage 的完整父链，避免恢复删除跨越 symlink、owner 或 inode 替换。
function projectionParentChain(ledgerRoot, target, errorPath) {
  const lexicalRoot = path.resolve(ledgerRoot);
  const parent = path.dirname(path.resolve(target));
  const relative = path.relative(lexicalRoot, parent);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail("wakeflow-ledger-path", errorPath, "projection stage parent must stay below ledgerRoot");
  }
  const rootStat = lstatSync(lexicalRoot, { bigint: true });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail("wakeflow-ledger-path-type", errorPath, "projection ledgerRoot must be one real directory");
  }
  assertCurrentOwner(rootStat, errorPath, "projection ledgerRoot");
  const chain = [{
    candidate: lexicalRoot,
    dev: rootStat.dev,
    ino: rootStat.ino,
    uid: rootStat.uid,
    gid: rootStat.gid,
    mode: rootStat.mode,
    realPath: realpathSync(lexicalRoot),
  }];
  let candidate = lexicalRoot;
  let expectedReal = chain[0].realPath;
  for (const segment of relative.split(path.sep)) {
    candidate = path.join(candidate, segment);
    expectedReal = path.join(expectedReal, segment);
    const stat = lstatSync(candidate, { bigint: true });
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || (process.platform !== "win32" && statMode(stat) !== LEDGER_AUTHORITY_DIRECTORY_MODE)
      || realpathSync(candidate) !== expectedReal
    ) {
      fail("wakeflow-ledger-symlink", errorPath, "projection stage parent chain is unsafe");
    }
    assertCurrentOwner(stat, errorPath, "projection parent");
    chain.push({
      candidate,
      dev: stat.dev,
      ino: stat.ino,
      uid: stat.uid,
      gid: stat.gid,
      mode: stat.mode,
      realPath: expectedReal,
    });
  }
  return chain;
}

function assertProjectionParentChain(chain, errorPath) {
  for (const entry of chain) {
    const stat = lstatSync(entry.candidate, { bigint: true });
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || stat.dev !== entry.dev
      || stat.ino !== entry.ino
      || stat.uid !== entry.uid
      || stat.gid !== entry.gid
      || stat.mode !== entry.mode
      || realpathSync(entry.candidate) !== entry.realPath
    ) {
      fail("wakeflow-ledger-projection-race", errorPath, "projection stage parent changed during recovery");
    }
  }
}

// 只消费一个可归属到精确投影目标的安全 atomic stage；模糊或不安全 residue 保留并阻断。
function recoverInterruptedProjectionStages(ledgerRoot) {
  for (const relative of LEDGER_PROJECTION_PATHS) {
    const target = path.join(ledgerRoot, ...relative.split("/"));
    const errorPath = `$projection-stage/${relative}`;
    const chain = projectionParentChain(ledgerRoot, target, errorPath);
    assertProjectionParentChain(chain, errorPath);
    const prefix = `.${path.basename(target)}.wakeflow-stage-`;
    const stages = sortedEntries(path.dirname(target))
      .filter((entry) => entry.name.startsWith(prefix) && ATOMIC_STAGE_SUFFIX_RE.test(entry.name.slice(prefix.length)))
      .map((entry) => path.join(path.dirname(target), entry.name));
    if (stages.length > 1) {
      fail("wakeflow-ledger-projection-stale", errorPath, "projection target has more than one interrupted atomic stage");
    }
    if (stages.length === 0) continue;
    const stage = stages[0];
    const identity = inspectKnownProjection(stage, errorPath);
    assertProjectionParentChain(chain, errorPath);
    const before = lstatSync(stage, { bigint: true });
    if (!identity || !sameProjectionSnapshot(before, identity)) {
      fail("wakeflow-ledger-projection-race", errorPath, "projection stage changed before cleanup");
    }
    unlinkSync(stage);
    assertProjectionParentChain(chain, errorPath);
  }
}

function sortedEntries(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => lexicalCompare(left.name, right.name));
}

function rejectUnknown(entry, errorPath) {
  if (entry.isSymbolicLink()) fail("wakeflow-ledger-symlink", errorPath, `ledger inventory cannot contain symlink ${entry.name}`);
  fail("wakeflow-ledger-unknown-entry", errorPath, `unknown ledger inventory entry ${entry.name}`);
}

// ==================== 二、三类 authority 的完整 inventory ====================

function scanRecordDomain({ ledgerRoot, directory, family, indexFile, programId }) {
  const records = [];
  for (const entry of sortedEntries(directory)) {
    const entryPath = path.join(directory, entry.name);
    const logicalPath = `$inventory/${family}/${entry.name}`;
    if (entry.name === indexFile) {
      inspectKnownProjection(entryPath, logicalPath);
      continue;
    }
    if (!entry.isDirectory()) rejectUnknown(entry, logicalPath);
    const expectedType = family === "requirement" ? "requirement" : "confirmation";
    try {
      assertWakeflowId(entry.name, expectedType, logicalPath);
    } catch (cause) {
      fail("wakeflow-ledger-unknown-entry", logicalPath, `${family} inventory directory must use a typed ID`, {}, cause);
    }
    records.push(loadLedgerRecord({
      ledgerRoot,
      root: entryPath,
      expectedFamily: family,
      expectedProgramId: programId,
    }));
  }
  return records.sort((left, right) => lexicalCompare(left.recordId, right.recordId));
}

function scanArchiveDomain({ ledgerRoot, archiveRoot, programId }) {
  const records = [];
  const recordOwners = new Map();
  const demandOwners = new Map();
  for (const entry of sortedEntries(archiveRoot)) {
    const entryPath = path.join(archiveRoot, entry.name);
    const logicalPath = `$inventory/archive/${entry.name}`;
    if (entry.name === "index.md") {
      inspectKnownProjection(entryPath, logicalPath);
      continue;
    }
    if (!entry.isDirectory() || !YEAR_MONTH_RE.test(entry.name)) rejectUnknown(entry, logicalPath);
    const monthStat = lstatSync(entryPath);
    assertCurrentOwner(monthStat, logicalPath, "archive month");
    if (
      monthStat.isSymbolicLink()
      || !monthStat.isDirectory()
      || (process.platform !== "win32" && (monthStat.mode & 0o777) !== LEDGER_AUTHORITY_DIRECTORY_MODE)
    ) {
      fail("wakeflow-ledger-mode", logicalPath, `archive month ${entry.name} must be one 0755 authority directory`);
    }
    const archiveEntries = sortedEntries(entryPath);
    if (archiveEntries.length === 0) {
      fail("wakeflow-ledger-unknown-entry", logicalPath, `empty archive month ${entry.name} is orphan residue`);
    }
    for (const archiveEntry of archiveEntries) {
      const archivePath = path.join(entryPath, archiveEntry.name);
      const archiveLogicalPath = `${logicalPath}/${archiveEntry.name}`;
      if (!archiveEntry.isDirectory()) rejectUnknown(archiveEntry, archiveLogicalPath);
      try {
        assertWakeflowId(archiveEntry.name, "archive", archiveLogicalPath);
      } catch (cause) {
        fail("wakeflow-ledger-unknown-entry", archiveLogicalPath, "archive inventory directory must use a typed ID", {}, cause);
      }
      const loaded = loadLedgerRecord({
        ledgerRoot,
        root: archivePath,
        expectedFamily: "archive",
        expectedProgramId: programId,
      });
      const previousRecord = recordOwners.get(loaded.recordId);
      if (previousRecord && previousRecord.relativeRoot !== loaded.relativeRoot) {
        fail(
          "wakeflow-ledger-record-conflict",
          "$inventory/archive",
          `archive ID ${loaded.recordId} exists at more than one canonical authority root`,
        );
      }
      recordOwners.set(loaded.recordId, loaded);
      if (loaded.record.archiveKind === "demand") {
        const demandId = loaded.record.source.demandId;
        const previousDemand = demandOwners.get(demandId);
        if (previousDemand && previousDemand.relativeRoot !== loaded.relativeRoot) {
          fail(
            "wakeflow-ledger-record-conflict",
            "$inventory/archive",
            `demand ${demandId} has more than one immutable archive authority`,
          );
        }
        demandOwners.set(demandId, loaded);
      }
      records.push(loaded);
    }
  }
  return records.sort((left, right) => (
    lexicalCompare(left.record.yearMonth, right.record.yearMonth)
    || lexicalCompare(left.recordId, right.recordId)
  ));
}

// 只接受五个协议目录、四个已知投影和三类 record；任意额外节点都会使投影失败关闭。
function scanLedgerInventory({ ledgerRoot, programId }) {
  assertWakeflowId(programId, "program", "$programId");
  const root = path.resolve(ledgerRoot);
  inspectDirectory(root, "$ledgerRoot", { checkMode: false });
  const expectedRootEntries = new Set([
    "requirement-designs",
    "goal-stage-confirmation",
    "workspace",
  ]);
  for (const entry of sortedEntries(root)) {
    if (!expectedRootEntries.has(entry.name)) rejectUnknown(entry, `$inventory/${entry.name}`);
    if (!entry.isDirectory()) rejectUnknown(entry, `$inventory/${entry.name}`);
  }
  const requirementsRoot = inspectDirectory(path.join(root, "requirement-designs"), "$inventory/requirement-designs");
  const confirmationsRoot = inspectDirectory(path.join(root, "goal-stage-confirmation"), "$inventory/goal-stage-confirmation");
  const workspaceRoot = inspectDirectory(path.join(root, "workspace"), "$inventory/workspace");
  const archiveRoot = inspectDirectory(path.join(workspaceRoot, "archive"), "$inventory/workspace/archive");
  for (const entry of sortedEntries(workspaceRoot)) {
    const entryPath = path.join(workspaceRoot, entry.name);
    if (entry.name === "workspace-record-map.md") {
      inspectKnownProjection(entryPath, "$inventory/workspace/workspace-record-map.md");
    } else if (entry.name !== "archive") {
      rejectUnknown(entry, `$inventory/workspace/${entry.name}`);
    } else if (!entry.isDirectory()) {
      rejectUnknown(entry, "$inventory/workspace/archive");
    }
  }
  return {
    requirements: scanRecordDomain({
      ledgerRoot: root,
      directory: requirementsRoot,
      family: "requirement",
      indexFile: "index.md",
      programId,
    }),
    confirmations: scanRecordDomain({
      ledgerRoot: root,
      directory: confirmationsRoot,
      family: "confirmation",
      indexFile: "index.md",
      programId,
    }),
    archives: scanArchiveDomain({ ledgerRoot: root, archiveRoot, programId }),
  };
}

// ==================== 三、确定性 Markdown 渲染 ====================

// 人类文本进入 Markdown 表格前同时转义原始 HTML、链接定界符、代码符号和单元格分隔符。
function cell(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("`", "&#96;")
    .replaceAll("[", "&#91;")
    .replaceAll("]", "&#93;")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\r\n?|\n/gu, "<br>");
}

function markdown(parts) {
  return `${parts.join("\n").replace(/\s+$/u, "")}\n`;
}

function renderRequirementIndex(records) {
  return markdown([
    "# Requirement Designs",
    "",
    "<!-- wakeflow:ledger-projection:v1:requirement-designs -->",
    "",
    "| Requirement ID | Title | Status | Related Demands | Record |",
    "| --- | --- | --- | --- | --- |",
    ...records.map(({ record, recordId }) => (
      `| \`${recordId}\` | ${cell(record.title)} | ${record.status} | ${(record.relatedDemandIds ?? []).map((id) => `\`${id}\``).join("<br>")} | [record](${recordId}/record.json) |`
    )),
  ]);
}

function renderConfirmationIndex(records) {
  return markdown([
    "# Goal And Stage Confirmations",
    "",
    "<!-- wakeflow:ledger-projection:v1:goal-stage-confirmation -->",
    "",
    "| Confirmation ID | Demand ID | Title | Status | Record |",
    "| --- | --- | --- | --- | --- |",
    ...records.map(({ record, recordId }) => (
      `| \`${recordId}\` | \`${record.demandId}\` | ${cell(record.title)} | ${record.status} | [record](${recordId}/record.json) |`
    )),
  ]);
}

function renderArchiveIndex(records) {
  return markdown([
    "# Workspace Archive",
    "",
    "<!-- wakeflow:ledger-projection:v1:workspace-archive -->",
    "",
    "| Month | Archive ID | Type | Title | Conclusion | Transport | Record |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...records.map(({ record, recordId }) => (
      `| ${record.yearMonth} | \`${recordId}\` | ${record.archiveKind} | ${cell(record.title)} | ${cell(record.conclusion)} | ${record.transport.status} | [manifest](${record.yearMonth}/${recordId}/archive-manifest.json) |`
    )),
  ]);
}

function renderRecordMap({ programId, programDisplayName, requirements, confirmations, archives }) {
  const todoArchives = archives.filter(({ record }) => (
    record.members.some((member) => member.role === "todo-history")
  ));
  return markdown([
    "# Workspace Record Map",
    "",
    "<!-- wakeflow:ledger-projection:v1:workspace-record-map -->",
    "",
    `Program: \`${programId}\``,
    `Display Name: ${cell(programDisplayName)}`,
    "",
    "## Record Domains",
    "",
    "| Domain | Index | Record Count |",
    "| --- | --- | --- |",
    `| Requirement Designs | [index](../requirement-designs/index.md) | ${requirements.length} |`,
    `| Goal And Stage Confirmations | [index](../goal-stage-confirmation/index.md) | ${confirmations.length} |`,
    `| Archive | [index](archive/index.md) | ${archives.length} |`,
    "",
    "## TODO History",
    "",
    "| Archive ID | Title | Manifest |",
    "| --- | --- | --- |",
    ...todoArchives.map(({ record, recordId }) => (
      `| \`${recordId}\` | ${cell(record.title)} | [manifest](archive/${record.yearMonth}/${recordId}/archive-manifest.json) |`
    )),
    "",
    "## Archive",
    "",
    `The archive index contains ${archives.length} strict archive manifest${archives.length === 1 ? "" : "s"}: [open archive index](archive/index.md).`,
  ]);
}

function assertProgramPresentation({ programId, programDisplayName }) {
  if (
    typeof programDisplayName !== "string"
    || !programDisplayName
    || programDisplayName !== programDisplayName.trim()
    || UNSAFE_HUMAN_TEXT_CONTROL_RE.test(programDisplayName)
  ) {
    fail(
      "wakeflow-ledger-program",
      "$programDisplayName",
      "programDisplayName may contain line breaks but must otherwise be control-free, non-empty, and already trimmed",
    );
  }
  assertWakeflowId(programId, "program", "$programId");
}

// 四个文件与 sourceDigest 来自同一已排序 inventory，不加入时间戳或宿主 locale。
function buildProjectionFromInventory({ programId, programDisplayName, inventory }) {
  assertProgramPresentation({ programId, programDisplayName });
  const files = {
    "requirement-designs/index.md": renderRequirementIndex(inventory.requirements),
    "goal-stage-confirmation/index.md": renderConfirmationIndex(inventory.confirmations),
    "workspace/workspace-record-map.md": renderRecordMap({
      programId,
      programDisplayName,
      ...inventory,
    }),
    "workspace/archive/index.md": renderArchiveIndex(inventory.archives),
  };
  for (const [relative, content] of Object.entries(files)) {
    if (Buffer.byteLength(content, "utf8") > MAX_LEDGER_PROJECTION_BYTES) {
      fail(
        "wakeflow-ledger-size",
        `$projection/${relative}`,
        "generated ledger projection exceeds the supported capacity",
        { maximumBytes: MAX_LEDGER_PROJECTION_BYTES },
      );
    }
  }
  const sourceDigest = canonicalJsonDigest({
    program: { programId, displayName: programDisplayName },
    requirements: inventory.requirements.map(({ recordId, recordDigest }) => ({ recordId, recordDigest })),
    confirmations: inventory.confirmations.map(({ recordId, recordDigest }) => ({ recordId, recordDigest })),
    archives: inventory.archives.map(({ recordId, recordDigest }) => ({ recordId, recordDigest })),
  });
  return deepFreeze({
    kind: "WakeflowLedgerProjection",
    schemaVersion: 1,
    programId,
    sourceDigest,
    files,
    counts: {
      requirements: inventory.requirements.length,
      requirementDocuments: inventory.requirements.reduce(
        (count, entry) => count + entry.members.length,
        0,
      ),
      confirmations: inventory.confirmations.length,
      confirmationDocuments: inventory.confirmations.reduce(
        (count, entry) => count + entry.members.length,
        0,
      ),
      archives: inventory.archives.length,
      archivePayloads: inventory.archives.reduce(
        (count, entry) => count + entry.members.length,
        0,
      ),
    },
  });
}

function buildLedgerProjectionUnlocked({ ledgerRoot, programId, programDisplayName }) {
  assertProgramPresentation({ programId, programDisplayName });
  const inventory = scanLedgerInventory({ ledgerRoot, programId });
  return buildProjectionFromInventory({ programId, programDisplayName, inventory });
}

// ==================== 四、零写入构建、物理收敛与提交组合 ====================

/**
 * 为 fresh initialization 构造同一 renderer 的空 inventory 投影；它不创建目录或文件。
 */
export function buildEmptyLedgerProjection(input = {}) {
  const { programId, programDisplayName } = passiveDataObject(input, {
    allowed: ["programId", "programDisplayName"],
  });
  return buildProjectionFromInventory({
    programId,
    programDisplayName,
    inventory: { requirements: [], confirmations: [], archives: [] },
  });
}

/**
 * 无副作用地连续扫描两次严格 authority，只有来源摘要和四文件字节一致才返回快照。
 */
export function inspectLedgerProjectionSource(options = {}) {
  const values = passiveDataObject(options, {
    allowed: ["ledgerRoot", "programId", "programDisplayName"],
  });
  const root = path.resolve(values.ledgerRoot);
  inspectDirectory(root, "$ledgerRoot", { checkMode: false });
  const first = buildLedgerProjectionUnlocked({ ...values, ledgerRoot: root });
  const second = buildLedgerProjectionUnlocked({ ...values, ledgerRoot: root });
  if (
    first.sourceDigest !== second.sourceDigest
    || canonicalJsonDigest(first.files) !== canonicalJsonDigest(second.files)
  ) {
    fail("wakeflow-ledger-projection-race", "$projection", "ledger authority changed during projection inspection");
  }
  return first;
}

/**
 * 在 ledger 锁内从当前 immutable authority 构建四个投影字节，但不改写任何目标文件。
 */
export function buildLedgerProjection(options = {}) {
  const values = passiveDataObject(options, {
    allowed: ["ledgerRoot", "programId", "programDisplayName"],
  });
  const root = path.resolve(values.ledgerRoot);
  inspectDirectory(root, "$ledgerRoot", { checkMode: false });
  return withFileLock(ledgerMutationLockPath(root), () => buildLedgerProjectionUnlocked({ ...values, ledgerRoot: root }));
}

// 写入前读取当前 target 的精确摘要，作为 atomic writer 的 absent/exact CAS expectation。
function projectionExpectation(target) {
  let before;
  try {
    before = lstatSync(target, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { type: "absent" };
    throw error;
  }
  assertProjectionFileStat(before, "$projection", target);

  let descriptor;
  try {
    descriptor = openSync(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    if (cause?.code === "ELOOP") {
      fail("wakeflow-ledger-symlink", "$projection", `projection cannot become a symlink: ${target}`, {}, cause);
    }
    fail("wakeflow-ledger-projection-race", "$projection", `projection changed before safe inspection: ${target}`, {}, cause);
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    assertProjectionFileStat(opened, "$projection", target);
    if (!sameProjectionSnapshot(before, opened)) {
      fail("wakeflow-ledger-projection-race", "$projection", `projection changed while opening: ${target}`);
    }
    if (opened.size > BigInt(MAX_LEDGER_PROJECTION_BYTES)) {
      fail("wakeflow-ledger-size", "$projection", `projection exceeds the supported capacity: ${target}`);
    }
    const expectedSize = Number(opened.size);
    const captured = Buffer.alloc(expectedSize + 1);
    let offset = 0;
    while (offset < captured.length) {
      const count = readSync(descriptor, captured, offset, captured.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== expectedSize) {
      fail("wakeflow-ledger-projection-race", "$projection", `projection changed size while reading: ${target}`);
    }
    const content = captured.subarray(0, expectedSize);
    let after;
    try {
      after = lstatSync(target, { bigint: true });
    } catch (cause) {
      fail("wakeflow-ledger-projection-race", "$projection", `projection changed while reading: ${target}`, {}, cause);
    }
    assertProjectionFileStat(after, "$projection", target);
    if (!sameProjectionSnapshot(opened, after)) {
      fail("wakeflow-ledger-projection-race", "$projection", `projection changed while reading: ${target}`);
    }
    return { type: "file", sha256: sha256Bytes(content) };
  } finally {
    closeSync(descriptor);
  }
}

/**
 * 在同一 ledger 锁内清理可证明的单一 stage、重建 authority 快照并逐个收敛四个索引；
 * 中途失败返回 stale 领域错误，已经提交的 record 与已完成投影不会被回滚。
 */
export function writeLedgerProjection(options = {}) {
  const values = passiveDataObject(options, {
    allowed: ["ledgerRoot", "programId", "programDisplayName"],
  });
  const root = path.resolve(values.ledgerRoot);
  inspectDirectory(root, "$ledgerRoot", { checkMode: false });
  return withFileLock(ledgerMutationLockPath(root), () => {
    recoverInterruptedProjectionStages(root);
    const projection = buildLedgerProjectionUnlocked({ ...values, ledgerRoot: root });
    const changed = [];
    try {
      for (const relative of LEDGER_PROJECTION_PATHS) {
        const target = path.join(root, ...relative.split("/"));
        const content = projection.files[relative];
        const expectation = projectionExpectation(target);
        if (expectation.type === "file" && expectation.sha256 === sha256Bytes(content)) continue;
        atomicWriteFile({
          root,
          target,
          content,
          expectation,
          mode: LEDGER_PROJECTION_MODE,
          label: `ledger projection ${relative}`,
        });
        changed.push(relative);
      }
    } catch (cause) {
      fail(
        "wakeflow-ledger-projection-stale",
        "$projection",
        "one or more ledger projections are stale",
        { projectionStatus: "stale", changed },
        cause,
      );
    }
    return deepFreeze({
      ...projection,
      projectionStatus: "current",
      changed,
    });
  });
}

/**
 * 先委托 records owner 提交 immutable authority，再尝试刷新投影并以独立状态回执结果。
 */
export function commitLedgerRecordAndProject(input = {}) {
  const {
    ledgerRoot,
    programId,
    record,
    memberContents,
    programDisplayName,
  } = passiveDataObject(input, {
    allowed: ["ledgerRoot", "programId", "record", "memberContents", "programDisplayName"],
  });
  const authority = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: programId,
    record,
    memberContents,
  });
  try {
    const projection = writeLedgerProjection({
      ledgerRoot,
      programId,
      programDisplayName,
    });
    return deepFreeze({
      authorityCommitted: true,
      projectionStatus: "current",
      authority,
      projection,
    });
  } catch (error) {
    return deepFreeze({
      authorityCommitted: true,
      projectionStatus: "stale",
      authority,
      projectionError: {
        code: error?.code ?? "wakeflow-ledger-projection-stale",
        path: error?.path ?? "$projection",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
