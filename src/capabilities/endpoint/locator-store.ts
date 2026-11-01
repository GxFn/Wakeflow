import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import { type JsonObject, parseJsonValue } from "../../foundation/data/json-value.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  replaceFileAtomically,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import {
  ExactRegularFileUnlinkError,
  unlinkRegularFileExactly,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { deriveUuidV4 } from "../../foundation/identity/uuid-v4.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  parseUtcInstant,
  type UtcInstant,
  UtcInstantError,
} from "../../foundation/time/utc-instant.js";
import { fail } from "../../kernel/error.js";
import { hostWindowLocatorsRootRef } from "../../kernel/layout.js";
import type { TmuxCoordinates, TmuxLocator } from "./pane-classification.js";

/**
 * Wakeflow Capabilities / Endpoint：Claude 窗口定位器记录（能力卡 2.3，ADR-0025 D3）。
 *
 * 定位器把一个绑定代际固定到窗口传输里的位置：tmux 传输是 socket、session、window、pane 四元组，
 * 桌面传输是桌面 app 的会话 id（`local_<uuid>`）。它是私有权威（0600）；替换时随新绑定重写，
 * 退役时删除。Codex 没有对等物。记录的 `provider` 与观察里带的定位子种类一致，读取方按它分派。
 */

const LOCATOR_KIND = "WakeflowWindowLocator";
const LOCATOR_MAXIMUM_BYTES = parseByteCount(16 * 1024, "$locator.maximumBytes");
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export interface DesktopSessionLocator {
  /** 桌面会话 id（`local_<uuid>`），由 Agent 的观察显式给出，不从句柄派生。 */
  readonly sessionId: string;
}

/** 定位器指向的传输位置；`provider` 是记录的判别字段。 */
export type WindowLocatorTarget =
  | Readonly<{ readonly provider: "tmux"; readonly tmux: TmuxCoordinates }>
  | Readonly<{ readonly provider: "desktop"; readonly desktop: DesktopSessionLocator }>;

interface WindowLocatorIdentity {
  readonly kind: "WakeflowWindowLocator";
  readonly schemaVersion: 1;
  readonly locatorId: string;
  readonly programId: string;
  readonly hostId: WakeflowHostId;
  readonly windowId: string;
  readonly bindingId: string;
  readonly registeredAt: UtcInstant;
}

export type WindowLocatorRecord = WindowLocatorIdentity & WindowLocatorTarget;

export type WindowLocatorRecordInput = Omit<
  WindowLocatorIdentity,
  "kind" | "schemaVersion" | "locatorId"
> &
  WindowLocatorTarget;

function windowLocatorRootRef(hostId: WakeflowHostId): PortableResourcePath {
  return hostWindowLocatorsRootRef(hostId);
}

function windowLocatorRef(hostId: WakeflowHostId, windowId: string): PortableResourcePath {
  return parsePortableResourcePath(`${windowLocatorRootRef(hostId)}/${windowId}.json`, "$locator");
}

/** 定位器代际由位置派生：同一绑定换了 pane 或桌面会话就是新的 locatorId。tmux 的派生保持原样，磁盘上的旧记录照常读回。 */
function locatorIdFor(input: WindowLocatorRecordInput): string {
  if (input.provider === "tmux") {
    return deriveUuidV4(
      "wakeflow-window-locator",
      input.hostId,
      input.windowId,
      input.bindingId,
      input.tmux.socketName ?? "",
      input.tmux.sessionName,
      input.tmux.windowId,
      input.tmux.paneId,
    );
  }
  return deriveUuidV4(
    "wakeflow-window-locator-desktop",
    input.hostId,
    input.windowId,
    input.bindingId,
    input.desktop.sessionId,
  );
}

export function createWindowLocatorRecord(
  input: WindowLocatorRecordInput,
): Readonly<WindowLocatorRecord> {
  const identity = {
    kind: LOCATOR_KIND,
    schemaVersion: 1 as const,
    locatorId: locatorIdFor(input),
    programId: input.programId,
    hostId: input.hostId,
    windowId: input.windowId,
    bindingId: input.bindingId,
  } as const;
  const registeredAt = parseUtcInstant(input.registeredAt, "$locator.registeredAt");
  if (input.provider === "tmux") {
    return Object.freeze({
      ...identity,
      provider: "tmux" as const,
      tmux: Object.freeze({ ...input.tmux }),
      registeredAt,
    });
  }
  return Object.freeze({
    ...identity,
    provider: "desktop" as const,
    desktop: Object.freeze({ sessionId: input.desktop.sessionId }),
    registeredAt,
  });
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    fail("invalid-request", "locator-record", path);
  }
  return value;
}

function plainObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid-request", "locator-record", path);
  }
  return value as JsonObject;
}

function parseLocatorTarget(record: JsonObject): WindowLocatorTarget {
  if (record.provider === "tmux") {
    const coordinates = plainObject(record.tmux, "$locator");
    return {
      provider: "tmux",
      tmux: {
        socketName:
          coordinates.socketName === null
            ? null
            : text(coordinates.socketName, "$locator.tmux.socketName"),
        sessionName: text(coordinates.sessionName, "$locator.tmux.sessionName"),
        windowId: text(coordinates.windowId, "$locator.tmux.windowId"),
        paneId: text(coordinates.paneId, "$locator.tmux.paneId"),
      },
    };
  }
  if (record.provider === "desktop") {
    const desktop = plainObject(record.desktop, "$locator");
    return {
      provider: "desktop",
      desktop: { sessionId: text(desktop.sessionId, "$locator.desktop.sessionId") },
    };
  }
  fail("invalid-request", "locator-record", "$locator");
}

function parseWindowLocatorRecord(
  value: unknown,
  hostId: WakeflowHostId,
): Readonly<WindowLocatorRecord> {
  const record = plainObject(parseJsonValue(value, "$locator"), "$locator");
  if (record.kind !== LOCATOR_KIND || record.schemaVersion !== 1) {
    fail("invalid-request", "locator-record", "$locator");
  }
  if (record.hostId !== hostId) {
    fail("invalid-request", "locator-record", "$locator.hostId");
  }
  const parsed = createWindowLocatorRecord({
    programId: text(record.programId, "$locator.programId"),
    hostId,
    windowId: text(record.windowId, "$locator.windowId"),
    bindingId: text(record.bindingId, "$locator.bindingId"),
    registeredAt: record.registeredAt as UtcInstant,
    ...parseLocatorTarget(record),
  });
  if (parsed.locatorId !== record.locatorId) {
    fail("invalid-request", "locator-record-id", "$locator.locatorId");
  }
  return parsed;
}

function renderWindowLocatorRecord(record: Readonly<WindowLocatorRecord>): string {
  return renderDeterministicJsonDocument(parseJsonValue(record, "$locator"), "$locator");
}

/** 只有 tmux 记录能变成 pane 分类器的定位器；调用方先按 `provider` 收窄。 */
export function toTmuxLocator(
  record: Readonly<Extract<WindowLocatorRecord, { readonly provider: "tmux" }>>,
): TmuxLocator {
  return Object.freeze({
    ...record.tmux,
    identity: Object.freeze({
      programId: record.programId,
      hostId: record.hostId,
      windowId: record.windowId,
      bindingId: record.bindingId,
      locatorId: record.locatorId,
    }),
  });
}

interface LocatorSource {
  readonly record: Readonly<WindowLocatorRecord>;
  readonly read: Awaited<ReturnType<typeof readDeterministicJsonFile>>;
}

async function readLocatorSource(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  windowId: string,
  signal: AbortSignal | undefined,
): Promise<LocatorSource | null> {
  try {
    const read = await readDeterministicJsonFile(root, windowLocatorRef(hostId, windowId), {
      maximumBytes: LOCATOR_MAXIMUM_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
    return {
      record: parseWindowLocatorRecord(
        parseDeterministicJsonDocument(read.text, "$locator"),
        hostId,
      ),
      read,
    };
  } catch (error: unknown) {
    if (error instanceof StableFileReadError && error.reason === "not-found") return null;
    if (error instanceof StableFileReadError) {
      fail("io-failure", `locator-read-${error.reason}`, "$locator", { cause: error });
    }
    // 私有定位器文件损坏：归入记录形状失败，而不是让基础层错误以 unexpected 逃出。
    if (
      error instanceof DeterministicJsonDocumentError ||
      error instanceof UtcInstantError ||
      error instanceof StrictTextFileError
    ) {
      fail("invalid-request", "locator-record", "$locator", { cause: error });
    }
    throw error;
  }
}

/** 读取某窗口的定位器；不存在返回 `null`。 */
export async function readWindowLocator(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  windowId: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<WindowLocatorRecord> | null> {
  return (await readLocatorSource(root, hostId, windowId, signal))?.record ?? null;
}

/** 写入或整体替换某窗口的定位器：绑定代际变化时定位器随之更换。 */
export async function writeWindowLocator(
  root: RootedDirectory,
  record: Readonly<WindowLocatorRecord>,
  signal: AbortSignal | undefined,
): Promise<PortableResourcePath> {
  const ref = windowLocatorRef(record.hostId, record.windowId);
  const options = signal === undefined ? {} : { signal };
  try {
    await materializeDirectoryPath(root, windowLocatorRootRef(record.hostId), {
      mode: DIRECTORY_MODE,
      ...options,
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      fail("io-failure", `locator-directory-${error.reason}`, "$locator", { cause: error });
    }
    throw error;
  }
  const bytes = encodeUtf8(renderWindowLocatorRecord(record), "$locator");
  const current = await readLocatorSource(root, record.hostId, record.windowId, signal);
  try {
    if (current === null) {
      await createFileAtomically(root, ref, bytes, { mode: FILE_MODE, ...options });
    } else if (current.read.text !== renderWindowLocatorRecord(record)) {
      await replaceFileAtomically(root, ref, bytes, {
        mode: FILE_MODE,
        expected: {
          resourcePath: current.read.resourcePath,
          node: current.read.node,
          byteCount: current.read.byteCount,
          digest: current.read.digest,
        },
        ...options,
      });
    }
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      fail("io-failure", `locator-write-${error.reason}`, "$locator", { cause: error });
    }
    throw error;
  }
  return ref;
}

/** 删除某窗口的定位器；不存在视为已完成。 */
export async function retireWindowLocator(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  windowId: string,
  signal: AbortSignal | undefined,
): Promise<"retired" | "absent"> {
  const current = await readLocatorSource(root, hostId, windowId, signal);
  if (current === null) return "absent";
  try {
    await unlinkRegularFileExactly(root, windowLocatorRef(hostId, windowId), {
      expectedNode: current.read.node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      fail("io-failure", `locator-retire-${error.reason}`, "$locator", { cause: error });
    }
    throw error;
  }
  return "retired";
}
