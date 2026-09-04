import {
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import { parseJsonValue, type JsonObject } from "../../foundation/data/json-value.js";
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
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { deriveUuidV4 } from "../../foundation/identity/uuid-v4.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { parseUtcInstant, type UtcInstant } from "../../foundation/time/utc-instant.js";
import { fail } from "../../kernel/error.js";
import { hostRuntimeRootRef } from "../../kernel/layout.js";
import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";
import type { TmuxCoordinates, TmuxLocator } from "./pane-classification.js";

/**
 * Wakeflow Capabilities / Endpoint：Claude 窗口定位器记录（能力卡 2.3）。
 *
 * 定位器把一个绑定代际固定到 tmux 的 socket、session、window、pane 四元组，是
 * 私有权威（0600）；替换时随新绑定重写，退役时删除。Codex 没有对等物。
 */

const LOCATOR_KIND = "WakeflowWindowLocator";
const LOCATOR_MAXIMUM_BYTES = parseByteCount(16 * 1024, "$locator.maximumBytes");
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export interface WindowLocatorRecord {
  readonly kind: "WakeflowWindowLocator";
  readonly schemaVersion: 1;
  readonly locatorId: string;
  readonly programId: string;
  readonly hostId: WakeflowHostId;
  readonly windowId: string;
  readonly bindingId: string;
  readonly provider: "tmux";
  readonly tmux: TmuxCoordinates;
  readonly registeredAt: UtcInstant;
}

function windowLocatorRootRef(hostId: WakeflowHostId): PortableResourcePath {
  return parsePortableResourcePath(
    `${hostRuntimeRootRef(hostId)}/identity/window-locators`,
    "$locator",
  );
}

function windowLocatorRef(hostId: WakeflowHostId, windowId: string): PortableResourcePath {
  return parsePortableResourcePath(`${windowLocatorRootRef(hostId)}/${windowId}.json`, "$locator");
}

export function createWindowLocatorRecord(
  input: Omit<WindowLocatorRecord, "kind" | "schemaVersion" | "locatorId" | "provider">,
): Readonly<WindowLocatorRecord> {
  const locatorId = deriveUuidV4(
    "wakeflow-window-locator",
    input.hostId,
    input.windowId,
    input.bindingId,
    input.tmux.socketName ?? "",
    input.tmux.sessionName,
    input.tmux.windowId,
    input.tmux.paneId,
  );
  return Object.freeze({
    kind: LOCATOR_KIND,
    schemaVersion: 1,
    locatorId,
    programId: input.programId,
    hostId: input.hostId,
    windowId: input.windowId,
    bindingId: input.bindingId,
    provider: "tmux",
    tmux: Object.freeze({ ...input.tmux }),
    registeredAt: parseUtcInstant(input.registeredAt, "$locator.registeredAt"),
  });
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    fail("invalid-request", "locator-record", path);
  }
  return value;
}

function parseWindowLocatorRecord(value: unknown): Readonly<WindowLocatorRecord> {
  const json = parseJsonValue(value, "$locator");
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    fail("invalid-request", "locator-record", "$locator");
  }
  const record = json as JsonObject;
  const tmux = record.tmux;
  if (
    record.kind !== LOCATOR_KIND ||
    record.schemaVersion !== 1 ||
    record.provider !== "tmux" ||
    typeof tmux !== "object" ||
    tmux === null ||
    Array.isArray(tmux)
  ) {
    fail("invalid-request", "locator-record", "$locator");
  }
  const coordinates = tmux as JsonObject;
  const parsed = createWindowLocatorRecord({
    programId: text(record.programId, "$locator.programId"),
    hostId: record.hostId as WakeflowHostId,
    windowId: text(record.windowId, "$locator.windowId"),
    bindingId: text(record.bindingId, "$locator.bindingId"),
    tmux: {
      socketName:
        coordinates.socketName === null
          ? null
          : text(coordinates.socketName, "$locator.tmux.socketName"),
      sessionName: text(coordinates.sessionName, "$locator.tmux.sessionName"),
      windowId: text(coordinates.windowId, "$locator.tmux.windowId"),
      paneId: text(coordinates.paneId, "$locator.tmux.paneId"),
    },
    registeredAt: record.registeredAt as UtcInstant,
  });
  if (parsed.locatorId !== record.locatorId) {
    fail("invalid-request", "locator-record-id", "$locator.locatorId");
  }
  return parsed;
}

function renderWindowLocatorRecord(record: Readonly<WindowLocatorRecord>): string {
  return renderDeterministicJsonDocument(parseJsonValue(record, "$locator"), "$locator");
}

export function toTmuxLocator(record: Readonly<WindowLocatorRecord>): TmuxLocator {
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
      record: parseWindowLocatorRecord(parseDeterministicJsonDocument(read.text, "$locator")),
      read,
    };
  } catch (error: unknown) {
    if (error instanceof StableFileReadError && error.reason === "not-found") return null;
    if (error instanceof StableFileReadError) {
      fail("io-failure", `locator-read-${error.reason}`, "$locator", { cause: error });
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
