/**
 * Shared transport 的物理事实 owner。
 *
 * 本模块把 records codec 落成 demand-scoped 的四目录树，负责：
 * 1. 以 current uid、0700/0600、no-follow、single-link、stable identity 读取 canonical 文件；
 * 2. 验证 group→packet→envelope→run 的完整或可前向完成图，并生成 strict inventory；
 * 3. 在已有 workspace mutation gate 内 create-once/append-only 发布，或由公开 wrapper 获取该 gate；
 * 4. 为 layout 返回有界、不可升格为 authority 的 diagnostic inventory；
 * 5. 为 archive-gated retention 提供 exact demand-root rename/cleanup participant。
 *
 * Store 不生成业务记录、不选择当前投递、不执行宿主发送，也不决定何时可以删除；
 * record 语义归 transport-records，编排归 delivery/result-review，删除准入归 retention/archive owner。
 */
import fs from "node:fs";
import path from "node:path";

import { atomicWriteFile } from "./wakeflow-atomic-write.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "./wakeflow-canonical-json.mjs";
import { assertWakeflowId } from "./wakeflow-identifiers.mjs";
import {
  WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND,
  WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND,
  deliveryEnvelopeCanonicalBytes,
  deliveryEnvelopeRef,
  deliveryRunCanonicalBytes,
  deliveryRunRef,
  dispatchGroupCanonicalBytes,
  dispatchGroupRef,
  dispatchPacketCanonicalBytes,
  dispatchPacketRef,
  validateControllerReturnEnvelopeAgainstGroup,
  validateDeliveryEnvelopeRecord,
  validateDeliveryRunAgainstSources,
  validateDeliveryRunChain,
  validateDeliveryRunRecord,
  validateDispatchGroupRecord,
  validateDispatchPacketAgainstGroup,
  validateDispatchPacketRecord,
  validateTargetDeliveryEnvelopeAgainstSources,
} from "./wakeflow-transport-records.mjs";
import {
  assertWakeflowMutationContext,
  withWakeflowRuntimeMutation,
} from "./wakeflow-workspace-mutation.mjs";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const MAX_DIAGNOSTIC_ISSUES = 64;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TRANSPORT_ROOT_REF = ".wakeflow-local/runtime/shared/transport";
const DEMANDS_ROOT_REF = `${TRANSPORT_ROOT_REF}/demands`;
const DIRECTORY_NAMES = Object.freeze(["envelopes", "groups", "packets", "runs"]);
const RELEASE_DIRECTORY_ORDER = Object.freeze(["runs", "envelopes", "packets", "groups"]);
const RELEASE_STEP_ID = "release-archived-transport-demand";
const INVENTORY_SOURCE_SNAPSHOTS = new WeakMap();

const RECORD_SPECS = Object.freeze({
  groups: Object.freeze({
    idField: "groupId",
    idType: "dispatch-group",
    digestField: "groupDigest",
    validate: validateDispatchGroupRecord,
    canonicalBytes: dispatchGroupCanonicalBytes,
    ref(record) {
      return dispatchGroupRef({ demandId: record.demandId, groupId: record.groupId });
    },
  }),
  packets: Object.freeze({
    idField: "packetId",
    idType: "dispatch-packet",
    digestField: "packetDigest",
    validate: validateDispatchPacketRecord,
    canonicalBytes: dispatchPacketCanonicalBytes,
    ref(record) {
      return dispatchPacketRef({ demandId: record.demandId, packetId: record.packetId });
    },
  }),
  envelopes: Object.freeze({
    idField: "deliveryId",
    idType: "delivery",
    digestField: "envelopeDigest",
    validate: validateDeliveryEnvelopeRecord,
    canonicalBytes: deliveryEnvelopeCanonicalBytes,
    ref(record) {
      return deliveryEnvelopeRef({ demandId: record.demandId, deliveryId: record.deliveryId });
    },
  }),
  runs: Object.freeze({
    idField: "runId",
    idType: "delivery-run",
    digestField: "runDigest",
    validate: validateDeliveryRunRecord,
    canonicalBytes: deliveryRunCanonicalBytes,
    ref(record) {
      return deliveryRunRef({ demandId: record.demandId, runId: record.runId });
    },
  }),
});

export class WakeflowTransportStoreError extends Error {
  constructor(code, message, { cause, ...details } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowTransportStoreError";
    this.code = code;
    this.details = Object.freeze({ code, ...details });
    if (cause !== undefined && this.cause === undefined) this.cause = cause;
  }
}

function fail(code, message, details = {}) {
  throw new WakeflowTransportStoreError(code, message, details);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function cloneFrozen(value) {
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

// inventory、diagnostic 与 release 顺序必须按 Unicode code unit 稳定，不能依赖进程 locale。
function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactDataFields(value, expected, label) {
  if (!isPlainObject(value)) {
    fail("wakeflow-transport-store-contract", `${label} must be one plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("wakeflow-transport-store-contract", `${label} cannot contain symbol fields`);
  }
  const actual = [...keys].sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail("wakeflow-transport-store-contract", `${label} has an invalid field set`, {
      actual,
      expected: wanted,
    });
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-transport-store-contract",
        `${label}.${key} must be an enumerable data field`,
      );
    }
  }
}

// destructive release 输入的数组也必须是无行为、无附加属性且无稀疏位的普通数据序列。
function exactDataArray(value, label) {
  if (!Array.isArray(value)) {
    fail("wakeflow-transport-store-release-contract", `${label} must be an array`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string"
      || !/^(?:0|[1-9][0-9]*)$/u.test(key)
      || Number(key) >= value.length
    ) {
      fail(
        "wakeflow-transport-store-release-contract",
        `${label} cannot contain additional array properties`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "wakeflow-transport-store-release-contract",
        `${label}[${key}] must be an enumerable data field`,
      );
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail(
        "wakeflow-transport-store-release-contract",
        `${label} cannot contain sparse slots`,
      );
    }
  }
  return value;
}

function field(value, key) {
  return Object.getOwnPropertyDescriptor(value, key).value;
}

function currentEuid() {
  if (typeof process.geteuid !== "function") {
    fail(
      "wakeflow-transport-store-platform",
      "the private transport store requires POSIX ownership semantics",
    );
  }
  return process.geteuid();
}

function modeOf(stat) {
  return Number(stat.mode & 0o777n);
}

function sameNode(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function statMatchesCommitIdentity(stat, commitIdentity) {
  return commitIdentity !== null
    && [
      ["deviceId", stat.dev],
      ["inodeId", stat.ino],
      ["mode", stat.mode],
      ["uid", stat.uid],
      ["gid", stat.gid],
      ["linkCount", stat.nlink],
      ["size", stat.size],
    ].every(([key, value]) => commitIdentity[key] === String(value));
}

function sameDirectoryNode(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid;
}

function assertPrivateDirectoryStat(stat, label, { allowSafeModeDrift = false } = {}) {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("wakeflow-transport-store-directory", `${label} must be one private directory`);
  }
  const mode = modeOf(stat);
  const modeAccepted = mode === DIRECTORY_MODE
    || (
      allowSafeModeDrift
      && (mode & 0o700) === 0o700
      && (mode & 0o022) === 0
    );
  if (stat.uid !== BigInt(currentEuid()) || !modeAccepted) {
    fail(
      "wakeflow-transport-store-directory",
      `${label} must be owned by the current user with a private directory mode`,
    );
  }
}

function inspectPrivateDirectory(
  directory,
  label,
  { allowMissing = false, allowSafeModeDrift = false } = {},
) {
  let stat;
  try {
    stat = fs.lstatSync(directory, { bigint: true });
  } catch (cause) {
    if (allowMissing && cause?.code === "ENOENT") return null;
    fail("wakeflow-transport-store-directory", `cannot inspect ${label}`, { cause });
  }
  assertPrivateDirectoryStat(stat, label, { allowSafeModeDrift });
  return stat;
}

function assertDirectoryStillCurrent(
  directory,
  expected,
  label,
  { allowSafeModeDrift = false } = {},
) {
  let current;
  try {
    current = fs.lstatSync(directory, { bigint: true });
  } catch (cause) {
    fail("wakeflow-transport-store-race", `${label} disappeared during inspection`, { cause });
  }
  assertPrivateDirectoryStat(current, label, { allowSafeModeDrift });
  if (!sameDirectoryNode(expected, current)) {
    fail("wakeflow-transport-store-race", `${label} changed during inspection`);
  }
}

function normalizeWorkspaceRoot(value) {
  if (typeof value !== "string" || !value.trim()) {
    fail("wakeflow-transport-store-contract", "workspaceRoot is required");
  }
  const root = path.resolve(value);
  let stat;
  try {
    stat = fs.lstatSync(root, { bigint: true });
  } catch (cause) {
    fail("wakeflow-transport-store-root", "cannot inspect workspaceRoot", { cause });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(currentEuid())) {
    fail(
      "wakeflow-transport-store-root",
      "workspaceRoot must be one current-user-owned non-symlink directory",
    );
  }
  return root;
}

function resolveRef(workspaceRoot, ref) {
  const target = path.resolve(workspaceRoot, ...ref.split("/"));
  const relative = path.relative(workspaceRoot, target);
  if (
    path.isAbsolute(relative)
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
  ) {
    fail("wakeflow-transport-store-path", `transport ref escaped the workspace: ${ref}`);
  }
  return target;
}

function inspectBaseChain(workspaceRoot, { forLayout = false } = {}) {
  let current = workspaceRoot;
  const identities = [];
  for (const segment of DEMANDS_ROOT_REF.split("/")) {
    current = path.join(current, segment);
    const stat = inspectPrivateDirectory(current, `transport base ${segment}`, {
      allowSafeModeDrift: forLayout,
    });
    identities.push({
      directory: current,
      stat,
      label: `transport base ${segment}`,
      allowSafeModeDrift: forLayout,
    });
  }
  return identities;
}

function assertChainStillCurrent(chain) {
  for (const entry of chain) {
    assertDirectoryStillCurrent(entry.directory, entry.stat, entry.label, {
      allowSafeModeDrift: entry.allowSafeModeDrift === true,
    });
  }
}

function syncPrivateDirectory(directory, label) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      directory,
      fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.lstatSync(directory, { bigint: true });
    assertPrivateDirectoryStat(opened, label);
    assertPrivateDirectoryStat(linked, label);
    if (!sameDirectoryNode(opened, linked)) {
      fail("wakeflow-transport-store-durability", `${label} changed before durability sync`);
    }
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(directory, { bigint: true });
    if (!sameDirectoryNode(opened, after) || !sameDirectoryNode(opened, afterPath)) {
      fail("wakeflow-transport-store-durability", `${label} changed during durability sync`);
    }
  } catch (cause) {
    if (cause instanceof WakeflowTransportStoreError) throw cause;
    fail("wakeflow-transport-store-durability", `cannot durability-sync ${label}`, { cause });
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function createPrivateDirectory(directory, parent, label) {
  const parentStat = inspectPrivateDirectory(parent, `${label} parent`);
  try {
    fs.mkdirSync(directory, { mode: DIRECTORY_MODE });
  } catch (cause) {
    fail("wakeflow-transport-store-directory-create", `cannot create ${label}`, { cause });
  }
  inspectPrivateDirectory(directory, label);
  assertDirectoryStillCurrent(parent, parentStat, `${label} parent`);
  syncPrivateDirectory(directory, label);
  syncPrivateDirectory(parent, `${label} parent`);
  assertDirectoryStillCurrent(parent, parentStat, `${label} parent`);
}

function ensureDemandTree(workspaceRoot, demandId, baseChain) {
  assertChainStillCurrent(baseChain);
  const demandsRoot = baseChain.at(-1).directory;
  const demandRoot = path.join(demandsRoot, demandId);
  if (inspectPrivateDirectory(demandRoot, "transport demand root", { allowMissing: true }) === null) {
    createPrivateDirectory(demandRoot, demandsRoot, "transport demand root");
  }
  for (const directoryName of DIRECTORY_NAMES) {
    const directory = path.join(demandRoot, directoryName);
    if (inspectPrivateDirectory(
      directory,
      `transport ${directoryName} directory`,
      { allowMissing: true },
    ) === null) {
      createPrivateDirectory(directory, demandRoot, `transport ${directoryName} directory`);
    }
  }
  const actual = fs.readdirSync(demandRoot).sort();
  if (canonicalJson(actual) !== canonicalJson([...DIRECTORY_NAMES].sort())) {
    fail(
      "wakeflow-transport-store-directory",
      "transport demand root must contain exactly groups, packets, envelopes, and runs",
      { actual },
    );
  }
  assertChainStillCurrent(baseChain);
  return demandRoot;
}

function isForwardCompletableEmptyDemandPrefix(workspaceRoot, demandId) {
  const baseChain = inspectBaseChain(workspaceRoot);
  const demandRoot = path.join(baseChain.at(-1).directory, demandId);
  const demandStat = inspectPrivateDirectory(
    demandRoot,
    "transport demand root",
    { allowMissing: true },
  );
  if (demandStat === null) return false;
  const names = fs.readdirSync(demandRoot).sort();
  if (
    names.length >= DIRECTORY_NAMES.length
    || names.some((name) => !DIRECTORY_NAMES.includes(name))
  ) {
    return false;
  }
  for (const name of names) {
    const directory = path.join(demandRoot, name);
    const directoryStat = inspectPrivateDirectory(directory, `transport ${name} directory`);
    if (fs.readdirSync(directory).length !== 0) return false;
    assertDirectoryStillCurrent(directory, directoryStat, `transport ${name} directory`);
  }
  assertDirectoryStillCurrent(demandRoot, demandStat, "transport demand root");
  assertChainStillCurrent(baseChain);
  return true;
}

/**
 * 以 descriptor + path 双重身份稳定读取单个事实文件，并验证私有mode、大小、codec、ref及LF字节。
 */
function readPrivateCanonicalRecord({
  workspaceRoot,
  file,
  fileName,
  programId,
  demandId,
  directoryName,
  spec,
  detachedDemandRoot = null,
}) {
  const match = fileName.match(/^(.+)\.json$/u);
  if (!match) {
    fail(
      "wakeflow-transport-store-entry",
      `transport ${directoryName} contains a non-record entry: ${fileName}`,
    );
  }
  const id = assertWakeflowId(match[1], spec.idType, `$transport/${directoryName}/${fileName}`);
  let descriptor = null;
  try {
    const initialPath = fs.lstatSync(file, { bigint: true });
    if (
      !initialPath.isFile()
      || initialPath.isSymbolicLink()
      || initialPath.uid !== BigInt(currentEuid())
      || initialPath.nlink !== 1n
      || modeOf(initialPath) !== FILE_MODE
      || initialPath.size > BigInt(MAX_RECORD_BYTES)
    ) {
      fail(
        "wakeflow-transport-store-file",
        `transport record ${fileName} must be one bounded private 0600 file`,
      );
    }
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY
        | (fs.constants.O_NOFOLLOW ?? 0)
        | (fs.constants.O_NONBLOCK ?? 0),
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    const beforePath = fs.lstatSync(file, { bigint: true });
    if (
      !before.isFile()
      || before.isSymbolicLink()
      || before.uid !== BigInt(currentEuid())
      || before.nlink !== 1n
      || modeOf(before) !== FILE_MODE
      || before.size > BigInt(MAX_RECORD_BYTES)
      || !sameNode(initialPath, before)
      || !sameNode(before, beforePath)
    ) {
      fail(
        "wakeflow-transport-store-file",
        `transport record ${fileName} must be one bounded private 0600 file`,
      );
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(file, { bigint: true });
    if (!sameNode(before, after) || !sameNode(before, afterPath)) {
      fail("wakeflow-transport-store-race", `transport record ${fileName} changed while read`);
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch (cause) {
      fail("wakeflow-transport-store-json", `transport record ${fileName} is not JSON`, { cause });
    }
    let record;
    try {
      record = spec.validate(parsed);
    } catch (cause) {
      fail(
        "wakeflow-transport-store-record",
        `transport record ${fileName} is invalid`,
        { cause },
      );
    }
    if (
      record.programId !== programId
      || record.demandId !== demandId
      || record[spec.idField] !== id
    ) {
      fail(
        "wakeflow-transport-store-authority",
        `transport record ${fileName} does not belong to the exact program and demand authority`,
      );
    }
    const ref = spec.ref(record);
    const expectedPhysicalFile = detachedDemandRoot === null
      ? resolveRef(workspaceRoot, ref)
      : path.join(detachedDemandRoot, directoryName, fileName);
    if (expectedPhysicalFile !== file) {
      fail("wakeflow-transport-store-ref", `transport record ${fileName} has a non-canonical ref`);
    }
    const canonicalBytes = spec.canonicalBytes(record);
    if (!bytes.equals(canonicalBytes)) {
      fail(
        "wakeflow-transport-store-canonical",
        `transport record ${fileName} is not stored as exact canonical LF-terminated bytes`,
      );
    }
    return {
      entry: deepFreeze({
        ref,
        digest: record[spec.digestField],
        record,
      }),
      source: { file, stat: after },
    };
  } catch (cause) {
    if (cause instanceof WakeflowTransportStoreError) throw cause;
    fail("wakeflow-transport-store-file", `cannot read transport record ${fileName}`, { cause });
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

// 一次目录扫描同时冻结目录成员名、每个文件身份和解析后的 record entry。
function scanRecordDirectory({
  workspaceRoot,
  demandRoot,
  programId,
  demandId,
  directoryName,
  detachedDemandRoot = null,
}) {
  const directory = path.join(demandRoot, directoryName);
  const directoryStat = inspectPrivateDirectory(directory, `transport ${directoryName} directory`);
  const names = fs.readdirSync(directory).sort();
  const spec = RECORD_SPECS[directoryName];
  const records = names.map((fileName) => readPrivateCanonicalRecord({
    workspaceRoot,
    file: path.join(directory, fileName),
    fileName,
    programId,
    demandId,
    directoryName,
    spec,
    detachedDemandRoot,
  }));
  const namesAfter = fs.readdirSync(directory).sort();
  if (canonicalJson(namesAfter) !== canonicalJson(names)) {
    fail(
      "wakeflow-transport-store-race",
      `transport ${directoryName} entries changed during inspection`,
    );
  }
  assertDirectoryStillCurrent(directory, directoryStat, `transport ${directoryName} directory`);
  return {
    directory,
    directoryName,
    directoryStat,
    names,
    entries: records.map(({ entry }) => entry),
    sources: records.map(({ entry, source }) => ({ ref: entry.ref, ...source })),
  };
}

function assertRecordDirectorySnapshotCurrent(snapshot) {
  const currentNames = fs.readdirSync(snapshot.directory).sort();
  if (canonicalJson(currentNames) !== canonicalJson(snapshot.names)) {
    fail(
      "wakeflow-transport-store-race",
      `transport ${snapshot.directoryName} entries changed before inventory closure`,
    );
  }
  assertDirectoryStillCurrent(
    snapshot.directory,
    snapshot.directoryStat,
    `transport ${snapshot.directoryName} directory`,
  );
  for (const source of snapshot.sources) {
    let current;
    try {
      current = fs.lstatSync(source.file, { bigint: true });
    } catch (cause) {
      fail(
        "wakeflow-transport-store-race",
        `transport ${snapshot.directoryName} record disappeared before inventory closure`,
        { cause },
      );
    }
    if (!sameNode(source.stat, current)) {
      fail(
        "wakeflow-transport-store-race",
        `transport ${snapshot.directoryName} record changed before inventory closure`,
      );
    }
  }
}

function inventoryDigest(programId, demandId, entries) {
  return canonicalJsonDigest({
    programId,
    demandId,
    entries: Object.fromEntries(["groups", "packets", "envelopes", "runs"].map((kind) => [
      kind,
      entries[kind].map(({ ref, digest }) => ({ ref, digest })),
    ])),
  });
}

function missingInventory(programId, demandId) {
  const entries = { groups: [], packets: [], envelopes: [], runs: [] };
  return deepFreeze({
    status: "missing",
    programId,
    demandId,
    entries,
    inventoryDigest: inventoryDigest(programId, demandId, entries),
  });
}

/**
 * 验证四类记录的跨文件图。允许发布过程中的合法前缀，但任何已存在后代都必须有精确祖先。
 */
function validateTransportGraph(entries) {
  const groupsById = new Map(
    entries.groups.map((entry) => [entry.record.groupId, entry.record]),
  );
  const packetMemberOwners = new Map();
  for (const group of groupsById.values()) {
    for (const member of group.members) {
      const previousGroupId = packetMemberOwners.get(member.packetId);
      if (previousGroupId && previousGroupId !== group.groupId) {
        fail(
          "wakeflow-transport-store-group-membership",
          `dispatch packet ${member.packetId} is claimed by more than one dispatch group`,
        );
      }
      packetMemberOwners.set(member.packetId, group.groupId);
    }
  }

  const packetsById = new Map();
  for (const packetEntry of entries.packets) {
    const packet = packetEntry.record;
    const group = groupsById.get(packet.groupId);
    if (!group) {
      fail(
        "wakeflow-transport-store-ancestor",
        `dispatch packet ${packet.packetId} has no exact dispatch group ancestor`,
      );
    }
    try {
      validateDispatchPacketAgainstGroup({ packet, group });
    } catch (cause) {
      fail(
        "wakeflow-transport-store-ancestor",
        `dispatch packet ${packet.packetId} differs from its exact dispatch group ancestor`,
        { cause },
      );
    }
    packetsById.set(packet.packetId, packet);
  }

  const envelopesById = new Map();
  for (const envelopeEntry of entries.envelopes) {
    const envelope = envelopeEntry.record;
    const group = groupsById.get(envelope.groupId);
    if (!group) {
      fail(
        "wakeflow-transport-store-ancestor",
        `delivery envelope ${envelope.deliveryId} has no exact dispatch group ancestor`,
      );
    }
    try {
      if (envelope.artifactKind === WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND) {
        const packet = packetsById.get(envelope.packetId);
        if (!packet) {
          fail(
            "wakeflow-transport-store-ancestor",
            `target delivery envelope ${envelope.deliveryId} has no exact dispatch packet ancestor`,
          );
        }
        validateTargetDeliveryEnvelopeAgainstSources({ envelope, group, packet });
      } else if (envelope.artifactKind === WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND) {
        validateControllerReturnEnvelopeAgainstGroup({ envelope, group });
      } else {
        fail(
          "wakeflow-transport-store-record",
          `delivery envelope ${envelope.deliveryId} has an unsupported artifact kind`,
        );
      }
    } catch (cause) {
      if (cause instanceof WakeflowTransportStoreError) throw cause;
      fail(
        "wakeflow-transport-store-ancestor",
        `delivery envelope ${envelope.deliveryId} differs from its exact immutable sources`,
        { cause },
      );
    }
    envelopesById.set(envelope.deliveryId, envelope);
  }

  const runsById = new Map(entries.runs.map((entry) => [entry.record.runId, entry.record]));
  const runsByDelivery = new Map();
  for (const runEntry of entries.runs) {
    const run = runEntry.record;
    const envelope = envelopesById.get(run.deliveryId);
    if (!envelope) {
      fail(
        "wakeflow-transport-store-ancestor",
        `delivery run ${run.runId} has no exact delivery envelope ancestor`,
      );
    }
    const previousRun = Object.hasOwn(run, "previousRun")
      ? runsById.get(run.previousRun.runId)
      : null;
    if (Object.hasOwn(run, "previousRun") && !previousRun) {
      fail(
        "wakeflow-transport-store-ancestor",
        `delivery run ${run.runId} has no exact previous run ancestor`,
      );
    }
    try {
      validateDeliveryRunAgainstSources({
        run,
        envelope,
        ...(previousRun ? { previousRun } : {}),
      });
    } catch (cause) {
      fail(
        "wakeflow-transport-store-run-lineage",
        `delivery run ${run.runId} has invalid envelope or previous-run lineage integrity`,
        { cause },
      );
    }
    const deliveryRuns = runsByDelivery.get(run.deliveryId) ?? [];
    deliveryRuns.push(run);
    runsByDelivery.set(run.deliveryId, deliveryRuns);
  }
  for (const [deliveryId, runs] of runsByDelivery) {
    try {
      validateDeliveryRunChain({ runs });
    } catch (cause) {
      fail(
        "wakeflow-transport-store-run-lineage",
        `delivery run chain for ${deliveryId} is forked or discontinuous`,
        { cause },
      );
    }
  }
  return entries;
}

// strict inventory 在返回前二次复验全部目录、文件和base chain；该结果才具备authority资格。
function scanExistingTransportDemandRoot({
  workspaceRoot,
  programId,
  demandId,
  demandRoot,
  demandStat,
  baseChain = null,
  detached = false,
}) {
  const actual = fs.readdirSync(demandRoot).sort();
  const expected = [...DIRECTORY_NAMES].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(
      "wakeflow-transport-store-directory",
      "transport demand root must contain exactly groups, packets, envelopes, and runs",
      { actual, expected },
    );
  }
  const snapshots = {};
  snapshots.groups = scanRecordDirectory({
    workspaceRoot,
    demandRoot,
    programId,
    demandId,
    directoryName: "groups",
    detachedDemandRoot: detached ? demandRoot : null,
  });
  snapshots.packets = scanRecordDirectory({
    workspaceRoot,
    demandRoot,
    programId,
    demandId,
    directoryName: "packets",
    detachedDemandRoot: detached ? demandRoot : null,
  });
  snapshots.envelopes = scanRecordDirectory({
    workspaceRoot,
    demandRoot,
    programId,
    demandId,
    directoryName: "envelopes",
    detachedDemandRoot: detached ? demandRoot : null,
  });
  snapshots.runs = scanRecordDirectory({
    workspaceRoot,
    demandRoot,
    programId,
    demandId,
    directoryName: "runs",
    detachedDemandRoot: detached ? demandRoot : null,
  });
  const entries = validateTransportGraph(Object.fromEntries(
    Object.entries(snapshots).map(([kind, snapshot]) => [kind, snapshot.entries]),
  ));
  const actualAfter = fs.readdirSync(demandRoot).sort();
  if (canonicalJson(actualAfter) !== canonicalJson(expected)) {
    fail(
      "wakeflow-transport-store-race",
      "transport demand entries changed before inventory closure",
    );
  }
  for (const directoryName of DIRECTORY_NAMES) {
    assertRecordDirectorySnapshotCurrent(snapshots[directoryName]);
  }
  assertDirectoryStillCurrent(demandRoot, demandStat, "transport demand root");
  if (baseChain !== null) assertChainStillCurrent(baseChain);
  const status = Object.values(entries).every((records) => records.length === 0)
    ? "empty"
    : "current";
  const inventory = deepFreeze({
    status,
    programId,
    demandId,
    entries,
    inventoryDigest: inventoryDigest(programId, demandId, entries),
  });
  INVENTORY_SOURCE_SNAPSHOTS.set(inventory, snapshots);
  return inventory;
}

function scanTransportDemand({ workspaceRoot, programId, demandId }) {
  const baseChain = inspectBaseChain(workspaceRoot);
  const demandsRoot = baseChain.at(-1).directory;
  const demandRoot = path.join(demandsRoot, demandId);
  const demandStat = inspectPrivateDirectory(
    demandRoot,
    "transport demand root",
    { allowMissing: true },
  );
  if (demandStat === null) {
    assertChainStillCurrent(baseChain);
    return missingInventory(programId, demandId);
  }
  return scanExistingTransportDemandRoot({
    workspaceRoot,
    programId,
    demandId,
    demandRoot,
    demandStat,
    baseChain,
  });
}

function diagnosticIssueCode(value, fallback = "wakeflow-transport-diagnostic-invalid") {
  const candidate = typeof value === "string" ? value : value?.code;
  return typeof candidate === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(candidate)
    ? candidate
    : fallback;
}

function createDiagnosticIssueCollector() {
  const issues = [];
  const seen = new Set();
  return {
    add(value, scope) {
      const code = diagnosticIssueCode(value);
      const key = `${scope}:${code}`;
      if (seen.has(key) || issues.length >= MAX_DIAGNOSTIC_ISSUES) return;
      seen.add(key);
      issues.push(Object.freeze({ code, scope, route: "manual-review" }));
    },
    value() {
      return issues;
    },
  };
}

function diagnosticEntryProjection(entries) {
  return Object.fromEntries(["groups", "packets", "envelopes", "runs"].map((kind) => [
    kind,
    entries[kind].map(({ ref, digest }) => ({ ref, digest })),
  ]));
}

function diagnosticInventory({ programId, demandId, status, entries, issues }) {
  return deepFreeze({
    status,
    programId,
    demandId,
    entries: diagnosticEntryProjection(entries),
    inventoryDigest: inventoryDigest(programId, demandId, entries),
    issues: [...issues],
  });
}

function emptyRecordEntries() {
  return { groups: [], packets: [], envelopes: [], runs: [] };
}

// diagnostic 只保留能从有效祖先逐层证明的子图，并把其余问题降为有界issue而非next action。
function filterDiagnosticTransportGraph(entries, issueCollector) {
  const duplicatePacketIds = new Set();
  const packetOwner = new Map();
  for (const groupEntry of entries.groups) {
    for (const member of groupEntry.record.members) {
      const owner = packetOwner.get(member.packetId);
      if (owner && owner !== groupEntry.record.groupId) duplicatePacketIds.add(member.packetId);
      else packetOwner.set(member.packetId, groupEntry.record.groupId);
    }
  }
  if (duplicatePacketIds.size > 0) {
    issueCollector.add("wakeflow-transport-store-group-membership", "groups");
  }
  const groups = entries.groups.filter((entry) => (
    entry.record.members.every((member) => !duplicatePacketIds.has(member.packetId))
  ));
  const groupsById = new Map(groups.map((entry) => [entry.record.groupId, entry.record]));

  const packets = entries.packets.filter((entry) => {
    const group = groupsById.get(entry.record.groupId);
    if (!group) {
      issueCollector.add("wakeflow-transport-store-ancestor", "packets");
      return false;
    }
    try {
      validateDispatchPacketAgainstGroup({ packet: entry.record, group });
      return true;
    } catch (cause) {
      issueCollector.add(cause, "packets");
      return false;
    }
  });
  const packetsById = new Map(packets.map((entry) => [entry.record.packetId, entry.record]));

  const envelopes = entries.envelopes.filter((entry) => {
    const envelope = entry.record;
    const group = groupsById.get(envelope.groupId);
    if (!group) {
      issueCollector.add("wakeflow-transport-store-ancestor", "envelopes");
      return false;
    }
    try {
      if (envelope.artifactKind === WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND) {
        const packet = packetsById.get(envelope.packetId);
        if (!packet) {
          issueCollector.add("wakeflow-transport-store-ancestor", "envelopes");
          return false;
        }
        validateTargetDeliveryEnvelopeAgainstSources({ envelope, group, packet });
      } else {
        validateControllerReturnEnvelopeAgainstGroup({ envelope, group });
      }
      return true;
    } catch (cause) {
      issueCollector.add(cause, "envelopes");
      return false;
    }
  });
  const envelopesById = new Map(
    envelopes.map((entry) => [entry.record.deliveryId, entry.record]),
  );

  const candidateRunsByDelivery = new Map();
  for (const entry of entries.runs) {
    const deliveryRuns = candidateRunsByDelivery.get(entry.record.deliveryId) ?? [];
    deliveryRuns.push(entry);
    candidateRunsByDelivery.set(entry.record.deliveryId, deliveryRuns);
  }
  const acceptedRunEntries = new Set();
  for (const [deliveryId, deliveryEntries] of candidateRunsByDelivery) {
    const envelope = envelopesById.get(deliveryId);
    if (!envelope) {
      issueCollector.add("wakeflow-transport-store-ancestor", "runs");
      continue;
    }
    const ordered = [...deliveryEntries].sort((left, right) => (
      left.record.attemptOrdinal - right.record.attemptOrdinal
      || lexicalCompare(left.record.runId, right.record.runId)
    ));
    const accepted = [];
    const acceptedById = new Map();
    for (const entry of ordered) {
      const run = entry.record;
      const previousRun = Object.hasOwn(run, "previousRun")
        ? acceptedById.get(run.previousRun.runId)
        : null;
      if (Object.hasOwn(run, "previousRun") && !previousRun) {
        issueCollector.add("wakeflow-transport-store-run-lineage", "runs");
        continue;
      }
      try {
        validateDeliveryRunAgainstSources({
          run,
          envelope,
          ...(previousRun ? { previousRun } : {}),
        });
        validateDeliveryRunChain({ runs: [...accepted.map((candidate) => candidate.record), run] });
        accepted.push(entry);
        acceptedById.set(run.runId, run);
        acceptedRunEntries.add(entry);
      } catch (cause) {
        issueCollector.add(cause, "runs");
      }
    }
  }
  return {
    groups,
    packets,
    envelopes,
    runs: entries.runs.filter((entry) => acceptedRunEntries.has(entry)),
  };
}

function scanRecordDirectoryForLayout({
  workspaceRoot,
  demandRoot,
  programId,
  demandId,
  directoryName,
  issueCollector,
}) {
  const directory = path.join(demandRoot, directoryName);
  let directoryStat;
  try {
    directoryStat = inspectPrivateDirectory(directory, `transport ${directoryName} directory`);
  } catch (cause) {
    issueCollector.add(cause, directoryName);
    return [];
  }
  let names;
  try {
    names = fs.readdirSync(directory).sort();
  } catch (cause) {
    issueCollector.add(cause, directoryName);
    return [];
  }
  const spec = RECORD_SPECS[directoryName];
  const entries = [];
  for (const fileName of names) {
    try {
      entries.push(readPrivateCanonicalRecord({
        workspaceRoot,
        file: path.join(directory, fileName),
        fileName,
        programId,
        demandId,
        directoryName,
        spec,
      }).entry);
    } catch (cause) {
      issueCollector.add(cause, directoryName);
    }
  }
  try {
    assertDirectoryStillCurrent(directory, directoryStat, `transport ${directoryName} directory`);
  } catch (cause) {
    issueCollector.add(cause, directoryName);
    return [];
  }
  return entries;
}

// layout扫描允许安全的目录mode漂移并收集问题，但输出明确不能替代strict inventory。
function scanTransportDemandForLayout({ workspaceRoot, programId, demandId }) {
  const issueCollector = createDiagnosticIssueCollector();
  const emptyEntries = emptyRecordEntries();
  let baseChain;
  try {
    baseChain = inspectBaseChain(workspaceRoot, { forLayout: true });
  } catch (cause) {
    issueCollector.add(cause, "base");
    return diagnosticInventory({
      programId,
      demandId,
      status: "degraded",
      entries: emptyEntries,
      issues: issueCollector.value(),
    });
  }
  const demandRoot = path.join(baseChain.at(-1).directory, demandId);
  let demandStat;
  try {
    demandStat = inspectPrivateDirectory(
      demandRoot,
      "transport demand root",
      { allowMissing: true },
    );
  } catch (cause) {
    issueCollector.add(cause, "demand");
    return diagnosticInventory({
      programId,
      demandId,
      status: "degraded",
      entries: emptyEntries,
      issues: issueCollector.value(),
    });
  }
  if (demandStat === null) {
    return diagnosticInventory({
      programId,
      demandId,
      status: "missing",
      entries: emptyEntries,
      issues: [],
    });
  }

  let actualNames = [];
  try {
    actualNames = fs.readdirSync(demandRoot).sort();
  } catch (cause) {
    issueCollector.add(cause, "demand");
  }
  const expectedNames = [...DIRECTORY_NAMES].sort();
  if (canonicalJson(actualNames) !== canonicalJson(expectedNames)) {
    issueCollector.add("wakeflow-transport-store-directory", "demand");
  }
  const rawEntries = Object.fromEntries(DIRECTORY_NAMES.map((directoryName) => [
    directoryName,
    scanRecordDirectoryForLayout({
      workspaceRoot,
      demandRoot,
      programId,
      demandId,
      directoryName,
      issueCollector,
    }),
  ]));
  try {
    assertDirectoryStillCurrent(demandRoot, demandStat, "transport demand root");
    assertChainStillCurrent(baseChain);
  } catch (cause) {
    issueCollector.add(cause, "demand");
  }
  const entries = filterDiagnosticTransportGraph(rawEntries, issueCollector);
  const issues = issueCollector.value();
  const recordCount = Object.values(entries).reduce((sum, records) => sum + records.length, 0);
  return diagnosticInventory({
    programId,
    demandId,
    status: issues.length > 0 ? "degraded" : recordCount === 0 ? "empty" : "current",
    entries,
    issues,
  });
}

function normalizeInspectInput(input) {
  exactDataFields(input, ["workspaceRoot", "programId", "demandId"], "transport inspect input");
  return Object.freeze({
    workspaceRoot: normalizeWorkspaceRoot(field(input, "workspaceRoot")),
    programId: assertWakeflowId(field(input, "programId"), "program", "$input/programId"),
    demandId: assertWakeflowId(field(input, "demandId"), "demand", "$input/demandId"),
  });
}

function normalizePublishInput(input, { admitted }) {
  const expected = ["workspaceRoot", "programId", "demandId", "record"];
  if (admitted) expected.push("mutationContext");
  else if (Object.hasOwn(input ?? {}, "acquireTimeoutMs")) expected.push("acquireTimeoutMs");
  exactDataFields(input, expected, "transport publish input");
  const workspaceRoot = normalizeWorkspaceRoot(field(input, "workspaceRoot"));
  const programId = assertWakeflowId(field(input, "programId"), "program", "$input/programId");
  const demandId = assertWakeflowId(field(input, "demandId"), "demand", "$input/demandId");
  let acquireTimeoutMs;
  if (!admitted && Object.hasOwn(input, "acquireTimeoutMs")) {
    acquireTimeoutMs = field(input, "acquireTimeoutMs");
    if (!Number.isSafeInteger(acquireTimeoutMs) || acquireTimeoutMs < 0) {
      fail(
        "wakeflow-transport-store-contract",
        "acquireTimeoutMs must be one non-negative safe integer",
      );
    }
  }
  return Object.freeze({
    workspaceRoot,
    programId,
    demandId,
    record: field(input, "record"),
    ...(admitted ? { mutationContext: field(input, "mutationContext") } : {}),
    ...(acquireTimeoutMs === undefined ? {} : { acquireTimeoutMs }),
  });
}

function rejectedResult(cause, fallbackCode = "wakeflow-transport-store-rejected") {
  const code = typeof cause?.code === "string" ? cause.code : fallbackCode;
  const message = typeof cause?.message === "string"
    ? cause.message
    : "transport publication was rejected before commit";
  return deepFreeze({
    outcome: "rejected",
    code,
    message,
    details: isPlainObject(cause?.details) ? cloneFrozen(cause.details) : {},
  });
}

function conflictResult(kind, id) {
  return rejectedResult(new WakeflowTransportStoreError(
    "wakeflow-transport-store-same-id-conflict",
    `${kind} ${id} already exists with different immutable canonical bytes`,
  ));
}

function publicationValue(status, entry, inventory) {
  return deepFreeze({
    status,
    ref: entry.ref,
    digest: entry.digest,
    record: entry.record,
    inventoryDigest: inventory.inventoryDigest,
  });
}

function existingEntry(inventory, directoryName, idField, id) {
  return inventory.entries[directoryName].find((entry) => entry.record[idField] === id) ?? null;
}

function validatePublicationGraph(inventory, directoryName, record, spec) {
  const candidateEntries = {
    groups: [...inventory.entries.groups],
    packets: [...inventory.entries.packets],
    envelopes: [...inventory.entries.envelopes],
    runs: [...inventory.entries.runs],
  };
  candidateEntries[directoryName].push({
    ref: spec.ref(record),
    digest: record[spec.digestField],
    record,
  });
  validateTransportGraph(candidateEntries);
}

// 写后只承认“原inventory + 本次同inode同字节记录”的唯一增量，拒绝并发无关变化冒充成功。
function publicationTransitionMatches({
  before,
  after,
  directoryName,
  record,
  spec,
  ref,
  desiredBytes,
  commitIdentity,
}) {
  const expectedEntries = Object.fromEntries(
    ["groups", "packets", "envelopes", "runs"].map((kind) => [
      kind,
      before.entries[kind].map((entry) => ({
        ref: entry.ref,
        digest: entry.digest,
      })),
    ]),
  );
  expectedEntries[directoryName].push({
    ref,
    digest: record[spec.digestField],
  });
  for (const entries of Object.values(expectedEntries)) {
    entries.sort((left, right) => (
      left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0
    ));
  }
  if (
    after.status !== "current"
    || after.inventoryDigest !== inventoryDigest(
      before.programId,
      before.demandId,
      expectedEntries,
    )
  ) {
    return null;
  }
  const committed = existingEntry(
    after,
    directoryName,
    spec.idField,
    record[spec.idField],
  );
  const committedSource = INVENTORY_SOURCE_SNAPSHOTS
    .get(after)?.[directoryName]?.sources
    .find((source) => source.ref === ref);
  return committed
    && committedSource
    && statMatchesCommitIdentity(committedSource.stat, commitIdentity)
    && committed.ref === ref
    && committed.digest === record[spec.digestField]
    && spec.canonicalBytes(committed.record).equals(desiredBytes)
    ? committed
    : null;
}

function syncCommittedTarget(target, expectedBytes, commitIdentity) {
  let descriptor = null;
  try {
    const initialPath = fs.lstatSync(target, { bigint: true });
    if (!initialPath.isFile() || initialPath.isSymbolicLink()) {
      fail(
        "wakeflow-transport-store-durability",
        "committed transport target is not one regular file",
      );
    }
    descriptor = fs.openSync(
      target,
      fs.constants.O_RDONLY
        | (fs.constants.O_NOFOLLOW ?? 0)
        | (fs.constants.O_NONBLOCK ?? 0),
    );
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.lstatSync(target, { bigint: true });
    if (
      !opened.isFile()
      || opened.uid !== BigInt(currentEuid())
      || opened.nlink !== 1n
      || modeOf(opened) !== FILE_MODE
      || !sameNode(initialPath, opened)
      || !sameNode(opened, linked)
      || !statMatchesCommitIdentity(opened, commitIdentity)
    ) {
      fail(
        "wakeflow-transport-store-durability",
        "committed transport target is not the exact private atomic-write result",
      );
    }
    const bytes = fs.readFileSync(descriptor);
    if (!bytes.equals(expectedBytes)) {
      fail(
        "wakeflow-transport-store-durability",
        "committed transport target bytes differ before durability sync",
      );
    }
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const afterPath = fs.lstatSync(target, { bigint: true });
    if (!sameNode(opened, after) || !sameNode(opened, afterPath)) {
      fail(
        "wakeflow-transport-store-durability",
        "committed transport target changed during durability sync",
      );
    }
  } catch (cause) {
    if (cause instanceof WakeflowTransportStoreError) throw cause;
    fail("wakeflow-transport-store-durability", "cannot durability-sync transport target", {
      cause,
    });
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
  syncPrivateDirectory(path.dirname(target), "committed transport target parent");
}

function normalizePublicationRecord(rawRecord, directoryName) {
  try {
    return RECORD_SPECS[directoryName].validate(rawRecord);
  } catch (cause) {
    return rejectedResult(cause, "wakeflow-transport-store-record");
  }
}

/**
 * 在调用方已持有T02 gate时发布一个record：先验证完整候选图，再原子create、fsync与strict post-scan。
 */
function publishRecordAdmitted(input, directoryName) {
  const normalized = normalizePublishInput(input, { admitted: true });
  assertWakeflowMutationContext({
    workspaceRoot: normalized.workspaceRoot,
    context: normalized.mutationContext,
    mode: "runtime-mutation",
  });
  const spec = RECORD_SPECS[directoryName];
  const record = normalizePublicationRecord(normalized.record, directoryName);
  if (record?.outcome === "rejected") return record;
  if (record.programId !== normalized.programId || record.demandId !== normalized.demandId) {
    return rejectedResult(new WakeflowTransportStoreError(
      "wakeflow-transport-store-authority",
      "transport record differs from the explicit programId or demandId authority",
    ));
  }

  let before;
  try {
    before = scanTransportDemand(normalized);
  } catch (cause) {
    if (directoryName !== "groups") return rejectedResult(cause);
    try {
      if (!isForwardCompletableEmptyDemandPrefix(
        normalized.workspaceRoot,
        normalized.demandId,
      )) {
        return rejectedResult(cause);
      }
      before = missingInventory(normalized.programId, normalized.demandId);
    } catch (prefixCause) {
      return rejectedResult(prefixCause);
    }
  }
  const id = record[spec.idField];
  const prior = existingEntry(before, directoryName, spec.idField, id);
  const desiredBytes = spec.canonicalBytes(record);
  if (prior) {
    const priorBytes = spec.canonicalBytes(prior.record);
    if (!priorBytes.equals(desiredBytes)) return conflictResult(directoryName, id);
    return deepFreeze({ outcome: "success", value: publicationValue("replayed", prior, before) });
  }

  try {
    validatePublicationGraph(before, directoryName, record, spec);
  } catch (cause) {
    return rejectedResult(cause, "wakeflow-transport-store-ancestor-integrity");
  }

  let mutationStarted = false;
  let ref = null;
  let target = null;
  let commitIdentity = null;
  try {
    const baseChain = inspectBaseChain(normalized.workspaceRoot);
    let demandRoot;
    if (before.status === "missing") {
      if (directoryName !== "groups") {
        return rejectedResult(new WakeflowTransportStoreError(
          "wakeflow-transport-store-ancestor-missing",
          `${directoryName} cannot create a transport demand without its exact dispatch group ancestor`,
        ));
      }
      mutationStarted = true;
      demandRoot = ensureDemandTree(normalized.workspaceRoot, normalized.demandId, baseChain);
    } else {
      demandRoot = path.join(baseChain.at(-1).directory, normalized.demandId);
    }
    ref = spec.ref(record);
    target = resolveRef(normalized.workspaceRoot, ref);
    if (path.dirname(target) !== path.join(demandRoot, directoryName)) {
      fail("wakeflow-transport-store-ref", "transport target does not match its exact demand tree");
    }
    mutationStarted = true;
    const result = atomicWriteFile({
      root: normalized.workspaceRoot,
      target,
      content: desiredBytes,
      expectation: { type: "absent" },
      captureCommitIdentity: true,
      mode: FILE_MODE,
      ownership: "whole-file",
      label: `immutable transport ${directoryName} record`,
    });
    commitIdentity = result.commitIdentity;
    syncCommittedTarget(target, desiredBytes, commitIdentity);
    const after = scanTransportDemand(normalized);
    const committed = publicationTransitionMatches({
      before,
      after,
      directoryName,
      record,
      spec,
      ref,
      desiredBytes,
      commitIdentity,
    });
    if (!committed) {
      fail(
        "wakeflow-transport-store-postscan",
        `transport ${directoryName} publication did not close under strict post-scan`,
      );
    }
    return deepFreeze({ outcome: "success", value: publicationValue("created", committed, after) });
  } catch (cause) {
    if (!mutationStarted) return rejectedResult(cause);
    if (commitIdentity !== null && ref !== null && target !== null) {
      try {
        const current = scanTransportDemand(normalized);
        const committed = publicationTransitionMatches({
          before,
          after: current,
          directoryName,
          record,
          spec,
          ref,
          desiredBytes,
          commitIdentity,
        });
        if (committed) {
          syncCommittedTarget(target, desiredBytes, commitIdentity);
          const settled = scanTransportDemand(normalized);
          const settledCommit = publicationTransitionMatches({
            before,
            after: settled,
            directoryName,
            record,
            spec,
            ref,
            desiredBytes,
            commitIdentity,
          });
          if (settledCommit) {
            return deepFreeze({
              outcome: "success",
              value: publicationValue("created", settledCommit, settled),
            });
          }
        }
      } catch {
        // 图、inode或durability任一不确定都必须向外抛出，让T02保留精确workspace gate作为恢复证据。
      }
    }
    throw new WakeflowTransportStoreError(
      "wakeflow-transport-store-recovery-required",
      "transport publication crossed its commit boundary without a proven durable post-state",
      { cause },
    );
  }
}

function normalizeReleaseEntries(value, { programId, demandId }) {
  exactDataFields(value, DIRECTORY_NAMES, "transport release entries");
  const normalized = {};
  for (const directoryName of DIRECTORY_NAMES) {
    const entries = field(value, directoryName);
    exactDataArray(entries, `transport release ${directoryName} entries`);
    const spec = RECORD_SPECS[directoryName];
    normalized[directoryName] = Array.from({ length: entries.length }, (_, index) => {
      const entry = Object.getOwnPropertyDescriptor(entries, String(index)).value;
      exactDataFields(
        entry,
        ["ref", "digest"],
        `transport release ${directoryName} entry ${index}`,
      );
      const ref = field(entry, "ref");
      const digest = field(entry, "digest");
      if (typeof ref !== "string" || typeof digest !== "string" || !DIGEST_RE.test(digest)) {
        fail(
          "wakeflow-transport-store-release-contract",
          `transport release ${directoryName} entry is invalid`,
        );
      }
      const expectedPrefix = `${DEMANDS_ROOT_REF}/${demandId}/${directoryName}/`;
      if (
        !ref.startsWith(expectedPrefix)
        || path.posix.dirname(ref) !== expectedPrefix.slice(0, -1)
        || !ref.endsWith(".json")
      ) {
        fail(
          "wakeflow-transport-store-release-contract",
          `transport release ${directoryName} ref is not canonical`,
        );
      }
      const id = ref.slice(expectedPrefix.length, -".json".length);
      assertWakeflowId(id, spec.idType, `$input/entries/${directoryName}/${index}/ref`);
      return Object.freeze({ ref, digest });
    });
    const refs = normalized[directoryName].map((entry) => entry.ref);
    const sorted = [...new Set(refs)].sort();
    if (
      sorted.length !== refs.length
      || sorted.some((ref, index) => ref !== refs[index])
    ) {
      fail(
        "wakeflow-transport-store-release-contract",
        `transport release ${directoryName} refs must be unique and lexically sorted`,
      );
    }
    Object.freeze(normalized[directoryName]);
  }
  const digest = inventoryDigest(programId, demandId, normalized);
  return Object.freeze({ entries: Object.freeze(normalized), inventoryDigest: digest });
}

// release participant 只接纳business archive已声明的完整inventory，不自行推断terminal或archive可信度。
function normalizeReleaseParticipantInput(input) {
  exactDataFields(input, [
    "workspaceRoot",
    "programId",
    "demandId",
    "archiveId",
    "sourceStatus",
    "inventoryDigest",
    "entries",
  ], "transport release participant input");
  const workspaceRoot = normalizeWorkspaceRoot(field(input, "workspaceRoot"));
  const programId = assertWakeflowId(field(input, "programId"), "program", "$input/programId");
  const demandId = assertWakeflowId(field(input, "demandId"), "demand", "$input/demandId");
  const archiveId = assertWakeflowId(field(input, "archiveId"), "archive", "$input/archiveId");
  const sourceStatus = field(input, "sourceStatus");
  if (!new Set(["empty", "current"]).has(sourceStatus)) {
    fail(
      "wakeflow-transport-store-release-contract",
      "transport release sourceStatus must be empty or current",
    );
  }
  const expectedInventoryDigest = field(input, "inventoryDigest");
  if (typeof expectedInventoryDigest !== "string" || !DIGEST_RE.test(expectedInventoryDigest)) {
    fail(
      "wakeflow-transport-store-release-contract",
      "transport release inventoryDigest is invalid",
    );
  }
  const normalizedEntries = normalizeReleaseEntries(field(input, "entries"), {
    programId,
    demandId,
  });
  const recordCount = Object.values(normalizedEntries.entries)
    .reduce((count, entries) => count + entries.length, 0);
  if (
    normalizedEntries.inventoryDigest !== expectedInventoryDigest
    || (sourceStatus === "empty" && recordCount !== 0)
    || (sourceStatus === "current" && recordCount === 0)
  ) {
    fail(
      "wakeflow-transport-store-release-contract",
      "transport release entries differ from their archived inventory declaration",
    );
  }
  const sourceRef = `${DEMANDS_ROOT_REF}/${demandId}`;
  const stagingRef = `${DEMANDS_ROOT_REF}/.${demandId}.${archiveId}.wakeflow-prune-stage`;
  return Object.freeze({
    workspaceRoot,
    programId,
    demandId,
    archiveId,
    sourceStatus,
    inventoryDigest: expectedInventoryDigest,
    entries: normalizedEntries.entries,
    sourceRef,
    stagingRef,
    source: resolveRef(workspaceRoot, sourceRef),
    staging: resolveRef(workspaceRoot, stagingRef),
  });
}

function releaseFileActions(input) {
  return RELEASE_DIRECTORY_ORDER.flatMap((directoryName) => (
    input.entries[directoryName].map((entry) => ({
      kind: "file",
      directoryName,
      ref: entry.ref,
      digest: entry.digest,
      fileName: path.posix.basename(entry.ref),
      key: `${directoryName}/${path.posix.basename(entry.ref)}`,
    }))
  ));
}

function releaseCleanupActions(input) {
  return Object.freeze([
    ...releaseFileActions(input),
    ...RELEASE_DIRECTORY_ORDER.map((directoryName) => ({
      kind: "directory",
      directoryName,
      key: `${directoryName}/`,
    })),
    { kind: "root", key: "." },
  ].map((entry) => Object.freeze(entry)));
}

function assertPathAbsent(candidate, label) {
  try {
    fs.lstatSync(candidate, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return;
    fail("wakeflow-transport-store-release-race", `cannot confirm absent ${label}`, { cause });
  }
  fail("wakeflow-transport-store-release-race", `${label} still exists after cleanup`);
}

// detached stage 只能是确定性cleanup后缀；越序缺口、陌生文件或身份漂移都阻断恢复。
function inspectReleaseStagePrefix(input, actions) {
  const rootStat = inspectPrivateDirectory(
    input.staging,
    "transport release stage",
    { allowMissing: true },
  );
  if (rootStat === null) {
    return Object.freeze({
      state: "absent",
      nextIndex: actions.length,
      rootStat: null,
      directoryStats: new Map(),
      fileSources: new Map(),
    });
  }

  let rootNames;
  try {
    rootNames = fs.readdirSync(input.staging).sort();
  } catch (cause) {
    fail("wakeflow-transport-store-release-stage", "cannot inspect transport release stage", { cause });
  }
  if (rootNames.some((name) => !DIRECTORY_NAMES.includes(name))) {
    fail(
      "wakeflow-transport-store-release-stage",
      "transport release stage contains an unknown member",
    );
  }

  const directoryStats = new Map();
  const fileSources = new Map();
  const presentDirectories = new Set(rootNames);
  for (const directoryName of DIRECTORY_NAMES) {
    const directory = path.join(input.staging, directoryName);
    const directoryStat = inspectPrivateDirectory(
      directory,
      `transport release ${directoryName} stage directory`,
      { allowMissing: true },
    );
    if (directoryStat === null) {
      if (presentDirectories.has(directoryName)) {
        fail(
          "wakeflow-transport-store-release-race",
          `transport release ${directoryName} stage directory changed during inspection`,
        );
      }
      continue;
    }
    if (!presentDirectories.has(directoryName)) {
      fail(
        "wakeflow-transport-store-release-race",
        `transport release ${directoryName} stage directory appeared during inspection`,
      );
    }
    directoryStats.set(directoryName, directoryStat);
    const expectedByName = new Map(input.entries[directoryName].map((entry) => [
      path.posix.basename(entry.ref),
      entry,
    ]));
    let names;
    try {
      names = fs.readdirSync(directory).sort();
    } catch (cause) {
      fail(
        "wakeflow-transport-store-release-stage",
        `cannot inspect transport release ${directoryName} entries`,
        { cause },
      );
    }
    if (names.some((name) => !expectedByName.has(name))) {
      fail(
        "wakeflow-transport-store-release-stage",
        `transport release ${directoryName} stage contains an unknown record`,
      );
    }
    for (const fileName of names) {
      const expected = expectedByName.get(fileName);
      const source = readPrivateCanonicalRecord({
        workspaceRoot: input.workspaceRoot,
        file: path.join(directory, fileName),
        fileName,
        programId: input.programId,
        demandId: input.demandId,
        directoryName,
        spec: RECORD_SPECS[directoryName],
        detachedDemandRoot: input.staging,
      });
      if (source.entry.ref !== expected.ref || source.entry.digest !== expected.digest) {
        fail(
          "wakeflow-transport-store-release-stage",
          `transport release ${directoryName} record differs from the archive declaration`,
        );
      }
      fileSources.set(`${directoryName}/${fileName}`, source.source);
    }
    assertDirectoryStillCurrent(
      directory,
      directoryStat,
      `transport release ${directoryName} stage directory`,
    );
  }
  const rootNamesAfter = fs.readdirSync(input.staging).sort();
  if (canonicalJson(rootNamesAfter) !== canonicalJson(rootNames)) {
    fail("wakeflow-transport-store-release-race", "transport release stage changed during inspection");
  }
  assertDirectoryStillCurrent(input.staging, rootStat, "transport release stage");

  const present = actions.map((action) => {
    if (action.kind === "file") return fileSources.has(action.key);
    if (action.kind === "directory") return directoryStats.has(action.directoryName);
    return true;
  });
  let sawPresent = false;
  let nextIndex = actions.length;
  for (let index = 0; index < present.length; index += 1) {
    if (present[index]) {
      if (!sawPresent) nextIndex = index;
      sawPresent = true;
    } else if (sawPresent) {
      fail(
        "wakeflow-transport-store-release-stage",
        "transport release stage is not one deterministic cleanup prefix",
      );
    }
  }
  return Object.freeze({
    state: nextIndex === 0 ? "full" : "partial",
    nextIndex,
    rootStat,
    directoryStats,
    fileSources,
  });
}

function assertExpectedReleaseInventory(input, inventory, label) {
  if (
    inventory.status !== input.sourceStatus
    || inventory.programId !== input.programId
    || inventory.demandId !== input.demandId
    || inventory.inventoryDigest !== input.inventoryDigest
  ) {
    fail(
      "wakeflow-transport-store-release-stale",
      `${label} differs from the exact archived transport inventory`,
    );
  }
}

function inspectTransportReleaseState(input, actions) {
  const sourceInventory = scanTransportDemand({
    workspaceRoot: input.workspaceRoot,
    programId: input.programId,
    demandId: input.demandId,
  });
  const stage = inspectReleaseStagePrefix(input, actions);
  if (sourceInventory.status !== "missing") {
    assertExpectedReleaseInventory(input, sourceInventory, "canonical transport demand root");
    if (stage.state !== "absent") {
      fail(
        "wakeflow-transport-store-release-stage",
        "canonical transport source and release stage cannot coexist",
      );
    }
    return Object.freeze({ state: "source", sourceInventory, stage });
  }
  if (stage.state === "absent") {
    return Object.freeze({ state: "absent", sourceInventory, stage });
  }
  return Object.freeze({
    state: stage.state === "full" ? "staged" : "cleanup-pending",
    sourceInventory,
    stage,
  });
}

function releaseDirectorySnapshot(ref, digest) {
  return Object.freeze({ ref, type: "directory", mode: "0700", digest });
}

function releaseAbsentSnapshot(ref) {
  return Object.freeze({ ref, type: "absent" });
}

function releaseObservation(input, state) {
  const source = releaseDirectorySnapshot(input.sourceRef, input.inventoryDigest);
  const staging = releaseDirectorySnapshot(input.stagingRef, input.inventoryDigest);
  const sourceAbsent = releaseAbsentSnapshot(input.sourceRef);
  const stagingAbsent = releaseAbsentSnapshot(input.stagingRef);
  if (state.state === "source") {
    return Object.freeze({ source, staging: stagingAbsent, final: source });
  }
  if (state.state === "staged") {
    return Object.freeze({ source: sourceAbsent, staging, final: sourceAbsent });
  }
  if (state.state === "absent") {
    return Object.freeze({ source: sourceAbsent, staging: stagingAbsent, final: sourceAbsent });
  }
  fail(
    "wakeflow-transport-store-release-stage",
    "partial transport cleanup cannot be represented as a committed resource snapshot",
  );
}

function assertReleaseMutationContext(input, context) {
  assertWakeflowMutationContext({ workspaceRoot: input.workspaceRoot, context });
}

// commit只做同父目录原子rename，把canonical source变为可恢复stage，不在此步删除字节。
function commitTransportReleaseRename(input, actions, context) {
  assertReleaseMutationContext(input, context);
  const state = inspectTransportReleaseState(input, actions);
  if (state.state !== "source") {
    fail(
      "wakeflow-transport-store-release-stale",
      "transport release commit requires the exact canonical source",
    );
  }
  const baseChain = inspectBaseChain(input.workspaceRoot);
  const parent = baseChain.at(-1).directory;
  const parentStat = baseChain.at(-1).stat;
  const sourceStat = inspectPrivateDirectory(input.source, "transport release source");
  assertPathAbsent(input.staging, "transport release stage");
  try {
    fs.renameSync(input.source, input.staging);
  } catch (cause) {
    fail(
      "wakeflow-transport-store-release-commit",
      "cannot atomically detach the transport demand root",
      { cause },
    );
  }
  assertPathAbsent(input.source, "transport release source");
  const stagedStat = inspectPrivateDirectory(input.staging, "transport release stage");
  if (!sameDirectoryNode(sourceStat, stagedStat)) {
    fail(
      "wakeflow-transport-store-release-race",
      "transport release stage does not preserve the detached source identity",
    );
  }
  assertDirectoryStillCurrent(parent, parentStat, "transport demands root");
  syncPrivateDirectory(parent, "transport demands root");
  const settled = inspectTransportReleaseState(input, actions);
  if (settled.state !== "staged") {
    fail(
      "wakeflow-transport-store-release-commit",
      "transport release rename did not settle as one complete staged demand root",
    );
  }
}

function unlinkReleaseFile(input, prefix, action) {
  const source = prefix.fileSources.get(action.key);
  const directoryStat = prefix.directoryStats.get(action.directoryName);
  if (!source || !directoryStat) {
    fail("wakeflow-transport-store-release-race", "transport release file identity is unavailable");
  }
  const directory = path.join(input.staging, action.directoryName);
  const file = path.join(directory, action.fileName);
  let current;
  try {
    current = fs.lstatSync(file, { bigint: true });
  } catch (cause) {
    fail("wakeflow-transport-store-release-race", "transport release file disappeared", { cause });
  }
  if (!sameNode(source.stat, current)) {
    fail("wakeflow-transport-store-release-race", "transport release file changed before cleanup");
  }
  try {
    fs.unlinkSync(file);
  } catch (cause) {
    fail("wakeflow-transport-store-release-cleanup", "cannot unlink exact transport record", { cause });
  }
  assertPathAbsent(file, "transport release record");
  assertDirectoryStillCurrent(
    directory,
    directoryStat,
    `transport release ${action.directoryName} stage directory`,
  );
  syncPrivateDirectory(directory, `transport release ${action.directoryName} stage directory`);
}

function removeReleaseDirectory(input, prefix, action) {
  const directory = path.join(input.staging, action.directoryName);
  const directoryStat = prefix.directoryStats.get(action.directoryName);
  if (!directoryStat || fs.readdirSync(directory).length !== 0) {
    fail(
      "wakeflow-transport-store-release-stage",
      "transport release directory is not an exact empty cleanup target",
    );
  }
  const rootStat = prefix.rootStat;
  assertDirectoryStillCurrent(
    directory,
    directoryStat,
    `transport release ${action.directoryName} stage directory`,
  );
  try {
    fs.rmdirSync(directory);
  } catch (cause) {
    fail("wakeflow-transport-store-release-cleanup", "cannot remove exact transport directory", { cause });
  }
  assertPathAbsent(directory, `transport release ${action.directoryName} stage directory`);
  assertDirectoryStillCurrent(input.staging, rootStat, "transport release stage");
  syncPrivateDirectory(input.staging, "transport release stage");
}

function removeReleaseRoot(input, prefix) {
  if (fs.readdirSync(input.staging).length !== 0) {
    fail("wakeflow-transport-store-release-stage", "transport release stage is not empty");
  }
  const baseChain = inspectBaseChain(input.workspaceRoot);
  const parent = baseChain.at(-1).directory;
  const parentStat = baseChain.at(-1).stat;
  assertDirectoryStillCurrent(input.staging, prefix.rootStat, "transport release stage");
  try {
    fs.rmdirSync(input.staging);
  } catch (cause) {
    fail("wakeflow-transport-store-release-cleanup", "cannot remove exact transport release stage", { cause });
  }
  assertPathAbsent(input.staging, "transport release stage");
  assertDirectoryStillCurrent(parent, parentStat, "transport demands root");
  syncPrivateDirectory(parent, "transport demands root");
}

// cleanup每轮重读并只执行下一个exact action，使crash后可从同一deterministic suffix继续。
function cleanupTransportRelease(input, actions, context) {
  assertReleaseMutationContext(input, context);
  for (;;) {
    const state = inspectTransportReleaseState(input, actions);
    if (state.state === "absent") return;
    if (!new Set(["staged", "cleanup-pending"]).has(state.state)) {
      fail(
        "wakeflow-transport-store-release-stale",
        "transport release cleanup requires a detached stage",
      );
    }
    const prefix = state.stage;
    const action = actions[prefix.nextIndex];
    if (!action) {
      fail("wakeflow-transport-store-release-stage", "transport release cleanup has no next exact action");
    }
    if (action.kind === "file") unlinkReleaseFile(input, prefix, action);
    else if (action.kind === "directory") removeReleaseDirectory(input, prefix, action);
    else removeReleaseRoot(input, prefix);
  }
}

/**
 * 为maintenance transaction构造一个transport demand release participant；它不签发删除准入。
 */
export function createTransportDemandReleaseParticipant(value = {}) {
  const input = normalizeReleaseParticipantInput(value);
  const actions = releaseCleanupActions(input);
  const step = deepFreeze({
    stepId: RELEASE_STEP_ID,
    ordinal: 0,
    stepKind: "remove",
    source: releaseDirectorySnapshot(input.sourceRef, input.inventoryDigest),
    staging: releaseDirectorySnapshot(input.stagingRef, input.inventoryDigest),
    final: releaseAbsentSnapshot(input.sourceRef),
  });
  const handler = Object.freeze({
    prepare({ context }) {
      assertReleaseMutationContext(input, context);
      const state = inspectTransportReleaseState(input, actions);
      if (state.state !== "source") {
        fail(
          "wakeflow-transport-store-release-stale",
          "transport release source changed before prepare",
        );
      }
    },
    observe({ context }) {
      assertReleaseMutationContext(input, context);
      return releaseObservation(input, inspectTransportReleaseState(input, actions));
    },
    commit({ context }) {
      commitTransportReleaseRename(input, actions, context);
    },
    cleanup({ context }) {
      cleanupTransportRelease(input, actions, context);
    },
  });
  return Object.freeze({
    step,
    handler,
    inspectState() {
      return inspectTransportReleaseState(input, actions);
    },
  });
}

function throwRejected(result) {
  throw new WakeflowTransportStoreError(result.code, result.message, result.details);
}

async function publishRecord(input, directoryName) {
  const normalized = normalizePublishInput(input, { admitted: false });
  let outcome;
  outcome = await withWakeflowRuntimeMutation({
    workspaceRoot: normalized.workspaceRoot,
    operationKind: `transport-publish-${directoryName}`,
    domainOwner: "delivery-runtime",
    ...(normalized.acquireTimeoutMs === undefined
      ? {}
      : { acquireTimeoutMs: normalized.acquireTimeoutMs }),
  }, (mutationContext) => publishRecordAdmitted({
    workspaceRoot: normalized.workspaceRoot,
    programId: normalized.programId,
    demandId: normalized.demandId,
    record: normalized.record,
    mutationContext,
  }, directoryName));
  if (outcome?.outcome === "rejected") throwRejected(outcome);
  if (outcome?.outcome !== "success") {
    fail("wakeflow-transport-store-mutation", "transport publication returned an invalid outcome");
  }
  return outcome.value;
}

/** 返回完整strict transport authority；任何结构或物理问题都会fail closed。 */
export function inspectTransportDemandAuthority(input = {}) {
  return scanTransportDemand(normalizeInspectInput(input));
}

/** 返回layout专用有界诊断；其中有效子图和inventoryDigest不得用于业务写入授权。 */
export function inspectTransportDemandForLayout(input = {}) {
  return scanTransportDemandForLayout(normalizeInspectInput(input));
}

/** 在已有mutation context内create-once发布group。 */
export function publishDispatchGroupAdmitted(input = {}) {
  return publishRecordAdmitted(input, "groups");
}

/** 在已有mutation context内create-once发布packet，并要求精确group祖先。 */
export function publishDispatchPacketAdmitted(input = {}) {
  return publishRecordAdmitted(input, "packets");
}

/** 在已有mutation context内create-once发布envelope，并要求精确group/packet祖先。 */
export function publishDeliveryEnvelopeAdmitted(input = {}) {
  return publishRecordAdmitted(input, "envelopes");
}

/** 在已有mutation context内append-only发布run，并闭合envelope与连续run chain。 */
export function appendDeliveryRunAdmitted(input = {}) {
  return publishRecordAdmitted(input, "runs");
}

/** 获取T02 gate后发布group的公开机械wrapper。 */
export async function publishDispatchGroup(input = {}) {
  return publishRecord(input, "groups");
}

/** 获取T02 gate后发布packet的公开机械wrapper。 */
export async function publishDispatchPacket(input = {}) {
  return publishRecord(input, "packets");
}

/** 获取T02 gate后发布envelope的公开机械wrapper。 */
export async function publishDeliveryEnvelope(input = {}) {
  return publishRecord(input, "envelopes");
}

/** 获取T02 gate后追加run的公开机械wrapper。 */
export async function appendDeliveryRun(input = {}) {
  return publishRecord(input, "runs");
}
