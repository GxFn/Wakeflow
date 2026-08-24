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
import { inspectFutureFileInside } from "./wakeflow-fs-safety.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { withFileLock } from "./wakeflow-state-lock.mjs";
import {
  TODO_COLUMNS,
  TODO_DIVIDER,
  TODO_HEADER,
  formatTodoRow,
  parseMarkdownRow,
} from "./wakeflow-todo-table.mjs";

/**
 * 全局TODO表的唯一语义owner：保存pre-demand排队事实，并用精确行快照完成claim与archive CAS。
 *
 * 职责导航：
 * 1. render/scan闭合固定13列表格、字段语法、canonical bytes及lineage digest。
 * 2. readBoardUnlocked在同一board锁内验证fixed path、owner、mode、single-link、容量和稳定inode。
 * 3. append/claim只改变本服务拥有的行与状态；不会创建demand root或解释active demand状态。
 * 4. inspect/recover claim为需求发布事务提供只读观察与幂等前向提交seam。
 * 5. archive lineage从claimed行反推唯一intake快照；删除必须消费BusinessArchive精确回执。
 * 6. interrupted atomic stage只在名称、祖先、类型、mode与inode均可证明时清理。
 *
 * 本模块不拥有需求发布顺序、活动Markdown投影、ledger归档或workspace-wide fresh判定。
 */

const BOARD_SCHEMA_VERSION = 1;
const FILE_MODE = 0o644;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TODO_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RESERVED_BREAK_PATTERN = /<br\s*\/?>/iu;
// This is the existing board vocabulary frozen by the shipped scheduling
// policy. Candidate mutation entrypoints below intentionally own only a strict
// subset of these transitions; parsing a state does not grant authority to
// produce it.
const TODO_STATUSES = new Set([
  "pending-claim",
  "parked",
  "claimed",
  "blocked",
  "observing",
  "completed",
  "cancelled",
]);
const APPENDABLE_STATUSES = new Set(["pending-claim", "parked"]);
const TODO_TYPES = new Set(["requirement", "bug", "supplement", "research"]);
const TODO_PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const BOOLEAN_CELLS = new Set(["yes", "no"]);
const TEST_DECISION_PATTERN = /^(controller-only|real-environment|not-applicable): ([^\n]+)$/u;
const SNAPSHOT_KEYS = Object.freeze([
  "artifactKind",
  "row",
  "rowDigest",
  "schemaVersion",
  "todoId",
]);
const MOUNT_KEYS = Object.freeze(["demandId", "identityDigest", "stateRootRef"]);
const ARCHIVE_RECEIPT_KEYS = Object.freeze([
  "archiveId",
  "artifactKind",
  "claimedRowDigest",
  "demandId",
  "manifestDigest",
  "schemaVersion",
  "todoId",
]);
const ATOMIC_STAGE_SUFFIX_RE = /^(?:0|[1-9][0-9]*)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const TODO_BOARD_COLUMNS = TODO_COLUMNS;
export const TODO_BOARD_HEADER = TODO_HEADER;
export const TODO_BOARD_DIVIDER = TODO_DIVIDER;
export const TODO_BOARD_REF = ".wakeflow-active/current/global-todo-board.md";
export const TODO_BOARD_MAX_BYTES = 8 * 1024 * 1024;

const BOARD_PREFIX_LINES = Object.freeze([
  "# Global TODO Board",
  "",
  "This board is the sole pre-demand intake and claim authority. After claim, execution authority lives in the demand state root.",
  "",
  "## Global TODO",
  "",
  TODO_BOARD_HEADER,
  TODO_BOARD_DIVIDER,
]);

export const EMPTY_TODO_BOARD = `${BOARD_PREFIX_LINES.join("\n")}\n`;

export class WakeflowTodoServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WakeflowTodoServiceError";
    this.code = code;
    this.details = Object.freeze({ ...details, code });
  }
}

function todoError(code, message, details = {}) {
  return new WakeflowTodoServiceError(code, message, details);
}

function digest(value) {
  return `sha256:${sha256Bytes(value)}`;
}

function assertTodoBoardByteBudget(content) {
  const actualBytes = Buffer.byteLength(content, "utf8");
  if (actualBytes > TODO_BOARD_MAX_BYTES) {
    throw todoError(
      "todo-board-too-large",
      `TODO board exceeds the ${TODO_BOARD_MAX_BYTES}-byte authority limit`,
      { actualBytes, maxBytes: TODO_BOARD_MAX_BYTES },
    );
  }
  return actualBytes;
}

function rawDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw todoError("todo-digest-invalid", `${label} must be a canonical sha256 digest`, {
      label,
      value,
    });
  }
  return value.slice("sha256:".length);
}

function dataObject(value, expectedKeys, code, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw todoError(code, `${label} must be a plain object`, { label });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw todoError(code, `${label} must be a plain data object`, { label });
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw todoError(code, `${label} cannot contain symbol keys`, { label });
  }
  const sortedKeys = [...keys].sort();
  if (
    sortedKeys.length !== expectedKeys.length
    || sortedKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw todoError(code, `${label} must contain exactly ${expectedKeys.join(", ")}`, {
      label,
      actualKeys: sortedKeys,
      expectedKeys,
    });
  }
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw todoError(code, `${label}.${key} must be an enumerable data property`, {
        label,
        key,
      });
    }
    result[key] = descriptor.value;
  }
  return result;
}

function nonEmptyCell(value, column, { rejectReservedBreak = false } = {}) {
  if (typeof value !== "string" || !value.length || value.trim() !== value) {
    throw todoError("todo-row-schema-invalid", `${column} must be a non-empty canonical string`, {
      column,
      value,
    });
  }
  if (/\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(value)) {
    throw todoError("todo-row-schema-invalid", `${column} contains a forbidden control character`, {
      column,
    });
  }
  if (rejectReservedBreak && RESERVED_BREAK_PATTERN.test(value)) {
    throw todoError(
      "todo-row-schema-invalid",
      `${column} contains the reserved Markdown newline token <br>`,
      { column },
    );
  }
  return value;
}

function exactCell(value, column, allowed) {
  nonEmptyCell(value, column);
  if (!allowed.has(value)) {
    throw todoError(
      "todo-row-schema-invalid",
      `${column} must be one of ${[...allowed].join(", ")}`,
      { column, value, allowed: [...allowed] },
    );
  }
  return value;
}

function validateDocumentsCell(value) {
  const links = [...value.matchAll(/\[([A-Za-z][A-Za-z0-9-]*)\]\(([^()\s]+)\)/gu)];
  if (links.length === 0 || links.map((match) => match[0]).join(" ") !== value) {
    throw todoError(
      "todo-row-schema-invalid",
      "Documents must be one or more canonical Markdown authority links separated by one space",
      { value },
    );
  }
  for (const match of links) {
    const target = match[2];
    const fragmentIndex = target.indexOf("#");
    const pathPart = fragmentIndex < 0 ? target : target.slice(0, fragmentIndex);
    const anchor = fragmentIndex < 0 ? null : target.slice(fragmentIndex + 1);
    const segments = pathPart.split("/");
    if (
      target.includes("\\")
      || pathPart.startsWith("/")
      || pathPart.startsWith("~")
      || pathPart.includes(":")
      || pathPart.includes("?")
      || /^[A-Za-z]:/u.test(pathPart)
      || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(pathPart)
      || segments.some((segment) => segment === "" || segment === "." || segment === "..")
      || (fragmentIndex >= 0 && (
        !anchor
        || target.indexOf("#", fragmentIndex + 1) >= 0
        || !/^[A-Za-z0-9][A-Za-z0-9._~-]*$/u.test(anchor)
      ))
    ) {
      throw todoError(
        "todo-row-schema-invalid",
        "Documents authority links must use canonical portable relative file refs with an optional anchor",
        { target },
      );
    }
  }
}

function assertTypedId(value, type, code, label) {
  try {
    return assertWakeflowId(value, type, label);
  } catch (cause) {
    throw todoError(code, `${label} must be a canonical ${type} identifier`, {
      label,
      value,
      identifierCode: cause?.code ?? null,
    });
  }
}

function demandIdFromStateRootRef(stateRootRef, code, label) {
  nonEmptyCell(stateRootRef, label);
  const prefix = ".wakeflow-active/current/";
  if (!stateRootRef.startsWith(prefix) || stateRootRef.slice(prefix.length).includes("/")) {
    throw todoError(code, `${label} must be the canonical active child ref for one demand`, {
      stateRootRef,
    });
  }
  const demandId = stateRootRef.slice(prefix.length);
  assertTypedId(demandId, "demand", code, `${label}.demandId`);
  if (stateRootRef !== `${prefix}${demandId}`) {
    throw todoError(code, `${label} is not canonical`, { stateRootRef, demandId });
  }
  return demandId;
}

function validateTodoRow(input, { rejectReservedBreak = false } = {}) {
  const row = dataObject(
    input,
    [...TODO_BOARD_COLUMNS].sort(),
    "todo-row-schema-invalid",
    "TODO row",
  );
  for (const column of TODO_BOARD_COLUMNS) {
    nonEmptyCell(row[column], column, { rejectReservedBreak });
  }
  if (!TODO_ID_PATTERN.test(row.ID)) {
    throw todoError(
      "todo-row-schema-invalid",
      "ID must be an opaque portable token using only letters, digits, dot, underscore, colon, or hyphen",
      { value: row.ID },
    );
  }
  exactCell(row.Status, "Status", TODO_STATUSES);
  exactCell(row.Type, "Type", TODO_TYPES);
  exactCell(row.Priority, "Priority", TODO_PRIORITIES);
  assertTypedId(row.Owner, "window", "todo-row-schema-invalid", "Owner");
  exactCell(row["Affects Retest / Dispatch"], "Affects Retest / Dispatch", BOOLEAN_CELLS);
  assertTypedId(
    row["Recommended Window"],
    "window",
    "todo-row-schema-invalid",
    "Recommended Window",
  );
  exactCell(row["Auto Claim"], "Auto Claim", BOOLEAN_CELLS);
  validateDocumentsCell(row.Documents);

  const testDecision = row["Testing Decision"].match(TEST_DECISION_PATTERN);
  if (!testDecision) {
    throw todoError(
      "todo-row-schema-invalid",
      "Testing Decision must be '<controller-only|real-environment|not-applicable>: <summary>'",
      { value: row["Testing Decision"] },
    );
  }
  if (row.Type === "research" && testDecision[1] !== "not-applicable") {
    throw todoError(
      "todo-row-schema-invalid",
      "research TODO rows require Testing Decision mode not-applicable",
      { value: row["Testing Decision"] },
    );
  }
  if (row.Type !== "research" && testDecision[1] === "not-applicable") {
    throw todoError(
      "todo-row-schema-invalid",
      `${row.Type} TODO rows require a real testing decision`,
      { value: row["Testing Decision"] },
    );
  }

  const mount = row["Current Mount"];
  if (mount === "none") {
    if (row.Status === "claimed") {
      throw todoError(
        "todo-row-schema-invalid",
        "a claimed TODO row requires its canonical demand state-root ref",
        { todoId: row.ID },
      );
    }
  } else {
    if (!["claimed", "completed", "cancelled"].includes(row.Status)) {
      throw todoError(
        "todo-row-schema-invalid",
        `${row.Status} TODO rows cannot carry a Current Mount`,
        { todoId: row.ID, mount },
      );
    }
    demandIdFromStateRootRef(mount, "todo-row-schema-invalid", "Current Mount");
  }

  return Object.freeze(Object.fromEntries(TODO_BOARD_COLUMNS.map((column) => [column, row[column]])));
}

function lineageRef(todoId, rowDigest) {
  return Object.freeze({
    artifactKind: "wakeflow-todo-lineage-ref",
    schemaVersion: BOARD_SCHEMA_VERSION,
    boardRef: TODO_BOARD_REF,
    todoId,
    intakeRowDigest: rowDigest,
  });
}

function snapshot(todoId, row, rowDigest) {
  return Object.freeze({
    artifactKind: "wakeflow-todo-row-snapshot",
    schemaVersion: BOARD_SCHEMA_VERSION,
    todoId,
    row,
    rowDigest,
  });
}

function rowRecord(value, row) {
  const rowDigest = digest(row);
  return Object.freeze({
    id: value.ID,
    value,
    row,
    rowDigest,
    snapshot: snapshot(value.ID, row, rowDigest),
    lineageRef: lineageRef(value.ID, rowDigest),
  });
}

// ==================== 二、canonical board编解码与lineage快照 ====================

/** 从strict行对象生成唯一canonical Markdown bytes；超出权威容量时在I/O前拒绝。 */
export function renderTodoBoard(rows = []) {
  if (!Array.isArray(rows)) {
    throw todoError("todo-board-render-invalid", "TODO board rows must be an array");
  }
  const ids = new Set();
  const lines = [];
  for (let index = 0; index < rows.length; index += 1) {
    const value = validateTodoRow(rows[index], { rejectReservedBreak: true });
    if (ids.has(value.ID)) {
      throw todoError("todo-row-duplicate", `TODO board contains duplicate ID ${value.ID}`, {
        todoId: value.ID,
        index,
      });
    }
    ids.add(value.ID);
    lines.push(formatTodoRow(value));
  }
  const content = `${BOARD_PREFIX_LINES.join("\n")}\n${lines.length > 0 ? `${lines.join("\n")}\n` : ""}`;
  assertTodoBoardByteBudget(content);
  return content;
}

/** 只解析canonical board bytes并返回稳定board/row/snapshot/lineage digest；不访问filesystem。 */
export function scanTodoBoard(content) {
  if (typeof content !== "string") {
    throw todoError("todo-board-content-invalid", "TODO board content must be a UTF-8 string");
  }
  assertTodoBoardByteBudget(content);
  if (content.includes("\r") || !content.endsWith("\n")) {
    throw todoError(
      "todo-board-noncanonical",
      "TODO board must use LF line endings and end with exactly one newline",
    );
  }
  const lines = content.split("\n");
  if (lines.length < BOARD_PREFIX_LINES.length + 1 || lines.at(-1) !== "") {
    throw todoError("todo-board-noncanonical", "TODO board does not match its canonical document shape");
  }
  for (let index = 0; index < BOARD_PREFIX_LINES.length; index += 1) {
    if (lines[index] !== BOARD_PREFIX_LINES[index]) {
      throw todoError(
        "todo-board-noncanonical",
        `TODO board line ${index + 1} does not match the canonical heading/table protocol`,
        { line: index + 1, expected: BOARD_PREFIX_LINES[index], actual: lines[index] },
      );
    }
  }

  const rowLines = lines.slice(BOARD_PREFIX_LINES.length, -1);
  const ids = new Set();
  const rows = [];
  for (let index = 0; index < rowLines.length; index += 1) {
    const row = rowLines[index];
    if (!row) {
      throw todoError(
        "todo-board-noncanonical",
        "TODO board cannot contain blank or non-row lines inside its table",
        { rowIndex: index },
      );
    }
    const cells = parseMarkdownRow(row);
    if (cells.length !== TODO_BOARD_COLUMNS.length) {
      throw todoError(
        "todo-row-cell-count",
        `TODO row must contain exactly ${TODO_BOARD_COLUMNS.length} cells`,
        { rowIndex: index, cellCount: cells.length },
      );
    }
    const value = validateTodoRow(
      Object.fromEntries(TODO_BOARD_COLUMNS.map((column, cellIndex) => [column, cells[cellIndex]])),
    );
    if (formatTodoRow(value) !== row) {
      throw todoError(
        "todo-row-noncanonical",
        `TODO row ${value.ID} is not in canonical encoded form`,
        { todoId: value.ID, rowIndex: index },
      );
    }
    if (ids.has(value.ID)) {
      throw todoError("todo-row-duplicate", `TODO board contains duplicate ID ${value.ID}`, {
        todoId: value.ID,
        rowIndex: index,
      });
    }
    ids.add(value.ID);
    rows.push(rowRecord(value, row));
  }

  return Object.freeze({
    artifactKind: "wakeflow-todo-board-snapshot",
    schemaVersion: BOARD_SCHEMA_VERSION,
    boardRef: TODO_BOARD_REF,
    boardDigest: digest(content),
    rowCount: rows.length,
    rows: Object.freeze(rows),
  });
}

function resolveBoardTarget(root, boardPath) {
  if (typeof root !== "string" || !root.trim()) {
    throw todoError("todo-board-path-invalid", "TODO service root must be a non-empty path string");
  }
  if (typeof boardPath !== "string" || !boardPath.trim()) {
    throw todoError("todo-board-path-invalid", "TODO board path must be a non-empty path string");
  }
  const resolvedRoot = path.resolve(root);
  const resolvedBoard = path.resolve(boardPath);
  const canonicalBoard = path.join(resolvedRoot, ...TODO_BOARD_REF.split("/"));
  if (resolvedBoard !== canonicalBoard) {
    throw todoError(
      "todo-board-path-invalid",
      `candidate TODO authority is fixed at ${TODO_BOARD_REF}`,
      { root: resolvedRoot, boardPath: resolvedBoard, expected: canonicalBoard },
    );
  }
  const inspection = inspectFutureFileInside({
    root: resolvedRoot,
    candidate: resolvedBoard,
    label: "candidate TODO board",
  });
  if (!inspection.parentExists) {
    throw todoError(
      "todo-board-parent-missing",
      "candidate TODO board parent must already exist",
      { boardPath: resolvedBoard },
    );
  }
  return Object.freeze({ root: resolvedRoot, boardPath: resolvedBoard, inspection });
}

// ==================== 三、最终权威物理准入、stage分类与原子提交 ====================

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    throw todoError(
      "todo-board-platform-unsupported",
      "TODO authority requires POSIX file ownership semantics",
    );
  }
  return process.geteuid();
}

function sameBoardFile(left, right) {
  return left.isFile()
    && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function assertSafeBoardSource(stat) {
  if (stat.size > BigInt(TODO_BOARD_MAX_BYTES)) {
    throw todoError(
      "todo-board-too-large",
      `candidate TODO board exceeds the ${TODO_BOARD_MAX_BYTES}-byte authority limit`,
      { actualBytes: String(stat.size), maxBytes: TODO_BOARD_MAX_BYTES },
    );
  }
  if (
    !stat.isFile()
    || stat.nlink !== 1n
    || stat.uid !== BigInt(currentEuid())
    || Number(stat.mode & 0o777n) !== FILE_MODE
  ) {
    throw todoError(
      "todo-board-source-unsafe",
      "candidate TODO board must be one current-owner, single-link, regular 0644 file",
    );
  }
}

// 只按打开时的size再多读一个字节：既限制内存，也能把读取期间增长识别为source drift。
function readStableBoardBytes(descriptor, opened) {
  const expectedBytes = Number(opened.size);
  const buffer = Buffer.allocUnsafe(expectedBytes + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
    if (count === 0) break;
    offset += count;
  }
  const afterDescriptor = fstatSync(descriptor, { bigint: true });
  if (offset !== expectedBytes || !sameBoardFile(opened, afterDescriptor)) {
    throw todoError("todo-board-source-changed", "candidate TODO board changed while being read");
  }
  return Object.freeze({ bytes: buffer.subarray(0, offset), stat: afterDescriptor });
}

// 所有filesystem入口都经此处读取最终权威；pure scanner不承担路径、锁或物理身份判断。
function readBoardUnlocked(target, { allowAtomicStageResidue = false } = {}) {
  const inspection = inspectFutureFileInside({
    root: target.root,
    candidate: target.boardPath,
    label: "candidate TODO board",
  });
  if (inspection.targetType === "absent") {
    throw todoError("todo-board-missing", `candidate TODO board is missing at ${TODO_BOARD_REF}`);
  }
  if (allowAtomicStageResidue) assertRecoverableBoardAtomicStage(target);
  else assertNoBoardAtomicStage(target);
  let descriptor = null;
  try {
    const before = lstatSync(inspection.lexicalCandidate, { bigint: true });
    assertSafeBoardSource(before);
    descriptor = openSync(
      inspection.lexicalCandidate,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    assertSafeBoardSource(opened);
    if (!sameBoardFile(before, opened)) {
      throw todoError("todo-board-source-changed", "candidate TODO board changed while being opened");
    }
    const stable = readStableBoardBytes(descriptor, opened);
    const afterPath = lstatSync(inspection.lexicalCandidate, { bigint: true });
    assertSafeBoardSource(afterPath);
    if (!sameBoardFile(stable.stat, afterPath)) {
      throw todoError("todo-board-source-changed", "candidate TODO board changed after being read");
    }
    const bytes = stable.bytes;
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw todoError("todo-board-encoding-invalid", "candidate TODO board must be valid UTF-8");
    }
    return Object.freeze({
      type: "file",
      content,
      sha256: sha256Bytes(bytes),
      board: scanTodoBoard(content),
    });
  } catch (cause) {
    if (cause instanceof WakeflowTodoServiceError) throw cause;
    throw todoError("todo-board-read-failed", "candidate TODO board cannot be read safely", {
      causeCode: cause?.code ?? null,
    });
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function stageResidueError(message, cause = undefined) {
  return todoError("todo-board-stage-residue", message, {
    ...(cause?.code ? { causeCode: cause.code } : {}),
  });
}

function inspectBoardParentChain(target) {
  try {
    const lexicalRoot = target.root;
    const parent = path.dirname(target.boardPath);
    const relative = path.relative(lexicalRoot, parent);
    if (
      !relative
      || path.isAbsolute(relative)
      || relative === ".."
      || relative.startsWith(`..${path.sep}`)
    ) {
      throw stageResidueError("candidate TODO board stage parent must remain below its workspace root");
    }
    const rootStat = lstatSync(lexicalRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw stageResidueError("candidate TODO board stage root must remain one real directory");
    }
    const realRoot = realpathSync(lexicalRoot);
    const chain = [{
      candidate: lexicalRoot,
      dev: rootStat.dev,
      ino: rootStat.ino,
      realPath: realRoot,
    }];
    let candidate = lexicalRoot;
    let expectedReal = realRoot;
    for (const segment of relative.split(path.sep)) {
      candidate = path.join(candidate, segment);
      expectedReal = path.join(expectedReal, segment);
      const stat = lstatSync(candidate);
      if (
        stat.isSymbolicLink()
        || !stat.isDirectory()
        || realpathSync(candidate) !== expectedReal
      ) {
        throw stageResidueError("candidate TODO board stage parent chain is unsafe");
      }
      chain.push({
        candidate,
        dev: stat.dev,
        ino: stat.ino,
        realPath: expectedReal,
      });
    }
    return chain;
  } catch (cause) {
    if (cause instanceof WakeflowTodoServiceError) throw cause;
    throw stageResidueError("candidate TODO board stage parent cannot be inspected safely", cause);
  }
}

function assertBoardParentChain(chain) {
  try {
    for (const entry of chain) {
      const stat = lstatSync(entry.candidate);
      if (
        stat.isSymbolicLink()
        || !stat.isDirectory()
        || stat.dev !== entry.dev
        || stat.ino !== entry.ino
        || realpathSync(entry.candidate) !== entry.realPath
      ) {
        throw stageResidueError("candidate TODO board stage parent changed during recovery");
      }
    }
  } catch (cause) {
    if (cause instanceof WakeflowTodoServiceError) throw cause;
    throw stageResidueError("candidate TODO board stage parent changed during recovery", cause);
  }
}

function exactBoardAtomicStages(target, parentChain) {
  assertBoardParentChain(parentChain);
  const directory = path.dirname(target.boardPath);
  const prefix = `.${path.basename(target.boardPath)}.wakeflow-stage-`;
  let stages;
  try {
    const candidates = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith(prefix));
    if (candidates.some((entry) => !ATOMIC_STAGE_SUFFIX_RE.test(entry.name.slice(prefix.length)))) {
      throw stageResidueError("candidate TODO board contains an unknown atomic stage name");
    }
    stages = candidates.map((entry) => path.join(directory, entry.name)).sort();
  } catch (cause) {
    if (cause instanceof WakeflowTodoServiceError) throw cause;
    throw stageResidueError("candidate TODO board stage namespace cannot be inspected safely", cause);
  }
  assertBoardParentChain(parentChain);
  if (stages.length > 1) {
    throw stageResidueError("candidate TODO board has more than one interrupted atomic stage");
  }
  return stages;
}

function assertSafeBoardAtomicStage(stat) {
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
    || stat.nlink !== 1
    || stat.uid !== currentEuid()
    || (stat.mode & 0o777) !== FILE_MODE
    || stat.size > TODO_BOARD_MAX_BYTES
  ) {
    throw stageResidueError(
      "candidate TODO board interrupted atomic stage must be one bounded current-owner single-link regular 0644 file",
    );
  }
}

function removeExactBoardAtomicStage(stage, parentChain) {
  assertBoardParentChain(parentChain);
  let before;
  try {
    before = lstatSync(stage);
  } catch (cause) {
    throw stageResidueError("candidate TODO board interrupted atomic stage disappeared before cleanup", cause);
  }
  assertSafeBoardAtomicStage(before);
  let descriptor = null;
  try {
    descriptor = openSync(stage, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    const after = lstatSync(stage);
    assertSafeBoardAtomicStage(opened);
    assertSafeBoardAtomicStage(after);
    if (
      opened.dev !== before.dev
      || opened.ino !== before.ino
      || after.dev !== opened.dev
      || after.ino !== opened.ino
    ) {
      throw stageResidueError("candidate TODO board interrupted atomic stage changed before cleanup");
    }
    assertBoardParentChain(parentChain);
    unlinkSync(stage);
  } catch (cause) {
    if (cause instanceof WakeflowTodoServiceError) throw cause;
    throw stageResidueError("candidate TODO board interrupted atomic stage cannot be cleaned safely", cause);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  assertBoardParentChain(parentChain);
}

function recoverBoardAtomicStage(target) {
  const parentChain = inspectBoardParentChain(target);
  const stages = exactBoardAtomicStages(target, parentChain);
  if (stages.length === 0) return false;
  removeExactBoardAtomicStage(stages[0], parentChain);
  return true;
}

function assertNoBoardAtomicStage(target) {
  const parentChain = inspectBoardParentChain(target);
  const stages = exactBoardAtomicStages(target, parentChain);
  if (stages.length !== 0) {
    throw stageResidueError(
      "candidate TODO board has an interrupted atomic stage that requires an authorized recovery seam",
    );
  }
}

function assertRecoverableBoardAtomicStage(target) {
  const parentChain = inspectBoardParentChain(target);
  const stages = exactBoardAtomicStages(target, parentChain);
  if (stages.length === 0) return;
  let stat;
  try {
    stat = lstatSync(stages[0]);
  } catch (cause) {
    throw stageResidueError("candidate TODO board interrupted atomic stage cannot be inspected", cause);
  }
  assertSafeBoardAtomicStage(stat);
  assertBoardParentChain(parentChain);
}

function commitBoard(target, source, nextContent) {
  // 先证明目标bytes仍是完整且有界的canonical board，再触发任何filesystem effect。
  const board = scanTodoBoard(nextContent);
  atomicWriteFile({
    root: target.root,
    target: target.boardPath,
    content: nextContent,
    expectation: source.type === "absent"
      ? { type: "absent" }
      : { type: "file", sha256: source.sha256 },
    mode: FILE_MODE,
    ownership: "whole-file",
    label: "candidate TODO board",
  });
  return board;
}

function withTodoBoardLock(root, boardPath, operation) {
  const target = resolveBoardTarget(root, boardPath);
  return withFileLock(`${target.boardPath}.lock`, () => operation(target));
}

// ==================== 四、claim计划、检查与恢复 ====================

function assertBoardCas(expectedBoardDigest, board) {
  if (expectedBoardDigest === undefined || expectedBoardDigest === null) return;
  rawDigest(expectedBoardDigest, "expectedBoardDigest");
  if (expectedBoardDigest !== board.boardDigest) {
    throw todoError("todo-board-cas-mismatch", "candidate TODO board digest changed", {
      expectedBoardDigest,
      actualBoardDigest: board.boardDigest,
    });
  }
}

function validateRowSnapshot(input) {
  let value;
  try {
    value = dataObject(
      input,
      SNAPSHOT_KEYS,
      "todo-row-snapshot-invalid",
      "expectedRow",
    );
    if (
      value.artifactKind !== "wakeflow-todo-row-snapshot"
      || value.schemaVersion !== BOARD_SCHEMA_VERSION
      || typeof value.todoId !== "string"
      || typeof value.row !== "string"
      || typeof value.rowDigest !== "string"
      || !TODO_ID_PATTERN.test(value.todoId)
      || !DIGEST_PATTERN.test(value.rowDigest)
      || digest(value.row) !== value.rowDigest
    ) {
      throw todoError("todo-row-snapshot-invalid", "expectedRow is not an exact TODO row snapshot");
    }
    const cells = parseMarkdownRow(value.row);
    if (cells.length !== TODO_BOARD_COLUMNS.length) {
      throw todoError("todo-row-snapshot-invalid", "expectedRow does not contain 13 cells");
    }
    const rowValue = validateTodoRow(
      Object.fromEntries(TODO_BOARD_COLUMNS.map((column, index) => [column, cells[index]])),
    );
    if (formatTodoRow(rowValue) !== value.row || rowValue.ID !== value.todoId) {
      throw todoError("todo-row-snapshot-invalid", "expectedRow bytes and TODO ID do not agree");
    }
  } catch (error) {
    if (error instanceof WakeflowTodoServiceError && error.code === "todo-row-snapshot-invalid") {
      throw error;
    }
    throw todoError("todo-row-snapshot-invalid", "expectedRow is not a valid exact TODO row snapshot", {
      causeCode: error?.code ?? null,
    });
  }
  return Object.freeze({ ...value });
}

function currentRowForSnapshot(board, expectedRow, todoId = expectedRow.todoId) {
  const current = board.rows.find((entry) => entry.id === todoId);
  if (
    !current
    || current.row !== expectedRow.row
    || current.rowDigest !== expectedRow.rowDigest
    || current.id !== expectedRow.todoId
  ) {
    throw todoError("todo-row-cas-mismatch", `TODO row ${todoId} changed or is missing`, {
      todoId,
      expectedRowDigest: expectedRow.rowDigest,
      actualRowDigest: current?.rowDigest ?? null,
    });
  }
  return current;
}

function validateDemandMount(input) {
  let mount;
  try {
    mount = dataObject(input, MOUNT_KEYS, "todo-demand-mount-invalid", "mount");
    assertTypedId(mount.demandId, "demand", "todo-demand-mount-invalid", "mount.demandId");
    rawDigest(mount.identityDigest, "mount.identityDigest");
    const mountedDemandId = demandIdFromStateRootRef(
      mount.stateRootRef,
      "todo-demand-mount-invalid",
      "mount.stateRootRef",
    );
    if (mountedDemandId !== mount.demandId) {
      throw todoError(
        "todo-demand-mount-invalid",
        "mount.stateRootRef must name mount.demandId",
        { demandId: mount.demandId, mountedDemandId },
      );
    }
  } catch (error) {
    if (error instanceof WakeflowTodoServiceError && error.code === "todo-demand-mount-invalid") {
      throw error;
    }
    throw todoError("todo-demand-mount-invalid", "mount must be a structured candidate demand receipt", {
      causeCode: error?.code ?? null,
    });
  }
  return Object.freeze({ ...mount });
}

function todoClaimInputs(todoId, expectedRow, mount) {
  if (typeof todoId !== "string" || !TODO_ID_PATTERN.test(todoId)) {
    throw todoError("todo-row-id-invalid", "todoId must be an opaque portable TODO ID", { todoId });
  }
  const expected = validateRowSnapshot(expectedRow);
  if (expected.todoId !== todoId) {
    throw todoError("todo-row-snapshot-invalid", "todoId must match expectedRow.todoId", {
      todoId,
      snapshotTodoId: expected.todoId,
    });
  }
  const cells = parseMarkdownRow(expected.row);
  const pendingValue = validateTodoRow(
    Object.fromEntries(TODO_BOARD_COLUMNS.map((column, index) => [column, cells[index]])),
  );
  const pending = rowRecord(pendingValue, expected.row);
  if (pending.value.Status !== "pending-claim") {
    throw todoError(
      "todo-row-transition-invalid",
      `TODO row ${todoId} cannot be claimed from ${pending.value.Status}`,
      { todoId, status: pending.value.Status },
    );
  }
  const validatedMount = validateDemandMount(mount);
  const committedValue = validateTodoRow({
    ...pending.value,
    Status: "claimed",
    "Current Mount": validatedMount.stateRootRef,
  });
  const committedRow = formatTodoRow(committedValue);
  return Object.freeze({
    todoId,
    pending,
    committed: rowRecord(committedValue, committedRow),
    mount: validatedMount,
  });
}

function rowMatches(left, right) {
  return Boolean(
    left
    && left.id === right.id
    && left.row === right.row
    && left.rowDigest === right.rowDigest
  );
}

function rowRecordFromValidatedSnapshot(value) {
  const cells = parseMarkdownRow(value.row);
  const rowValue = validateTodoRow(
    Object.fromEntries(TODO_BOARD_COLUMNS.map((column, index) => [column, cells[index]])),
  );
  return rowRecord(rowValue, value.row);
}

function planTodoClaimFromValidatedInput(content, input) {
  const board = scanTodoBoard(content);
  const current = board.rows.find((entry) => entry.id === input.todoId);
  let status;
  if (rowMatches(current, input.pending)) {
    status = "pending";
  } else if (rowMatches(current, input.committed)) {
    status = "committed";
  } else {
    throw todoError("todo-row-cas-mismatch", `TODO row ${input.todoId} changed or is missing`, {
      todoId: input.todoId,
      expectedRowDigest: input.pending.rowDigest,
      committedRowDigest: input.committed.rowDigest,
      actualRowDigest: current?.rowDigest ?? null,
    });
  }

  const targetContent = status === "pending"
    ? renderTodoBoard(board.rows.map((entry) => (
        entry.id === input.todoId ? input.committed.value : entry.value
      )))
    : content;
  const targetBoard = status === "pending" ? scanTodoBoard(targetContent) : board;
  return Object.freeze({
    status,
    todoId: input.todoId,
    pending: input.pending,
    committed: input.committed,
    lineageRef: input.pending.lineageRef,
    mount: input.mount,
    source: Object.freeze({ content, board }),
    target: Object.freeze({ content: targetContent, board: targetBoard }),
  });
}

/**
 * 生成纯行CAS计划：expectedRow始终是immutable intake快照；当前行只允许是该pending行，
 * 或只改变Status与Current Mount后可唯一推导出的claimed行。
 */
export function planTodoClaim({ content, todoId, expectedRow, mount } = {}) {
  const input = todoClaimInputs(todoId, expectedRow, mount);
  return planTodoClaimFromValidatedInput(content, input);
}

/** 在board writer锁内只读核验精确claim状态；返回plan不是durable receipt。 */
export function inspectTodoClaim({ root, boardPath, todoId, expectedRow, mount } = {}) {
  const input = todoClaimInputs(todoId, expectedRow, mount);
  return withTodoBoardLock(root, boardPath, (target) => {
    const source = readBoardUnlocked(target);
    return planTodoClaimFromValidatedInput(source.content, input);
  });
}

/**
 * 只供已有跨资源journal的显式恢复预检：允许观察一个经名称、owner、mode、link和容量验证的
 * 非权威stage，但不清理它；真正删除仍只能由recoverTodoRowClaim在再次CAS后完成。
 */
export function inspectTodoClaimForRecovery({ root, boardPath, todoId, expectedRow, mount } = {}) {
  const input = todoClaimInputs(todoId, expectedRow, mount);
  return withTodoBoardLock(root, boardPath, (target) => {
    const source = readBoardUnlocked(target, { allowAtomicStageResidue: true });
    return planTodoClaimFromValidatedInput(source.content, input);
  });
}

/**
 * 提供给跨资源demand-create owner的幂等恢复seam：pending只提交一次，精确committed重放零写入；
 * 普通claimTodoRow仍是first-commit CAS，第二次调用必须拒绝。
 */
export function recoverTodoRowClaim({ root, boardPath, todoId, expectedRow, mount } = {}) {
  const input = todoClaimInputs(todoId, expectedRow, mount);
  return withTodoBoardLock(root, boardPath, (target) => {
    const source = readBoardUnlocked(target, { allowAtomicStageResidue: true });
    const plan = planTodoClaimFromValidatedInput(source.content, input);
    // 当前journal与exact before/after行已经授权前向恢复；此时才可清理一个非权威安全stage。
    recoverBoardAtomicStage(target);
    if (plan.status === "committed") {
      return Object.freeze({
        status: "committed",
        wrote: false,
        previous: plan.pending,
        current: plan.committed,
        lineageRef: plan.lineageRef,
        mount: plan.mount,
        board: plan.source.board,
      });
    }
    const board = commitBoard(target, source, plan.target.content);
    return Object.freeze({
      status: "committed",
      wrote: true,
      previous: plan.pending,
      current: board.rows.find((entry) => entry.id === plan.todoId),
      lineageRef: plan.lineageRef,
      mount: plan.mount,
      board,
    });
  });
}

/**
 * 从唯一claimed行重建immutable intake lineage；只逆转Status与Current Mount后必须得到原digest，
 * 否则archive owner尚未证明该行属于它正在关闭的demand。
 */
export function inspectTodoArchiveLineage({
  root,
  boardPath,
  todoId,
  intakeRowDigest,
  mount,
} = {}) {
  if (typeof todoId !== "string" || !TODO_ID_PATTERN.test(todoId)) {
    throw todoError("todo-row-id-invalid", "todoId must be an opaque portable TODO ID", { todoId });
  }
  try {
    rawDigest(intakeRowDigest, "intakeRowDigest");
  } catch (cause) {
    throw todoError("todo-row-cas-mismatch", `TODO row ${todoId} does not match its intake lineage`, {
      todoId,
      expectedRowDigest: intakeRowDigest ?? null,
      actualRowDigest: null,
      causeCode: cause?.code ?? null,
    });
  }
  const validatedMount = validateDemandMount(mount);
  return withTodoBoardLock(root, boardPath, (target) => {
    const source = readBoardUnlocked(target);
    const claimed = source.board.rows.find((entry) => entry.id === todoId) ?? null;
    if (
      claimed === null
      || claimed.value.Status !== "claimed"
      || claimed.value["Current Mount"] !== validatedMount.stateRootRef
    ) {
      throw todoError("todo-row-cas-mismatch", `TODO row ${todoId} changed or is missing`, {
        todoId,
        expectedRowDigest: intakeRowDigest,
        actualRowDigest: claimed?.rowDigest ?? null,
      });
    }
    const pendingValue = validateTodoRow({
      ...claimed.value,
      Status: "pending-claim",
      "Current Mount": "none",
    });
    const pending = rowRecord(pendingValue, formatTodoRow(pendingValue));
    if (pending.rowDigest !== intakeRowDigest) {
      throw todoError("todo-row-cas-mismatch", `TODO row ${todoId} does not match its intake lineage`, {
        todoId,
        expectedRowDigest: intakeRowDigest,
        actualRowDigest: pending.rowDigest,
      });
    }
    return Object.freeze({
      status: "claimed",
      todoId,
      pending,
      claimed,
      lineageRef: pending.lineageRef,
      mount: validatedMount,
      board: source.board,
    });
  });
}

function validateArchiveReceipt(input, expectedRow) {
  let receipt;
  try {
    receipt = dataObject(
      input,
      ARCHIVE_RECEIPT_KEYS,
      "todo-archive-receipt-invalid",
      "archiveReceipt",
    );
    if (
      receipt.artifactKind !== "wakeflow-business-archive-receipt"
      || receipt.schemaVersion !== BOARD_SCHEMA_VERSION
      || receipt.todoId !== expectedRow.todoId
      || receipt.claimedRowDigest !== expectedRow.rowDigest
    ) {
      throw todoError(
        "todo-archive-receipt-invalid",
        "archiveReceipt must authorize this exact claimed TODO row",
      );
    }
    assertTypedId(receipt.archiveId, "archive", "todo-archive-receipt-invalid", "archiveReceipt.archiveId");
    assertTypedId(receipt.demandId, "demand", "todo-archive-receipt-invalid", "archiveReceipt.demandId");
    rawDigest(receipt.claimedRowDigest, "archiveReceipt.claimedRowDigest");
    rawDigest(receipt.manifestDigest, "archiveReceipt.manifestDigest");
  } catch (error) {
    if (error instanceof WakeflowTodoServiceError && error.code === "todo-archive-receipt-invalid") {
      throw error;
    }
    throw todoError(
      "todo-archive-receipt-invalid",
      "archiveReceipt must be a strict receipt from the business archive owner",
      { causeCode: error?.code ?? null },
    );
  }
  return Object.freeze({ ...receipt });
}

/** 仅在上游已证明fresh workspace时创建唯一空板；existing authority只能严格读取，不能刷新。 */
export function createTodoBoardIfAbsent({ root, boardPath, freshWorkspace = false } = {}) {
  // T02 cannot prove workspace-wide freshness. Requiring the caller to state
  // this admission explicitly prevents reconcile/status paths from treating a
  // missing initialized authority as an empty queue; M5 owns the real gate.
  if (freshWorkspace !== true) {
    throw todoError(
      "todo-board-fresh-proof-required",
      "creating an absent TODO authority is allowed only during an admitted fresh-workspace initialization",
    );
  }
  return withTodoBoardLock(root, boardPath, (target) => {
    assertNoBoardAtomicStage(target);
    const inspection = inspectFutureFileInside({
      root: target.root,
      candidate: target.boardPath,
      label: "candidate TODO board",
    });
    if (inspection.targetType === "file") {
      const source = readBoardUnlocked(target);
      return Object.freeze({
        created: false,
        boardDigest: source.board.boardDigest,
        board: source.board,
      });
    }
    const board = commitBoard(target, { type: "absent" }, EMPTY_TODO_BOARD);
    return Object.freeze({ created: true, boardDigest: board.boardDigest, board });
  });
}

/** 在writer同一把锁内读取canonical TODO权威；不创建缺失文件，也不把absent解释为空队列。 */
export function inspectTodoBoard({ root, boardPath } = {}) {
  return withTodoBoardLock(root, boardPath, (target) => {
    const source = readBoardUnlocked(target);
    return Object.freeze({ board: source.board, contentDigest: source.board.boardDigest });
  });
}

/** 在board锁内以可选board digest作CAS，仅追加一条pending或parked intake行。 */
export function appendTodoRow({
  root,
  boardPath,
  row,
  expectedBoardDigest = null,
} = {}) {
  const value = validateTodoRow(row, { rejectReservedBreak: true });
  if (!APPENDABLE_STATUSES.has(value.Status)) {
    throw todoError(
      "todo-row-transition-invalid",
      "new TODO rows may only start as pending-claim or parked",
      { todoId: value.ID, status: value.Status },
    );
  }
  return withTodoBoardLock(root, boardPath, (target) => {
    const source = readBoardUnlocked(target);
    assertBoardCas(expectedBoardDigest, source.board);
    if (source.board.rows.some((entry) => entry.id === value.ID)) {
      throw todoError("todo-row-duplicate", `TODO board already contains ID ${value.ID}`, {
        todoId: value.ID,
      });
    }
    const nextContent = renderTodoBoard([
      ...source.board.rows.map((entry) => entry.value),
      value,
    ]);
    const board = commitBoard(target, source, nextContent);
    return Object.freeze({
      appended: board.rows.find((entry) => entry.id === value.ID),
      board,
    });
  });
}

/** 以immutable intake snapshot作first-commit CAS，把一行精确挂载到一个demand state root。 */
export function claimTodoRow({
  root,
  boardPath,
  todoId,
  expectedRow,
  mount,
} = {}) {
  const input = todoClaimInputs(todoId, expectedRow, mount);
  return withTodoBoardLock(root, boardPath, (target) => {
    const source = readBoardUnlocked(target);
    const plan = planTodoClaimFromValidatedInput(source.content, input);
    if (plan.status !== "pending") {
      throw todoError("todo-row-cas-mismatch", `TODO row ${todoId} changed or is missing`, {
        todoId,
        expectedRowDigest: plan.pending.rowDigest,
        actualRowDigest: plan.committed.rowDigest,
      });
    }
    const board = commitBoard(target, source, plan.target.content);
    return Object.freeze({
      previous: plan.pending,
      current: board.rows.find((entry) => entry.id === todoId),
      lineageRef: plan.lineageRef,
      mount: plan.mount,
      board,
    });
  });
}

// ==================== 五、BusinessArchive lineage与回执授权删除 ====================

/**
 * 只有BusinessArchive owner提供绑定exact claimed row与demand的回执后才删除该intake行；
 * 本服务不推断terminal业务状态，也不写archive内容。
 */
export function archiveTodoRow({
  root,
  boardPath,
  expectedRow,
  archiveReceipt,
} = {}) {
  const expected = validateRowSnapshot(expectedRow);
  const receipt = validateArchiveReceipt(archiveReceipt, expected);
  return withTodoBoardLock(root, boardPath, (target) => {
    const source = readBoardUnlocked(target);
    const current = currentRowForSnapshot(source.board, expected);
    if (current.value.Status !== "claimed") {
      throw todoError(
        "todo-row-transition-invalid",
        `TODO row ${current.id} requires a claimed row plus a business archive receipt`,
        { todoId: current.id, status: current.value.Status },
      );
    }
    const mountedDemandId = demandIdFromStateRootRef(
      current.value["Current Mount"],
      "todo-archive-receipt-invalid",
      "Current Mount",
    );
    if (receipt.demandId !== mountedDemandId) {
      throw todoError(
        "todo-archive-receipt-invalid",
        "archiveReceipt demandId does not match the claimed TODO mount",
        { receiptDemandId: receipt.demandId, mountedDemandId },
      );
    }
    const nextContent = renderTodoBoard(
      source.board.rows.filter((entry) => entry.id !== current.id).map((entry) => entry.value),
    );
    const board = commitBoard(target, source, nextContent);
    return Object.freeze({ archived: current, archiveReceipt: receipt, board });
  });
}

/**
 * ledger提交后的前向删除恢复：exact claimed行只删除一次；只有同一immutable archive回执
 * 才能把absent视为合法重放，同ID不同bytes仍是CAS冲突。
 */
export function recoverTodoRowArchive({
  root,
  boardPath,
  expectedRow,
  archiveReceipt,
} = {}) {
  const expected = validateRowSnapshot(expectedRow);
  const archived = rowRecordFromValidatedSnapshot(expected);
  if (archived.value.Status !== "claimed") {
    throw todoError(
      "todo-row-transition-invalid",
      `TODO row ${archived.id} requires a claimed snapshot for archive recovery`,
      { todoId: archived.id, status: archived.value.Status },
    );
  }
  const receipt = validateArchiveReceipt(archiveReceipt, expected);
  const mountedDemandId = demandIdFromStateRootRef(
    archived.value["Current Mount"],
    "todo-archive-receipt-invalid",
    "Current Mount",
  );
  if (receipt.demandId !== mountedDemandId) {
    throw todoError(
      "todo-archive-receipt-invalid",
      "archiveReceipt demandId does not match the claimed TODO mount",
      { receiptDemandId: receipt.demandId, mountedDemandId },
    );
  }

  return withTodoBoardLock(root, boardPath, (target) => {
    const source = readBoardUnlocked(target, { allowAtomicStageResidue: true });
    const current = source.board.rows.find((entry) => entry.id === expected.todoId) ?? null;
    if (current === null) {
      recoverBoardAtomicStage(target);
      return Object.freeze({
        status: "already-committed",
        wrote: false,
        archived,
        archiveReceipt: receipt,
        board: source.board,
      });
    }
    if (!rowMatches(current, archived)) {
      throw todoError("todo-row-cas-mismatch", `TODO row ${expected.todoId} changed`, {
        todoId: expected.todoId,
        expectedRowDigest: expected.rowDigest,
        actualRowDigest: current.rowDigest,
      });
    }
    recoverBoardAtomicStage(target);
    const nextContent = renderTodoBoard(
      source.board.rows.filter((entry) => entry.id !== current.id).map((entry) => entry.value),
    );
    const board = commitBoard(target, source, nextContent);
    return Object.freeze({
      status: "committed",
      wrote: true,
      archived: current,
      archiveReceipt: receipt,
      board,
    });
  });
}
