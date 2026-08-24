import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";

import { atomicWriteFile, sha256Bytes } from "./wakeflow-atomic-write.mjs";
import { withWakeflowActiveIdentityLock } from "./wakeflow-active-identity-lock.mjs";
import { canonicalJson, canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import {
  demandCoreCanonicalBytes,
  loadDemandCoreRecords,
  validateDemandCoreStack,
  validateDemandRecord,
  WAKEFLOW_DEMAND_AUTHORITY_FILE,
  WAKEFLOW_DEMAND_CORE_SCHEMA_VERSION,
  WAKEFLOW_DEMAND_EVENTS_FILE,
  WAKEFLOW_DEMAND_FILE,
  WAKEFLOW_DEMAND_STATE_FILE,
} from "./wakeflow-demand-core-records.mjs";
import { buildWakeflowDemandDocuments } from "./wakeflow-demand-document-builder.mjs";
import {
  WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS,
  WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS,
  WAKEFLOW_DEMAND_RECOVERY_ROOT,
} from "./wakeflow-demand-layout.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import { findDemandArchiveRecord } from "./wakeflow-ledger-records.mjs";
import { withFileLock } from "./wakeflow-state-lock.mjs";
import { assertParsedWakeflowAssetBundle } from "./wakeflow-template-renderer.mjs";
import {
  EMPTY_TODO_BOARD,
  inspectTodoClaim,
  inspectTodoClaimForRecovery,
  planTodoClaim,
  recoverTodoRowClaim,
  TODO_BOARD_REF,
} from "./wakeflow-todo-service.mjs";

/**
 * 初始demand发布编排owner：把严格revision-1核心栈、文档投影与可选TODO claim收敛为一个可恢复事务。
 *
 * 职责导航：
 * 1. plan只读取并闭合输入、ledger identity、portable refs、初始core stack与exact文件清单。
 * 2. TODO-backed计划通过TODO service核验snapshot、lineage与mount，不自行读取或改写board。
 * 3. immutable create journal冻结完整plan；schema/codec重验所有文件、目录、digest和交叉引用。
 * 4. publish按create-lock→active-identity-lock→TODO-lock顺序，先sidecar与完整stage，再root-first rename。
 * 5. root内create journal是最终read gate；TODO提交、sidecar清理和全树复验完成后才删除它。
 * 6. recover只从exact sidecar/root journal和物理前缀前向完成，不反向unclaim或猜测孤儿stage。
 *
 * 本模块不拥有后续demand state transition、业务归档、Active全局投影或TODO普通排队策略。
 */

export const WAKEFLOW_DEMAND_PUBLICATION_SCHEMA_VERSION = 1;

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const CREATE_INTENT_KIND = "wakeflow-demand-create-intent";
const CREATE_PLAN_KIND = "wakeflow-demand-create-plan";
const CREATE_JOURNAL_REF = "transactions/create.json";
const INDEX_FILE = "index.md";
const PROGRESS_FILE = "developer-progress.md";
const INPUT_KEYS = Object.freeze([
  "authority",
  "bundle",
  "demand",
  "expectedProgramId",
  "expectedTodoRow",
  "initialTransition",
  "language",
  "ledgerRoot",
  "workspaceRoot",
]);
const RECOVERY_INPUT_KEYS = Object.freeze([
  "demandId",
  "expectedProgramId",
  "ledgerRoot",
  "workspaceRoot",
]);
const TRANSITION_KEYS = Object.freeze([
  "createdAt",
  "decisionSummary",
  "eventId",
  "reason",
]);
const ENVELOPE_KEYS = Object.freeze([
  "artifactKind",
  "plan",
  "planDigest",
  "schemaVersion",
]);
const PLAN_KEYS = Object.freeze([
  "artifactKind",
  "bundleDigest",
  "demandId",
  "directories",
  "documentSource",
  "executionPlacementMode",
  "files",
  "language",
  "paths",
  "programId",
  "schemaVersion",
  "todoClaim",
]);
const PATH_KEYS = Object.freeze([
  "journalRef",
  "sidecarRef",
  "stageRootRef",
  "stateRootRef",
]);
const FILE_KEYS = Object.freeze([
  "byteDigest",
  "content",
  "kind",
  "mediaType",
  "mode",
]);
const TODO_CLAIM_KEYS = Object.freeze([
  "boardRef",
  "claimedRow",
  "expectedRow",
  "mount",
  "todoId",
]);
const FILE_CONTRACTS = Object.freeze({
  [WAKEFLOW_DEMAND_FILE]: Object.freeze({
    kind: "immutable-record",
    mediaType: "application/json",
  }),
  [WAKEFLOW_DEMAND_AUTHORITY_FILE]: Object.freeze({
    kind: "immutable-record",
    mediaType: "application/json",
  }),
  [WAKEFLOW_DEMAND_STATE_FILE]: Object.freeze({
    kind: "current-state",
    mediaType: "application/json",
  }),
  [WAKEFLOW_DEMAND_EVENTS_FILE]: Object.freeze({
    kind: "append-only-events",
    mediaType: "application/x-ndjson",
  }),
  [INDEX_FILE]: Object.freeze({
    kind: "generated-projection",
    mediaType: "text/markdown",
  }),
  [PROGRESS_FILE]: Object.freeze({
    kind: "generated-projection",
    mediaType: "text/markdown",
  }),
});

export class WakeflowDemandPublicationError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowDemandPublicationError";
    this.code = code;
    this.path = errorPath;
    this.details = Object.freeze({ ...details, code });
  }
}

function fail(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
  throw new WakeflowDemandPublicationError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
    cause,
  });
}

function publicationBoundary(operation) {
  try {
    return operation();
  } catch (cause) {
    if (cause instanceof WakeflowDemandPublicationError) throw cause;
    fail(
      "wakeflow-demand-publication-invalid",
      cause?.message ?? "initial demand publication failed",
      { details: { causeCode: cause?.code ?? null }, cause },
    );
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalClone(value) {
  return JSON.parse(canonicalJson(value));
}

function exactDataObject(value, expectedKeys, label, errorPath = "$") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-demand-publication-shape", `${label} must be a plain data object`, {
      path: errorPath,
    });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-demand-publication-shape", `${label} must be a plain data object`, {
      path: errorPath,
    });
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("wakeflow-demand-publication-shape", `${label} cannot contain symbol keys`, {
      path: errorPath,
    });
  }
  const sorted = [...keys].sort();
  if (
    sorted.length !== expectedKeys.length
    || sorted.some((key, index) => key !== expectedKeys[index])
  ) {
    fail("wakeflow-demand-publication-shape", `${label} has the wrong field set`, {
      path: errorPath,
      details: { actualKeys: sorted, expectedKeys },
    });
  }
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-demand-publication-shape", `${label}.${key} must be an enumerable data property`, {
        path: `${errorPath}/${key}`,
      });
    }
    result[key] = descriptor.value;
  }
  return result;
}

function assertDigest(value, errorPath) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("wakeflow-demand-publication-digest", "expected a canonical SHA-256 digest", {
      path: errorPath,
    });
  }
  return value;
}

function byteDigest(value) {
  return `sha256:${sha256Bytes(value)}`;
}

function decodeUtf8(bytes, label, errorPath = "$") {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch (cause) {
    fail("wakeflow-demand-publication-utf8", `${label} must contain valid UTF-8`, {
      path: errorPath,
      cause,
    });
  }
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function assertCanonicalEqual(actual, expected, code, message, errorPath) {
  if (!sameCanonical(actual, expected)) {
    fail(code, message, { path: errorPath });
  }
}

function lstatIfPresent(candidate) {
  try {
    return lstatSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function typeOfStat(stat) {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "other";
}

function assertDirectory(candidate, label, { mode = null } = {}) {
  const stat = lstatIfPresent(candidate);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-demand-publication-path", `${label} must be an existing non-symlink directory`, {
      details: { candidate, actualType: stat ? typeOfStat(stat) : "absent" },
    });
  }
  if (mode !== null && (stat.mode & 0o777) !== mode) {
    fail("wakeflow-demand-publication-mode", `${label} must have mode ${mode.toString(8)}`, {
      details: { candidate, actualMode: (stat.mode & 0o777).toString(8) },
    });
  }
  return stat;
}

function resolveWorkspace(workspaceRoot) {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    fail("wakeflow-demand-publication-workspace", "workspaceRoot must be a non-empty path string");
  }
  const lexical = path.resolve(workspaceRoot);
  const lexicalStat = lstatIfPresent(lexical);
  if (!lexicalStat || lexicalStat.isSymbolicLink() || !lexicalStat.isDirectory()) {
    fail(
      "wakeflow-demand-publication-workspace",
      "workspaceRoot must be an existing non-symlink directory",
      { details: { workspaceRoot: lexical } },
    );
  }
  const root = realpathSync(lexical);
  const activeRoot = path.join(root, ".wakeflow-active");
  const currentRoot = path.join(activeRoot, "current");
  assertDirectory(activeRoot, ".wakeflow-active");
  assertDirectory(currentRoot, ".wakeflow-active/current");
  return Object.freeze({ root, activeRoot, currentRoot });
}

function resolveLedger(ledgerRoot, required) {
  if (ledgerRoot === null) {
    if (required) {
      fail(
        "wakeflow-demand-publication-ledger",
        "ledgerRoot is required for ledger-backed or isolated demand publication",
      );
    }
    return null;
  }
  if (typeof ledgerRoot !== "string" || !ledgerRoot.trim()) {
    fail("wakeflow-demand-publication-ledger", "ledgerRoot must be null or a non-empty path string");
  }
  const lexical = path.resolve(ledgerRoot);
  const stat = lstatIfPresent(lexical);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-demand-publication-ledger", "ledgerRoot must be an existing non-symlink directory", {
      details: { ledgerRoot: lexical },
    });
  }
  return realpathSync(lexical);
}

function portableRefSegments(ref, errorPath) {
  if (
    typeof ref !== "string"
    || !ref
    || ref.startsWith("/")
    || ref.startsWith("~")
    || /^[A-Za-z]:/u.test(ref)
    || ref.includes("\\")
  ) {
    fail("wakeflow-demand-publication-ref", "path reference must be portable and relative", {
      path: errorPath,
      details: { ref },
    });
  }
  const segments = ref.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("wakeflow-demand-publication-ref", "path reference contains an unsafe segment", {
      path: errorPath,
      details: { ref },
    });
  }
  return segments;
}

function pathFromRef(root, ref, errorPath = "$") {
  return path.join(root, ...portableRefSegments(ref, errorPath));
}

function publicationRefs(demandId) {
  const stateRootRef = `.wakeflow-active/current/${demandId}`;
  return Object.freeze({
    stateRootRef,
    stageRootRef: `.wakeflow-active/current/.wakeflow-create-stage-${demandId}`,
    sidecarRef: `.wakeflow-active/current/${demandId}.create-intent.json`,
    journalRef: CREATE_JOURNAL_REF,
  });
}

function assertCandidateTypes(workspace, refs) {
  const expectations = [
    [refs.stateRootRef, "directory"],
    [refs.stageRootRef, "directory"],
    [refs.sidecarRef, "file"],
  ];
  for (const [ref, expectedType] of expectations) {
    const candidate = pathFromRef(workspace.root, ref);
    const stat = lstatIfPresent(candidate);
    if (!stat) continue;
    if (stat.isSymbolicLink() || typeOfStat(stat) !== expectedType) {
      fail("wakeflow-demand-publication-path", `${ref} has an unsafe existing type`, {
        details: { ref, expectedType, actualType: typeOfStat(stat) },
      });
    }
  }
}

function expectedDirectories(mode) {
  const common = [
    ...WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS,
    WAKEFLOW_DEMAND_RECOVERY_ROOT,
  ].sort();
  if (mode === "main") return Object.freeze(common);
  if (mode !== "isolated") {
    fail("wakeflow-demand-publication-placement", "execution placement must be main or isolated");
  }
  return Object.freeze([
    ...common,
    "pod",
    ...[...WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS].sort(),
  ]);
}

// ==================== 一、严格输入、初始core stack与只读发布计划 ====================

// 把用户输入收敛为唯一revision-1 demand/state/event闭包；不执行任何filesystem effect。
function initialStack({ demand, authority, initialTransition, ledgerRoot }) {
  const transition = exactDataObject(
    initialTransition,
    TRANSITION_KEYS,
    "initialTransition",
    "$/initialTransition",
  );
  const validDemand = validateDemandRecord(demand, { ledgerRoot });
  const demandDigest = canonicalJsonDigest(validDemand);
  const changedArtifacts = [{
    artifactKind: "wakeflow-demand",
    ref: WAKEFLOW_DEMAND_FILE,
    digest: demandDigest,
  }];
  if (authority !== null) {
    changedArtifacts.push({
      artifactKind: "wakeflow-demand-authority",
      ref: WAKEFLOW_DEMAND_AUTHORITY_FILE,
      digest: canonicalJsonDigest(authority),
    });
  }
  const event = {
    schemaVersion: WAKEFLOW_DEMAND_CORE_SCHEMA_VERSION,
    artifactKind: "wakeflow-controller-event",
    eventId: transition.eventId,
    demandId: validDemand.demandId,
    createdAt: transition.createdAt,
    actor: "controller",
    command: "init",
    type: "state.initialized",
    previousRevision: 0,
    nextRevision: 1,
    from: null,
    to: "intake",
    reason: transition.reason,
    decisionSummary: transition.decisionSummary,
    changedArtifacts,
  };
  const eventDigest = canonicalJsonDigest(event);
  const state = {
    schemaVersion: WAKEFLOW_DEMAND_CORE_SCHEMA_VERSION,
    artifactKind: "wakeflow-state",
    programId: validDemand.programId,
    demandId: validDemand.demandId,
    demandRef: WAKEFLOW_DEMAND_FILE,
    demandDigest,
    ...(authority === null ? {} : {
      demandAuthorityRef: WAKEFLOW_DEMAND_AUTHORITY_FILE,
      demandAuthorityDigest: canonicalJsonDigest(authority),
    }),
    revision: 1,
    state: "intake",
    stateReason: transition.reason,
    updatedAt: transition.createdAt,
    lastEvent: {
      eventId: transition.eventId,
      eventDigest,
    },
    taskPackages: [],
    targetTasks: [],
    targetResults: [],
    testCards: [],
    evidence: [],
    review: {
      status: "idle",
      readyTargetTaskIds: [],
      blockedTargetTaskIds: [],
      missingTargetTaskIds: [],
    },
  };
  return validateDemandCoreStack({
    demand: validDemand,
    authority,
    state,
    events: [event],
    ledgerRoot,
  });
}

function plannedFile(content, contract) {
  return Object.freeze({
    kind: contract.kind,
    mediaType: contract.mediaType,
    mode: "0600",
    content,
    byteDigest: byteDigest(content),
  });
}

function planFiles(stack, documents) {
  const files = {};
  files[WAKEFLOW_DEMAND_FILE] = plannedFile(
    demandCoreCanonicalBytes(stack.demand).toString("utf8"),
    FILE_CONTRACTS[WAKEFLOW_DEMAND_FILE],
  );
  if (stack.authority !== null) {
    files[WAKEFLOW_DEMAND_AUTHORITY_FILE] = plannedFile(
      demandCoreCanonicalBytes(stack.authority).toString("utf8"),
      FILE_CONTRACTS[WAKEFLOW_DEMAND_AUTHORITY_FILE],
    );
  }
  files[WAKEFLOW_DEMAND_STATE_FILE] = plannedFile(
    demandCoreCanonicalBytes(stack.state).toString("utf8"),
    FILE_CONTRACTS[WAKEFLOW_DEMAND_STATE_FILE],
  );
  files[WAKEFLOW_DEMAND_EVENTS_FILE] = plannedFile(
    stack.events.map((event) => demandCoreCanonicalBytes(event).toString("utf8")).join(""),
    FILE_CONTRACTS[WAKEFLOW_DEMAND_EVENTS_FILE],
  );
  files[INDEX_FILE] = plannedFile(documents.files[INDEX_FILE].content, FILE_CONTRACTS[INDEX_FILE]);
  files[PROGRESS_FILE] = plannedFile(
    documents.files[PROGRESS_FILE].content,
    FILE_CONTRACTS[PROGRESS_FILE],
  );
  return files;
}

// 这里提供no-follow与同inode读取；内容、mode、link和canonical语义由紧邻caller继续闭合。
function readRegularFile(candidate, label) {
  const before = lstatIfPresent(candidate);
  if (!before || before.isSymbolicLink() || !before.isFile()) {
    fail("wakeflow-demand-publication-path", `${label} must be a regular non-symlink file`, {
      details: { candidate, actualType: before ? typeOfStat(before) : "absent" },
    });
  }
  let descriptor;
  try {
    descriptor = openSync(candidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    fail("wakeflow-demand-publication-path", `cannot safely open ${label}`, {
      details: { candidate },
      cause,
    });
  }
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      fail("wakeflow-demand-publication-race", `${label} changed during inspection`, {
        details: { candidate },
      });
    }
    const bytes = readFileSync(descriptor);
    const after = lstatIfPresent(candidate);
    if (!after || after.dev !== opened.dev || after.ino !== opened.ino) {
      fail("wakeflow-demand-publication-race", `${label} changed during inspection`, {
        details: { candidate },
      });
    }
    return Object.freeze({ bytes, stat: opened });
  } finally {
    closeSync(descriptor);
  }
}

function todoClaimForPlan({ workspace, demand, expectedTodoRow, refs }) {
  const sourceIsTodo = demand.source.artifactKind === "wakeflow-todo-lineage-ref";
  if (!sourceIsTodo) {
    if (expectedTodoRow !== null) {
      fail(
        "wakeflow-demand-publication-todo",
        "ledger-backed demand publication cannot carry a TODO row snapshot",
        { path: "$/expectedTodoRow" },
      );
    }
    return null;
  }
  if (expectedTodoRow === null) {
    fail(
      "wakeflow-demand-publication-todo",
      "TODO-backed demand publication requires the exact intake row snapshot",
      { path: "$/expectedTodoRow" },
    );
  }
  const mount = {
    demandId: demand.demandId,
    stateRootRef: refs.stateRootRef,
    identityDigest: canonicalJsonDigest(demand),
  };
  // 计划阶段同样消费TODO owner的锁与物理准入；apply/recover仍会在事务锁内再次精确复验。
  const claim = inspectTodoClaim({
    root: workspace.root,
    boardPath: pathFromRef(workspace.root, TODO_BOARD_REF),
    todoId: demand.source.todoId,
    expectedRow: expectedTodoRow,
    mount,
  });
  if (!sameCanonical(demand.source, claim.lineageRef)) {
    fail(
      "wakeflow-demand-publication-todo",
      "demand TODO source must equal the exact intake lineage snapshot",
      { path: "$/demand/source" },
    );
  }
  return {
    boardRef: TODO_BOARD_REF,
    todoId: claim.todoId,
    expectedRow: claim.pending.snapshot,
    claimedRow: claim.committed.snapshot,
    mount,
  };
}

function privatePathRoots(workspaceRoot, ledgerRoot) {
  const values = [workspaceRoot, ledgerRoot, os.homedir()]
    .filter((value) => typeof value === "string" && value.length > 1)
    .flatMap((value) => {
      const resolved = path.resolve(value);
      let real = resolved;
      try {
        real = realpathSync(resolved);
      } catch {
        // The caller already validates active roots; a missing optional spelling
        // adds no useful private-path prefix beyond its resolved form.
      }
      return [
        resolved,
        real,
        ...(resolved.startsWith("/private/") ? [resolved.slice("/private".length)] : []),
        ...(real.startsWith("/private/") ? [real.slice("/private".length)] : []),
      ];
    });
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

function assertNoPrivatePaths(value, { workspaceRoot, ledgerRoot }) {
  const prefixes = privatePathRoots(workspaceRoot, ledgerRoot);
  const visit = (child, errorPath) => {
    if (typeof child === "string") {
      const prefix = prefixes.find((candidate) => child.includes(candidate));
      const portableHome = /\/(?:Users|home)\/[^/\s"'`)]+(?:\/[^\s"'`)]+)*/u.test(child);
      const windowsHome = /[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s"'`)]+/iu.test(child);
      if (prefix || portableHome || windowsHome) {
        fail(
          "wakeflow-demand-publication-private-path",
          "publication journal cannot persist machine-private path material",
          { path: errorPath },
        );
      }
      return;
    }
    if (Array.isArray(child)) {
      child.forEach((entry, index) => visit(entry, `${errorPath}/${index}`));
      return;
    }
    if (child && typeof child === "object") {
      for (const [key, entry] of Object.entries(child)) visit(entry, `${errorPath}/${key}`);
    }
  };
  visit(value, "$/plan");
}

// plan冻结所有将持久化的portable bytes；计划成功不代表任何identity或TODO reservation已提交。
function planInitialDemandPublicationInternal(input) {
  const values = exactDataObject(input, INPUT_KEYS, "publication input");
  const workspace = resolveWorkspace(values.workspaceRoot);
  assertWakeflowId(values.expectedProgramId, "program", "$/expectedProgramId");
  assertParsedWakeflowAssetBundle(values.bundle);
  if (values.language !== "en" && values.language !== "zh") {
    fail("wakeflow-demand-publication-language", "language must be the resolved value en or zh", {
      path: "$/language",
    });
  }
  // Every v3 demand publication participates in the global demand identity
  // domain. T09 makes the ledger archive the permanent no-reuse authority,
  // including for TODO-backed main demands that do not otherwise read ledger
  // members while constructing their initial stack.
  const ledgerRoot = resolveLedger(values.ledgerRoot, true);
  const stack = initialStack({
    demand: values.demand,
    authority: values.authority,
    initialTransition: values.initialTransition,
    ledgerRoot,
  });
  if (stack.demand.programId !== values.expectedProgramId) {
    fail(
      "wakeflow-demand-publication-program",
      "demand programId does not match expectedProgramId",
      { path: "$/demand/programId" },
    );
  }
  const refs = publicationRefs(stack.demand.demandId);
  assertCandidateTypes(workspace, refs);
  const documents = buildWakeflowDemandDocuments({
    bundle: values.bundle,
    language: values.language,
    demand: stack.demand,
    authority: stack.authority,
    state: stack.state,
    events: stack.events,
  });
  const todoClaim = todoClaimForPlan({
    workspace,
    demand: stack.demand,
    expectedTodoRow: values.expectedTodoRow,
    refs,
  });
  assertNoPrivatePaths({ stack, todoClaim }, {
    workspaceRoot: workspace.root,
    ledgerRoot,
  });
  const plan = {
    schemaVersion: WAKEFLOW_DEMAND_PUBLICATION_SCHEMA_VERSION,
    artifactKind: CREATE_PLAN_KIND,
    programId: stack.demand.programId,
    demandId: stack.demand.demandId,
    language: values.language,
    bundleDigest: values.bundle.bundleDigest,
    executionPlacementMode: stack.demand.executionPlacement.mode,
    paths: refs,
    directories: [...expectedDirectories(stack.demand.executionPlacement.mode)],
    files: planFiles(stack, documents),
    documentSource: documents.source,
    todoClaim,
  };
  assertNoPrivatePaths(plan, { workspaceRoot: workspace.root, ledgerRoot });
  const frozenPlan = deepFreeze(canonicalClone(plan));
  const planDigest = canonicalJsonDigest(frozenPlan);
  const journal = deepFreeze({
    schemaVersion: WAKEFLOW_DEMAND_PUBLICATION_SCHEMA_VERSION,
    artifactKind: CREATE_INTENT_KIND,
    plan: frozenPlan,
    planDigest,
  });
  const journalContent = `${canonicalJson(journal)}\n`;
  return deepFreeze({
    kind: "WakeflowInitialDemandPublicationPlan",
    schemaVersion: WAKEFLOW_DEMAND_PUBLICATION_SCHEMA_VERSION,
    workspaceRoot: workspace.root,
    programId: stack.demand.programId,
    demandId: stack.demand.demandId,
    stateRootRef: refs.stateRootRef,
    planDigest,
    journal,
    journalContent,
  });
}

/** 生成零写入、可序列化且完整绑定初始tree与TODO lineage的immutable发布计划。 */
export function planInitialDemandPublication(input = {}) {
  return publicationBoundary(() => planInitialDemandPublicationInternal(input));
}

// ==================== 二、create journal与完整计划codec ====================

function plainRecord(value, label, errorPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-demand-publication-shape", `${label} must be a plain object`, {
      path: errorPath,
    });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-demand-publication-shape", `${label} must be a plain object`, {
      path: errorPath,
    });
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      fail("wakeflow-demand-publication-shape", `${label} cannot contain symbol keys`, {
        path: errorPath,
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-demand-publication-shape", `${label}.${key} must be an enumerable data property`, {
        path: `${errorPath}/${key}`,
      });
    }
  }
  return value;
}

function parseCanonicalJsonFile(file, ref) {
  let value;
  try {
    value = JSON.parse(file.content);
  } catch (cause) {
    fail("wakeflow-demand-publication-file", `${ref} must contain one JSON record`, {
      path: `$/plan/files/${ref}/content`,
      cause,
    });
  }
  if (demandCoreCanonicalBytes(value).toString("utf8") !== file.content) {
    fail("wakeflow-demand-publication-file", `${ref} must use canonical demand-core bytes`, {
      path: `$/plan/files/${ref}/content`,
    });
  }
  return value;
}

function parseCanonicalEvents(file) {
  if (
    file.content.includes("\r")
    || !file.content.endsWith("\n")
    || file.content.endsWith("\n\n")
  ) {
    fail(
      "wakeflow-demand-publication-file",
      `${WAKEFLOW_DEMAND_EVENTS_FILE} must be canonical JSONL with one trailing LF`,
      { path: `$/plan/files/${WAKEFLOW_DEMAND_EVENTS_FILE}/content` },
    );
  }
  const lines = file.content.slice(0, -1).split("\n");
  if (lines.length !== 1) {
    fail(
      "wakeflow-demand-publication-initial-event",
      "initial publication must contain exactly one revision-1 controller event",
      { path: `$/plan/files/${WAKEFLOW_DEMAND_EVENTS_FILE}/content` },
    );
  }
  let event;
  try {
    event = JSON.parse(lines[0]);
  } catch (cause) {
    fail(
      "wakeflow-demand-publication-file",
      `${WAKEFLOW_DEMAND_EVENTS_FILE} contains invalid JSONL`,
      { path: `$/plan/files/${WAKEFLOW_DEMAND_EVENTS_FILE}/content`, cause },
    );
  }
  if (demandCoreCanonicalBytes(event).toString("utf8") !== file.content) {
    fail(
      "wakeflow-demand-publication-file",
      `${WAKEFLOW_DEMAND_EVENTS_FILE} must use canonical demand-core bytes`,
      { path: `$/plan/files/${WAKEFLOW_DEMAND_EVENTS_FILE}/content` },
    );
  }
  return [event];
}

function validateDocumentSource(plan, stack) {
  const source = plainRecord(plan.documentSource, "documentSource", "$/plan/documentSource");
  const progressTemplate = exactDataObject(
    source.progressTemplate,
    ["assetId", "digest"],
    "documentSource.progressTemplate",
    "$/plan/documentSource/progressTemplate",
  );
  assertDigest(progressTemplate.digest, "$/plan/documentSource/progressTemplate/digest");
  const expectedAssetId = plan.language === "zh"
    ? "progress.demand.zh-CN"
    : "progress.demand.en";
  if (progressTemplate.assetId !== expectedAssetId) {
    fail(
      "wakeflow-demand-publication-document-source",
      "progress template asset does not match the resolved language",
      { path: "$/plan/documentSource/progressTemplate/assetId" },
    );
  }
  const expectedWithoutFingerprint = {
    projectorSchemaVersion: 1,
    demandDigest: stack.digests.demand,
    authorityDigest: stack.digests.authority,
    stateDigest: stack.digests.state,
    eventHistoryDigest: canonicalJsonDigest(stack.events),
    revision: stack.state.revision,
    eventId: stack.state.lastEvent.eventId,
    eventDigest: stack.state.lastEvent.eventDigest,
    progressTemplate,
  };
  const fingerprint = canonicalJsonDigest({
    artifactKind: "wakeflow-demand-document-source",
    schemaVersion: 1,
    projectorSchemaVersion: 1,
    language: plan.language,
    programId: stack.demand.programId,
    demandId: stack.demand.demandId,
    demandDigest: stack.digests.demand,
    authorityDigest: stack.digests.authority,
    stateDigest: stack.digests.state,
    eventHistoryDigest: canonicalJsonDigest(stack.events),
    tail: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    progressTemplate,
  });
  const expected = { fingerprint, ...expectedWithoutFingerprint };
  assertCanonicalEqual(
    source,
    expected,
    "wakeflow-demand-publication-document-source",
    "document source must bind the exact core stack and progress template",
    "$/plan/documentSource",
  );
  const marker = `<!-- wakeflow:demand-projection:v1:${fingerprint} -->`;
  for (const ref of [INDEX_FILE, PROGRESS_FILE]) {
    if (!plan.files[ref].content.includes(marker)) {
      fail(
        "wakeflow-demand-publication-document-source",
        `${ref} is missing its exact projection fingerprint marker`,
        { path: `$/plan/files/${ref}/content` },
      );
    }
  }
}

function validateTodoClaimFromJournal(plan, stack) {
  if (plan.todoClaim === null) {
    if (stack.demand.source.artifactKind === "wakeflow-todo-lineage-ref") {
      fail(
        "wakeflow-demand-publication-todo",
        "TODO-backed demand journal must contain an exact TODO claim",
        { path: "$/plan/todoClaim" },
      );
    }
    return;
  }
  const claim = exactDataObject(
    plan.todoClaim,
    TODO_CLAIM_KEYS,
    "todoClaim",
    "$/plan/todoClaim",
  );
  if (
    stack.demand.source.artifactKind !== "wakeflow-todo-lineage-ref"
    || claim.boardRef !== TODO_BOARD_REF
    || claim.todoId !== stack.demand.source.todoId
  ) {
    fail(
      "wakeflow-demand-publication-todo",
      "TODO claim must bind the demand's exact TODO source",
      { path: "$/plan/todoClaim" },
    );
  }
  const expectedMount = {
    demandId: stack.demand.demandId,
    stateRootRef: plan.paths.stateRootRef,
    identityDigest: canonicalJsonDigest(stack.demand),
  };
  assertCanonicalEqual(
    claim.mount,
    expectedMount,
    "wakeflow-demand-publication-todo-identity",
    "TODO mount identityDigest must be proven by the exact demand record",
    "$/plan/todoClaim/mount",
  );
  const isolatedBoard = `${EMPTY_TODO_BOARD}${claim.expectedRow.row}\n`;
  const expectedPlan = planTodoClaim({
    content: isolatedBoard,
    todoId: claim.todoId,
    expectedRow: claim.expectedRow,
    mount: claim.mount,
  });
  assertCanonicalEqual(
    claim.expectedRow,
    expectedPlan.pending.snapshot,
    "wakeflow-demand-publication-todo",
    "TODO expected row snapshot is not canonical",
    "$/plan/todoClaim/expectedRow",
  );
  assertCanonicalEqual(
    claim.claimedRow,
    expectedPlan.committed.snapshot,
    "wakeflow-demand-publication-todo",
    "TODO claimed row is not exactly derivable from the intake snapshot",
    "$/plan/todoClaim/claimedRow",
  );
  assertCanonicalEqual(
    stack.demand.source,
    expectedPlan.lineageRef,
    "wakeflow-demand-publication-todo",
    "demand TODO source does not match the journal intake row",
    "$/plan/files/demand.json/content/source",
  );
}

function validatePlanShape(plan, {
  workspaceRoot,
  ledgerRoot,
  expectedProgramId,
  expectedDemandId,
  allowUnresolvedLedger = false,
}) {
  exactDataObject(plan, PLAN_KEYS, "journal plan", "$/plan");
  if (
    plan.schemaVersion !== WAKEFLOW_DEMAND_PUBLICATION_SCHEMA_VERSION
    || plan.artifactKind !== CREATE_PLAN_KIND
  ) {
    fail("wakeflow-demand-publication-journal", "unsupported create plan schema or artifact kind", {
      path: "$/plan",
    });
  }
  assertWakeflowId(plan.programId, "program", "$/plan/programId");
  assertWakeflowId(plan.demandId, "demand", "$/plan/demandId");
  if (expectedProgramId !== null && plan.programId !== expectedProgramId) {
    fail("wakeflow-demand-publication-program", "journal programId does not match expectedProgramId", {
      path: "$/plan/programId",
    });
  }
  if (expectedDemandId !== null && plan.demandId !== expectedDemandId) {
    fail("wakeflow-demand-publication-demand", "journal demandId does not match expected demandId", {
      path: "$/plan/demandId",
    });
  }
  if (plan.language !== "en" && plan.language !== "zh") {
    fail("wakeflow-demand-publication-language", "journal language must be en or zh", {
      path: "$/plan/language",
    });
  }
  assertDigest(plan.bundleDigest, "$/plan/bundleDigest");
  if (plan.executionPlacementMode !== "main" && plan.executionPlacementMode !== "isolated") {
    fail("wakeflow-demand-publication-placement", "journal placement must be main or isolated", {
      path: "$/plan/executionPlacementMode",
    });
  }
  const paths = exactDataObject(plan.paths, PATH_KEYS, "journal paths", "$/plan/paths");
  assertCanonicalEqual(
    paths,
    publicationRefs(plan.demandId),
    "wakeflow-demand-publication-ref",
    "journal paths must be the deterministic create paths for demandId",
    "$/plan/paths",
  );
  if (!Array.isArray(plan.directories)) {
    fail("wakeflow-demand-publication-tree", "journal directories must be an array", {
      path: "$/plan/directories",
    });
  }
  for (let index = 0; index < plan.directories.length; index += 1) {
    portableRefSegments(plan.directories[index], `$/plan/directories/${index}`);
  }
  assertCanonicalEqual(
    plan.directories,
    expectedDirectories(plan.executionPlacementMode),
    "wakeflow-demand-publication-tree",
    "journal directories must be the exact ordered placement tree",
    "$/plan/directories",
  );
  const files = plainRecord(plan.files, "journal files", "$/plan/files");
  const fileRefs = Object.keys(files).sort();
  const required = [
    WAKEFLOW_DEMAND_EVENTS_FILE,
    WAKEFLOW_DEMAND_FILE,
    PROGRESS_FILE,
    INDEX_FILE,
    WAKEFLOW_DEMAND_STATE_FILE,
  ].sort();
  const allowedWithAuthority = [...required, WAKEFLOW_DEMAND_AUTHORITY_FILE].sort();
  if (
    !sameCanonical(fileRefs, required)
    && !sameCanonical(fileRefs, allowedWithAuthority)
  ) {
    fail(
      "wakeflow-demand-publication-tree",
      "journal files must contain the exact initial publication file set",
      { path: "$/plan/files", details: { fileRefs } },
    );
  }
  for (const ref of fileRefs) {
    portableRefSegments(ref, `$/plan/files/${ref}`);
    const file = exactDataObject(files[ref], FILE_KEYS, `file ${ref}`, `$/plan/files/${ref}`);
    const contract = FILE_CONTRACTS[ref];
    if (
      !contract
      || file.kind !== contract.kind
      || file.mediaType !== contract.mediaType
      || file.mode !== "0600"
      || typeof file.content !== "string"
      || file.byteDigest !== byteDigest(file.content)
    ) {
      fail(
        "wakeflow-demand-publication-file",
        `${ref} does not match its exact content, digest, media, kind, and mode contract`,
        { path: `$/plan/files/${ref}` },
      );
    }
  }

  const demand = parseCanonicalJsonFile(files[WAKEFLOW_DEMAND_FILE], WAKEFLOW_DEMAND_FILE);
  const authority = files[WAKEFLOW_DEMAND_AUTHORITY_FILE]
    ? parseCanonicalJsonFile(files[WAKEFLOW_DEMAND_AUTHORITY_FILE], WAKEFLOW_DEMAND_AUTHORITY_FILE)
    : null;
  const state = parseCanonicalJsonFile(files[WAKEFLOW_DEMAND_STATE_FILE], WAKEFLOW_DEMAND_STATE_FILE);
  const events = parseCanonicalEvents(files[WAKEFLOW_DEMAND_EVENTS_FILE]);
  const requiresLedger = plan.executionPlacementMode === "isolated"
    || demand.source?.artifactKind === "wakeflow-demand-ledger-source"
    || authority !== null;
  if (requiresLedger && ledgerRoot === null && !allowUnresolvedLedger) {
    fail(
      "wakeflow-demand-publication-ledger",
      "ledger-backed identity, placement, or authority recovery requires the owning ledgerRoot",
      { path: "$/ledgerRoot" },
    );
  }
  const stack = validateDemandCoreStack({ demand, authority, state, events, ledgerRoot });
  if (
    stack.demand.programId !== plan.programId
    || stack.demand.demandId !== plan.demandId
    || stack.demand.executionPlacement.mode !== plan.executionPlacementMode
  ) {
    fail(
      "wakeflow-demand-publication-identity",
      "journal identity and placement must match demand.json",
      { path: "$/plan" },
    );
  }
  validateDocumentSource(plan, stack);
  validateTodoClaimFromJournal(plan, stack);
  // Inspect decoded domain values as well as the serialized plan. JSON and
  // Markdown escaping can duplicate Windows separators, so an exact private
  // prefix must not rely on matching only the persisted representation.
  assertNoPrivatePaths({ stack, todoClaim: plan.todoClaim }, { workspaceRoot, ledgerRoot });
  assertNoPrivatePaths(plan, { workspaceRoot, ledgerRoot });
  return deepFreeze({ plan, stack });
}

function validateJournalContent(content, options) {
  if (typeof content !== "string" || !content.endsWith("\n") || content.endsWith("\n\n")) {
    fail(
      "wakeflow-demand-publication-journal",
      "create intent must be canonical JSON with exactly one trailing LF",
    );
  }
  let journal;
  try {
    journal = JSON.parse(content);
  } catch (cause) {
    fail("wakeflow-demand-publication-journal", "create intent is invalid JSON", { cause });
  }
  exactDataObject(journal, ENVELOPE_KEYS, "create intent", "$journal");
  if (
    journal.schemaVersion !== WAKEFLOW_DEMAND_PUBLICATION_SCHEMA_VERSION
    || journal.artifactKind !== CREATE_INTENT_KIND
  ) {
    fail("wakeflow-demand-publication-journal", "unsupported create intent schema or artifact kind");
  }
  assertDigest(journal.planDigest, "$/planDigest");
  if (journal.planDigest !== canonicalJsonDigest(journal.plan)) {
    fail(
      "wakeflow-demand-publication-journal-digest",
      "create intent planDigest does not match plan",
      { path: "$/planDigest" },
    );
  }
  if (content !== `${canonicalJson(journal)}\n`) {
    fail(
      "wakeflow-demand-publication-journal-canonical",
      "create intent bytes are not canonical",
    );
  }
  const validated = validatePlanShape(journal.plan, options);
  return deepFreeze({
    journal: deepFreeze(journal),
    content,
    planDigest: journal.planDigest,
    plan: validated.plan,
    stack: validated.stack,
  });
}

function readJournalFile(candidate, options, label) {
  const source = readRegularFile(candidate, label);
  if ((source.stat.mode & 0o777) !== FILE_MODE || source.stat.nlink !== 1) {
    fail(
      "wakeflow-demand-publication-mode",
      `${label} must be a private, singly linked 0600 file`,
      { details: { candidate } },
    );
  }
  return validateJournalContent(decodeUtf8(source.bytes, label), options);
}

function pathsForPlan(workspaceRoot, plan) {
  const stateRoot = pathFromRef(workspaceRoot, plan.paths.stateRootRef, "$/plan/paths/stateRootRef");
  return Object.freeze({
    stateRoot,
    stageRoot: pathFromRef(workspaceRoot, plan.paths.stageRootRef, "$/plan/paths/stageRootRef"),
    sidecar: pathFromRef(workspaceRoot, plan.paths.sidecarRef, "$/plan/paths/sidecarRef"),
    journal: pathFromRef(stateRoot, plan.paths.journalRef, "$/plan/paths/journalRef"),
    board: pathFromRef(workspaceRoot, TODO_BOARD_REF),
    createLock: `${stateRoot}.create-lock`,
  });
}

// ==================== 三、私有stage、current-wide residue与TODO事务组合 ====================

function assertSetEqual(actual, expected, code, message, details = {}) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (!sameCanonical(left, right)) {
    fail(code, message, { details: { ...details, actual: left, expected: right } });
  }
}

function walkTree(root) {
  const directories = [];
  const files = [];
  const visit = (directory, relativeRoot) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) {
        fail("wakeflow-demand-publication-tree", "publication tree cannot contain symlinks", {
          details: { relative },
        });
      }
      if (stat.isDirectory()) {
        directories.push({ relative, target, stat });
        visit(target, relative);
      } else if (stat.isFile()) {
        files.push({ relative, target, stat });
      } else {
        fail("wakeflow-demand-publication-tree", "publication tree contains an unsupported entry", {
          details: { relative, actualType: typeOfStat(stat) },
        });
      }
    }
  };
  visit(root, "");
  return { directories, files };
}

function validateTree(root, plan, journalContent, { partial = false, pending = true } = {}) {
  assertDirectory(root, "publication tree root", { mode: DIRECTORY_MODE });
  const tree = walkTree(root);
  const expectedDirectoryRefs = new Set(plan.directories);
  const expectedFileRefs = new Map(Object.entries(plan.files).map(([ref, file]) => [ref, file.content]));
  if (pending) expectedFileRefs.set(CREATE_JOURNAL_REF, journalContent);
  for (const entry of tree.directories) {
    if (!expectedDirectoryRefs.has(entry.relative)) {
      fail("wakeflow-demand-publication-tree", "publication tree contains an unknown directory", {
        details: { relative: entry.relative },
      });
    }
    if ((entry.stat.mode & 0o777) !== DIRECTORY_MODE) {
      fail("wakeflow-demand-publication-mode", "publication directory mode must be 0700", {
        details: { relative: entry.relative },
      });
    }
  }
  for (const entry of tree.files) {
    if (!expectedFileRefs.has(entry.relative)) {
      fail("wakeflow-demand-publication-tree", "publication tree contains an unknown file", {
        details: { relative: entry.relative },
      });
    }
    if ((entry.stat.mode & 0o777) !== FILE_MODE || entry.stat.nlink !== 1) {
      fail("wakeflow-demand-publication-mode", "publication files must be singly linked 0600 files", {
        details: { relative: entry.relative },
      });
    }
    const actual = readRegularFile(entry.target, `publication file ${entry.relative}`).bytes;
    if (!actual.equals(Buffer.from(expectedFileRefs.get(entry.relative), "utf8"))) {
      fail("wakeflow-demand-publication-tree", "publication file bytes differ from the create intent", {
        details: { relative: entry.relative },
      });
    }
  }
  if (!partial) {
    assertSetEqual(
      tree.directories.map((entry) => entry.relative),
      expectedDirectoryRefs,
      "wakeflow-demand-publication-tree",
      "publication directory inventory is incomplete",
    );
    assertSetEqual(
      tree.files.map((entry) => entry.relative),
      expectedFileRefs.keys(),
      "wakeflow-demand-publication-tree",
      "publication file inventory is incomplete",
    );
  }
  return tree;
}

function ensureDirectory(target) {
  const stat = lstatIfPresent(target);
  if (!stat) {
    mkdirSync(target, { mode: DIRECTORY_MODE });
    assertDirectory(target, "publication directory", { mode: DIRECTORY_MODE });
    return;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== DIRECTORY_MODE) {
    fail("wakeflow-demand-publication-tree", "publication directory conflicts with the plan", {
      details: { target, actualType: typeOfStat(stat), actualMode: (stat.mode & 0o777).toString(8) },
    });
  }
}

function ensureExactFile(root, target, content, label) {
  const stat = lstatIfPresent(target);
  if (!stat) {
    atomicWriteFile({
      root,
      target,
      content,
      expectation: { type: "absent" },
      mode: FILE_MODE,
      label,
    });
  }
  const source = readRegularFile(target, label);
  if (
    (source.stat.mode & 0o777) !== FILE_MODE
    || source.stat.nlink !== 1
    || !source.bytes.equals(Buffer.from(content, "utf8"))
  ) {
    fail("wakeflow-demand-publication-file", `${label} conflicts with the create intent`, {
      details: { target },
    });
  }
}

function materializeStage(workspaceRoot, plan, journalContent) {
  const paths = pathsForPlan(workspaceRoot, plan);
  const existing = lstatIfPresent(paths.stageRoot);
  if (!existing) {
    mkdirSync(paths.stageRoot, { mode: DIRECTORY_MODE });
  } else {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      fail("wakeflow-demand-publication-tree", "publication stage has an unsafe type", {
        details: { stageRoot: paths.stageRoot, actualType: typeOfStat(existing) },
      });
    }
    validateTree(paths.stageRoot, plan, journalContent, { partial: true, pending: true });
  }
  assertDirectory(paths.stageRoot, "publication stage", { mode: DIRECTORY_MODE });
  const directories = [...plan.directories].sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth || left.localeCompare(right);
  });
  for (const ref of directories) ensureDirectory(pathFromRef(paths.stageRoot, ref));
  for (const [ref, file] of Object.entries(plan.files)) {
    ensureExactFile(
      paths.stageRoot,
      pathFromRef(paths.stageRoot, ref),
      file.content,
      `staged ${ref}`,
    );
  }
  ensureExactFile(
    paths.stageRoot,
    pathFromRef(paths.stageRoot, CREATE_JOURNAL_REF),
    journalContent,
    "staged create journal",
  );
  validateTree(paths.stageRoot, plan, journalContent, { pending: true });
  return paths.stageRoot;
}

function createJournalOptions(
  workspaceRoot,
  ledgerRoot,
  expectedProgramId = null,
  expectedDemandId = null,
  allowUnresolvedLedger = false,
) {
  return Object.freeze({
    workspaceRoot,
    ledgerRoot,
    expectedProgramId,
    expectedDemandId,
    allowUnresolvedLedger,
  });
}

function journalAtIfPresent(candidate, options, label) {
  if (!lstatIfPresent(candidate)) return null;
  return readJournalFile(candidate, options, label);
}

// current-wide扫描拒绝孤儿、冲突和未知前缀；只有显式recover可观察一个安全TODO stage。
function currentCreateResidues(
  workspace,
  candidateJournal,
  ledgerRoot,
  { allowTodoStageRecovery = false } = {},
) {
  const journalOptions = createJournalOptions(workspace.root, null, null, null, true);
  const journals = [];
  const stages = [];
  const demandRoots = new Map();
  const demandNameRe = /^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  const sidecarRe = /^(demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.create-intent\.json$/u;
  const stageRe = /^\.wakeflow-create-stage-(demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
  for (const entry of readdirSync(workspace.currentRoot, { withFileTypes: true })) {
    const target = path.join(workspace.currentRoot, entry.name);
    if (entry.name.endsWith(".create-intent.json")) {
      const match = entry.name.match(sidecarRe);
      if (!match) {
        fail(
          "wakeflow-demand-publication-residue",
          "unknown create-intent residue blocks demand publication",
          { details: { entry: entry.name } },
        );
      }
      journals.push({
        origin: "sidecar",
        demandId: match[1],
        candidate: target,
        ...readJournalFile(target, journalOptions, `create sidecar ${entry.name}`),
      });
      continue;
    }
    if (entry.name.includes(".create-intent.json.wakeflow-stage-")) {
      fail(
        "wakeflow-demand-publication-residue",
        "orphan atomic create-intent stage blocks demand publication",
        { details: { entry: entry.name } },
      );
    }
    if (entry.name.startsWith(".wakeflow-create-stage-")) {
      const match = entry.name.match(stageRe);
      const stat = lstatIfPresent(target);
      if (!match || !stat || stat.isSymbolicLink() || !stat.isDirectory()) {
        fail(
          "wakeflow-demand-publication-residue",
          "unknown or unsafe demand create stage blocks publication",
          { details: { entry: entry.name } },
        );
      }
      stages.push({ demandId: match[1], candidate: target });
      continue;
    }
    if (!demandNameRe.test(entry.name)) continue;
    const rootStat = lstatIfPresent(target);
    if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      fail(
        "wakeflow-demand-publication-residue",
        "typed demand root must be a non-symlink directory",
        { details: { entry: entry.name } },
      );
    }
    demandRoots.set(entry.name, target);
    const transactions = path.join(target, WAKEFLOW_DEMAND_RECOVERY_ROOT);
    const transactionStat = lstatIfPresent(transactions);
    if (!transactionStat) continue;
    if (transactionStat.isSymbolicLink() || !transactionStat.isDirectory()) {
      fail(
        "wakeflow-demand-publication-residue",
        "demand transactions path has an unsafe type",
        { details: { demandId: entry.name } },
      );
    }
    const createJournal = path.join(transactions, "create.json");
    if (lstatIfPresent(createJournal)) {
      journals.push({
        origin: "root",
        demandId: entry.name,
        candidate: createJournal,
        ...readJournalFile(createJournal, journalOptions, `root create journal ${entry.name}`),
      });
    }
  }

  const journalsByDemand = new Map();
  for (const record of journals) {
    if (record.demandId !== record.plan.demandId) {
      fail(
        "wakeflow-demand-publication-residue",
        "create journal location does not match its demand identity",
        { details: { locationDemandId: record.demandId, planDemandId: record.plan.demandId } },
      );
    }
    const existing = journalsByDemand.get(record.demandId);
    if (existing && existing.content !== record.content) {
      fail(
        "wakeflow-demand-publication-conflict",
        "one demand has conflicting create journals",
        { details: { demandId: record.demandId } },
      );
    }
    journalsByDemand.set(record.demandId, record);
    if (
      candidateJournal
      && record.demandId === candidateJournal.plan.demandId
      && record.planDigest !== candidateJournal.planDigest
    ) {
      fail(
        "wakeflow-demand-publication-conflict",
        "demandId is already reserved by a different create plan",
        { details: { demandId: record.demandId } },
      );
    }
    const candidateClaim = candidateJournal?.plan.todoClaim ?? null;
    const residueClaim = record.plan.todoClaim;
    if (
      candidateClaim
      && residueClaim
      && candidateClaim.todoId === residueClaim.todoId
      && candidateClaim.expectedRow.rowDigest === residueClaim.expectedRow.rowDigest
      && candidateJournal.plan.demandId !== record.plan.demandId
    ) {
      fail(
        "wakeflow-demand-publication-todo-conflict",
        "the exact TODO intake row is reserved by another pending demand creation",
        {
          details: {
            todoId: candidateClaim.todoId,
            existingDemandId: record.plan.demandId,
            candidateDemandId: candidateJournal.plan.demandId,
          },
        },
      );
    }
  }
  for (const stage of stages) {
    const stageJournal = journalsByDemand.get(stage.demandId);
    if (!stageJournal) {
      fail(
        "wakeflow-demand-publication-residue",
        "orphan demand create stage has no exact sidecar or root journal",
        { details: { demandId: stage.demandId } },
      );
    }
    if (demandRoots.has(stage.demandId)) {
      fail(
        "wakeflow-demand-publication-conflict",
        "published demand root cannot coexist with a create stage",
        { details: { demandId: stage.demandId } },
      );
    }
    validateTree(stage.candidate, stageJournal.plan, stageJournal.content, {
      partial: true,
      pending: true,
    });
  }
  for (const [demandId, demandRoot] of demandRoots) {
    const rootJournal = journals.find((record) => (
      record.demandId === demandId && record.origin === "root"
    ));
    const sidecarJournal = journals.find((record) => (
      record.demandId === demandId && record.origin === "sidecar"
    ));
    if (rootJournal) {
      validateTree(demandRoot, rootJournal.plan, rootJournal.content, { pending: true });
    } else if (sidecarJournal) {
      fail(
        "wakeflow-demand-publication-conflict",
        "clean demand root cannot coexist with a create sidecar",
        { details: { demandId } },
      );
    }
  }
  for (const [demandId, journalRecord] of journalsByDemand) {
    const todoInspection = inspectJournalTodo(workspace, journalRecord, {
      allowAtomicStageResidue: allowTodoStageRecovery,
    });
    const hasPublishedJournal = journals.some((record) => (
      record.demandId === demandId && record.origin === "root"
    ));
    if (todoInspection?.status === "committed" && !hasPublishedJournal) {
      fail(
        "wakeflow-demand-publication-order",
        "a claimed TODO with no published pending root violates the root-first publication order",
        { details: { demandId, todoId: journalRecord.plan.todoClaim?.todoId ?? null } },
      );
    }
  }

  // Re-validate matching journals with the caller's actual ledger before they
  // can authorize target recovery. Unrelated journals stay structurally and
  // semantically validated without assuming they share that external ledger.
  const matching = candidateJournal === null ? [] : journals
    .filter((record) => record.planDigest === candidateJournal.planDigest)
    .map((record) => ({
      ...record,
      ...validateJournalContent(
        record.content,
        createJournalOptions(
          workspace.root,
          ledgerRoot,
          candidateJournal.plan.programId,
          candidateJournal.plan.demandId,
        ),
      ),
    }));
  return deepFreeze({ journals, stages, matching });
}

function inspectJournalTodo(
  workspace,
  journal,
  { allowAtomicStageResidue = false } = {},
) {
  const claim = journal.plan.todoClaim;
  if (claim === null) return null;
  const inspect = allowAtomicStageResidue
    ? inspectTodoClaimForRecovery
    : inspectTodoClaim;
  return inspect({
    root: workspace.root,
    boardPath: pathFromRef(workspace.root, claim.boardRef),
    todoId: claim.todoId,
    expectedRow: claim.expectedRow,
    mount: claim.mount,
  });
}

function commitJournalTodo(workspace, journal) {
  const claim = journal.plan.todoClaim;
  if (claim === null) return null;
  return recoverTodoRowClaim({
    root: workspace.root,
    boardPath: pathFromRef(workspace.root, claim.boardRef),
    todoId: claim.todoId,
    expectedRow: claim.expectedRow,
    mount: claim.mount,
  });
}

function assertTodoCommitted(workspace, journal) {
  const inspection = inspectJournalTodo(workspace, journal);
  if (inspection !== null && inspection.status !== "committed") {
    fail(
      "wakeflow-demand-publication-todo",
      "demand root cannot become healthy before its exact TODO claim is committed",
      { details: { todoId: journal.plan.todoClaim.todoId } },
    );
  }
  return inspection;
}

function ensureSidecar(workspaceRoot, journal, journalContent) {
  const paths = pathsForPlan(workspaceRoot, journal.plan);
  ensureExactFile(workspaceRoot, paths.sidecar, journalContent, "demand create sidecar");
}

function unlinkExactFile(candidate, expectedContent, label) {
  const source = readRegularFile(candidate, label);
  if (
    (source.stat.mode & 0o777) !== FILE_MODE
    || source.stat.nlink !== 1
    || !source.bytes.equals(Buffer.from(expectedContent, "utf8"))
  ) {
    fail("wakeflow-demand-publication-cleanup", `${label} changed before cleanup`, {
      details: { candidate },
    });
  }
  const final = lstatIfPresent(candidate);
  if (!final || final.dev !== source.stat.dev || final.ino !== source.stat.ino) {
    fail("wakeflow-demand-publication-race", `${label} changed before unlink`, {
      details: { candidate },
    });
  }
  unlinkSync(candidate);
}

function publicationResult(journal, status) {
  return deepFreeze({
    status,
    schemaVersion: WAKEFLOW_DEMAND_PUBLICATION_SCHEMA_VERSION,
    programId: journal.plan.programId,
    demandId: journal.plan.demandId,
    stateRootRef: journal.plan.paths.stateRootRef,
    planDigest: journal.planDigest,
  });
}

function healthyDemandResult(workspace, journal, ledgerRoot, status) {
  const paths = pathsForPlan(workspace.root, journal.plan);
  validateTree(paths.stateRoot, journal.plan, journal.content, { pending: false });
  assertTodoCommitted(workspace, journal);
  loadDemandCoreRecords({
    stateRoot: paths.stateRoot,
    expectedProgramId: journal.plan.programId,
    ledgerRoot,
  });
  return publicationResult(journal, status);
}

function completePendingPublication(workspace, journal, { status }) {
  const paths = pathsForPlan(workspace.root, journal.plan);
  validateTree(paths.stateRoot, journal.plan, journal.content, { pending: true });
  commitJournalTodo(workspace, journal);
  assertTodoCommitted(workspace, journal);
  if (lstatIfPresent(paths.sidecar)) {
    unlinkExactFile(paths.sidecar, journal.content, "demand create sidecar");
  }
  validateTree(paths.stateRoot, journal.plan, journal.content, { pending: true });
  assertTodoCommitted(workspace, journal);
  const result = publicationResult(journal, status);
  // The in-root journal is the final read gate. Removing it is the only step
  // that turns the already complete, claimed root into ordinary T04 authority.
  // Everything fallible, including receipt allocation, is complete before
  // this unlink. A legitimate T04 writer may advance the root immediately
  // after it, so no initial-tree read is allowed beyond this commit point.
  unlinkExactFile(paths.journal, journal.content, "demand create journal");
  return result;
}

// root-first发布保持普通reader fail closed，直到TODO、sidecar与最终root journal全部闭合。
function publishWhileLocked(workspace, planned, ledgerRoot) {
  const journal = validateJournalContent(
    planned.journalContent,
    createJournalOptions(
      workspace.root,
      ledgerRoot,
      planned.programId,
      planned.demandId,
    ),
  );
  const paths = pathsForPlan(workspace.root, journal.plan);
  const residues = currentCreateResidues(workspace, journal, ledgerRoot);
  const matchingSidecar = residues.matching.find((record) => record.origin === "sidecar") ?? null;
  const matchingRoot = residues.matching.find((record) => record.origin === "root") ?? null;
  const matchingStage = residues.stages.find((record) => record.demandId === journal.plan.demandId) ?? null;
  const stateRootStat = lstatIfPresent(paths.stateRoot);
  const todoInspection = inspectJournalTodo(workspace, journal);

  if (stateRootStat && !matchingRoot) {
    if (matchingSidecar || matchingStage) {
      fail(
        "wakeflow-demand-publication-conflict",
        "healthy demand root conflicts with leftover create residue",
        { details: { demandId: journal.plan.demandId } },
      );
    }
    return healthyDemandResult(workspace, journal, ledgerRoot, "already-published");
  }
  if (!stateRootStat && todoInspection?.status === "committed") {
    fail(
      "wakeflow-demand-publication-order",
      "a claimed TODO with no published pending root violates the root-first publication order",
      { details: { demandId: journal.plan.demandId, todoId: journal.plan.todoClaim?.todoId ?? null } },
    );
  }
  const resumed = Boolean(matchingSidecar || matchingRoot || matchingStage);
  if (!stateRootStat) {
    ensureSidecar(workspace.root, journal, journal.content);
    materializeStage(workspace.root, journal.plan, journal.content);
    if (lstatIfPresent(paths.stateRoot)) {
      fail(
        "wakeflow-demand-publication-race",
        "demand root appeared before the staged directory claim",
        { details: { demandId: journal.plan.demandId } },
      );
    }
    renameSync(paths.stageRoot, paths.stateRoot);
  } else if (matchingStage) {
    fail(
      "wakeflow-demand-publication-conflict",
      "published pending root cannot coexist with a create stage",
      { details: { demandId: journal.plan.demandId } },
    );
  }
  return completePendingPublication(workspace, journal, {
    status: resumed ? "recovered" : "published",
  });
}

function assertDemandIdentityNotArchived({ ledgerRoot, expectedProgramId, demandId }) {
  const archived = findDemandArchiveRecord({
    ledgerRoot,
    expectedProgramId,
    demandId,
  });
  if (archived !== null) {
    fail(
      "wakeflow-demand-publication-archived-identity",
      "an archived demand identity cannot be published again",
      { path: "$/demandId", details: { demandId } },
    );
  }
}

/** 在固定create→identity→TODO锁序下提交新计划或幂等确认同一健康root。 */
export function publishInitialDemandPublication(input = {}) {
  return publicationBoundary(() => {
    // Planning is intentionally a read-only admission step. The same immutable
    // bytes are then revalidated after both creation locks are held.
    const planned = planInitialDemandPublicationInternal(input);
    const workspace = resolveWorkspace(planned.workspaceRoot);
    const ledgerRoot = resolveLedger(input.ledgerRoot, true);
    const paths = pathsForPlan(workspace.root, planned.journal.plan);
    return withFileLock(paths.createLock, () => withWakeflowActiveIdentityLock(
      workspace.root,
      () => {
        assertDemandIdentityNotArchived({
          ledgerRoot,
          expectedProgramId: planned.programId,
          demandId: planned.demandId,
        });
        return publishWhileLocked(workspace, planned, ledgerRoot);
      },
    ));
  });
}

// ==================== 四、显式前向恢复入口 ====================

function recoveryJournal(workspace, demandId, ledgerRoot, expectedProgramId) {
  const refs = publicationRefs(demandId);
  assertCandidateTypes(workspace, refs);
  const stateRoot = pathFromRef(workspace.root, refs.stateRootRef);
  const sidecar = pathFromRef(workspace.root, refs.sidecarRef);
  const rootJournal = pathFromRef(stateRoot, CREATE_JOURNAL_REF);
  const options = createJournalOptions(
    workspace.root,
    ledgerRoot,
    expectedProgramId,
    demandId,
  );
  const sidecarJournal = journalAtIfPresent(sidecar, options, "demand create sidecar");
  const publishedJournal = journalAtIfPresent(rootJournal, options, "demand create journal");
  if (!sidecarJournal && !publishedJournal) {
    const stageRoot = pathFromRef(workspace.root, refs.stageRootRef);
    if (lstatIfPresent(stageRoot)) {
      fail(
        "wakeflow-demand-publication-residue",
        "orphan create stage cannot be recovered without an exact journal",
        { details: { demandId } },
      );
    }
    return null;
  }
  if (sidecarJournal && publishedJournal && sidecarJournal.content !== publishedJournal.content) {
    fail(
      "wakeflow-demand-publication-conflict",
      "sibling and root create journals disagree",
      { details: { demandId } },
    );
  }
  return publishedJournal ?? sidecarJournal;
}

// 从exact sidecar/root journal推导当前prefix并只向前完成；不从孤儿stage猜造transaction。
function recoverWhileLocked(workspace, values, ledgerRoot) {
  const journal = recoveryJournal(
    workspace,
    values.demandId,
    ledgerRoot,
    values.expectedProgramId,
  );
  if (journal === null) {
    currentCreateResidues(workspace, null, ledgerRoot, { allowTodoStageRecovery: true });
    return deepFreeze({
      status: "no-pending-transaction",
      schemaVersion: WAKEFLOW_DEMAND_PUBLICATION_SCHEMA_VERSION,
      programId: values.expectedProgramId,
      demandId: values.demandId,
    });
  }
  currentCreateResidues(workspace, journal, ledgerRoot, { allowTodoStageRecovery: true });
  const paths = pathsForPlan(workspace.root, journal.plan);
  const stateRoot = lstatIfPresent(paths.stateRoot);
  const stageRoot = lstatIfPresent(paths.stageRoot);
  const todoInspection = inspectJournalTodo(workspace, journal, {
    allowAtomicStageResidue: true,
  });
  if (!stateRoot && todoInspection?.status === "committed") {
    fail(
      "wakeflow-demand-publication-order",
      "a claimed TODO with no published pending root violates the root-first publication order",
      { details: { demandId: values.demandId, todoId: journal.plan.todoClaim?.todoId ?? null } },
    );
  }
  if (!stateRoot) {
    materializeStage(workspace.root, journal.plan, journal.content);
    if (lstatIfPresent(paths.stateRoot)) {
      fail(
        "wakeflow-demand-publication-race",
        "demand root appeared during create recovery",
        { details: { demandId: values.demandId } },
      );
    }
    renameSync(paths.stageRoot, paths.stateRoot);
  } else if (stageRoot) {
    fail(
      "wakeflow-demand-publication-conflict",
      "pending demand root cannot coexist with a create stage",
      { details: { demandId: values.demandId } },
    );
  }
  return completePendingPublication(workspace, journal, { status: "recovered" });
}

/** 显式恢复一个typed demandId的已登记create事务；无journal时只返回零写入状态。 */
export function recoverInitialDemandPublication(input = {}) {
  return publicationBoundary(() => {
    const values = exactDataObject(input, RECOVERY_INPUT_KEYS, "recovery input");
    assertWakeflowId(values.expectedProgramId, "program", "$/expectedProgramId");
    assertWakeflowId(values.demandId, "demand", "$/demandId");
    const workspace = resolveWorkspace(values.workspaceRoot);
    const ledgerRoot = resolveLedger(values.ledgerRoot, true);
    const refs = publicationRefs(values.demandId);
    const stateRoot = pathFromRef(workspace.root, refs.stateRootRef);
    const createLock = `${stateRoot}.create-lock`;
    return withFileLock(createLock, () => withWakeflowActiveIdentityLock(
      workspace.root,
      () => {
        assertDemandIdentityNotArchived({
          ledgerRoot,
          expectedProgramId: values.expectedProgramId,
          demandId: values.demandId,
        });
        return recoverWhileLocked(workspace, values, ledgerRoot);
      },
    ));
  });
}
