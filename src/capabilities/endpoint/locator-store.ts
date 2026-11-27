import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import { type JsonObject, parseJsonValue } from "../../foundation/data/json-value.js";
import {
  type DeterministicJsonFileResult,
  readDeterministicJsonFileOrNull,
} from "../../foundation/filesystem/deterministic-json-file.js";
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
import { fail, failIo } from "../../kernel/error.js";
import { hostWindowLocatorsRootRef } from "../../kernel/layout.js";
import type {
  WakeflowWindowLocator,
  WakeflowWindowLocatorCodec,
  WakeflowWindowLocatorTarget,
} from "../../workspace/host-runtime/wakeflow-window-transport-port.js";

/**
 * Wakeflow Capabilities / Endpoint：窗口定位器记录（能力卡 2.3，ADR-0025 D3；open-items L6）。
 *
 * 定位器把一个绑定代际固定到窗口传输里的位置。它是私有权威（0600）；替换时随新绑定重写，退役时删除。
 * 没有定位子的宿主没有这份记录。
 *
 * 这里只管与传输无关的部分：记录的身份字段、读写与代际标识的核对。位置本身是一段载荷，形状归传输——
 * 记录里存成 `{ provider, [provider]: 载荷 }`，载荷的解析与代际标识的派生输入由宿主交来的编解码器给出
 * （`WakeflowWindowLocatorCodec`）。本模块按记录里的 `provider` 找编解码器，从不拿传输的名字分支；
 * 找不到编解码器的记录与损坏的记录同样处理。磁盘上的字节与 1.3.0 相同。
 */

const LOCATOR_KIND = "WakeflowWindowLocator";
const LOCATOR_MAXIMUM_BYTES = parseByteCount(16 * 1024, "$locator.maximumBytes");
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

type LocatorCodecs = readonly Readonly<WakeflowWindowLocatorCodec>[];

/** 一条定位记录：身份、位置（传输名加载荷）与登记时刻。 */
export interface WindowLocatorRecord extends WakeflowWindowLocator {
  readonly kind: "WakeflowWindowLocator";
  readonly schemaVersion: 1;
  readonly hostId: WakeflowHostId;
  readonly registeredAt: UtcInstant;
}

export interface WindowLocatorRecordInput {
  readonly programId: string;
  readonly hostId: WakeflowHostId;
  readonly windowId: string;
  readonly bindingId: string;
  readonly registeredAt: UtcInstant;
  readonly target: Readonly<WakeflowWindowLocatorTarget>;
}

function windowLocatorRootRef(hostId: WakeflowHostId): PortableResourcePath {
  return hostWindowLocatorsRootRef(hostId);
}

function windowLocatorRef(hostId: WakeflowHostId, windowId: string): PortableResourcePath {
  return parsePortableResourcePath(`${windowLocatorRootRef(hostId)}/${windowId}.json`, "$locator");
}

function invalidLocatorRecord(path: string): never {
  fail("invalid-request", "locator-record", path);
}

/** 记录里点名的传输的编解码器；宿主不认得这种传输时与损坏的记录同样处理。 */
function codecFor(codecs: LocatorCodecs, provider: unknown): Readonly<WakeflowWindowLocatorCodec> {
  const codec =
    typeof provider === "string" ? codecs.find((entry) => entry.provider === provider) : undefined;
  if (codec === undefined) invalidLocatorRecord("$locator");
  return codec;
}

/**
 * 定位器代际由位置派生：同一绑定换了位置就是新的 locatorId。派生输入是传输给的命名空间、记录的三个身份
 * 字段与载荷里参与派生的各段——顺序是合同，磁盘上的旧记录靠它读回。
 */
export function createWindowLocatorRecord(
  input: Readonly<WindowLocatorRecordInput>,
  codecs: LocatorCodecs,
): Readonly<WindowLocatorRecord> {
  const codec = codecFor(codecs, input.target.provider);
  const payload = codec.parsePayload(input.target.payload, invalidLocatorRecord);
  const seed = codec.identitySeed(payload);
  return Object.freeze({
    kind: LOCATOR_KIND,
    schemaVersion: 1 as const,
    locatorId: deriveUuidV4(
      seed.namespace,
      input.hostId,
      input.windowId,
      input.bindingId,
      ...seed.parts,
    ),
    programId: input.programId,
    hostId: input.hostId,
    windowId: input.windowId,
    bindingId: input.bindingId,
    provider: codec.provider,
    payload,
    registeredAt: input.registeredAt,
  });
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    invalidLocatorRecord(path);
  }
  return value;
}

function plainObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidLocatorRecord(path);
  }
  return value as JsonObject;
}

function parseWindowLocatorRecord(
  value: unknown,
  hostId: WakeflowHostId,
  codecs: LocatorCodecs,
): Readonly<WindowLocatorRecord> {
  const record = plainObject(parseJsonValue(value, "$locator"), "$locator");
  if (record.kind !== LOCATOR_KIND || record.schemaVersion !== 1) {
    invalidLocatorRecord("$locator");
  }
  if (record.hostId !== hostId) {
    invalidLocatorRecord("$locator.hostId");
  }
  const programId = text(record.programId, "$locator.programId");
  const windowId = text(record.windowId, "$locator.windowId");
  const bindingId = text(record.bindingId, "$locator.bindingId");
  const codec = codecFor(codecs, record.provider);
  const parsed = createWindowLocatorRecord(
    {
      programId,
      hostId,
      windowId,
      bindingId,
      registeredAt: parseUtcInstant(record.registeredAt, "$locator.registeredAt"),
      target: {
        provider: codec.provider,
        payload: plainObject(record[codec.provider], "$locator"),
      },
    },
    codecs,
  );
  if (parsed.locatorId !== record.locatorId) {
    fail("invalid-request", "locator-record-id", "$locator.locatorId");
  }
  return parsed;
}

/** 落盘的文档：身份字段、`provider`、以传输名为键的载荷、登记时刻。 */
function renderWindowLocatorRecord(record: Readonly<WindowLocatorRecord>): string {
  const document = {
    kind: record.kind,
    schemaVersion: record.schemaVersion,
    locatorId: record.locatorId,
    programId: record.programId,
    hostId: record.hostId,
    windowId: record.windowId,
    bindingId: record.bindingId,
    provider: record.provider,
    [record.provider]: record.payload,
    registeredAt: record.registeredAt,
  };
  return renderDeterministicJsonDocument(parseJsonValue(document, "$locator"), "$locator");
}

interface LocatorSource {
  readonly record: Readonly<WindowLocatorRecord>;
  readonly read: Readonly<DeterministicJsonFileResult>;
}

async function readLocatorSource(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  windowId: string,
  codecs: LocatorCodecs,
  signal: AbortSignal | undefined,
): Promise<LocatorSource | null> {
  try {
    const read = await readDeterministicJsonFileOrNull(root, windowLocatorRef(hostId, windowId), {
      maximumBytes: LOCATOR_MAXIMUM_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
    if (read === null) return null;
    return {
      record: parseWindowLocatorRecord(
        parseDeterministicJsonDocument(read.text, "$locator"),
        hostId,
        codecs,
      ),
      read,
    };
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) failIo("locator-read", "$locator", error);
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
  codecs: LocatorCodecs,
  signal: AbortSignal | undefined,
): Promise<Readonly<WindowLocatorRecord> | null> {
  return (await readLocatorSource(root, hostId, windowId, codecs, signal))?.record ?? null;
}

/**
 * 某窗口当前绑定代际的定位器（open-items X15）：记录在、并且记录的 `bindingId` 等于调用方给出的绑定时
 * 返回它；记录不在或属于另一代绑定都返回 `null`。载荷里有什么由调用方的宿主自己读——这里不看传输。
 */
export async function readBoundWindowLocator(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  windowId: string,
  bindingId: string,
  codecs: LocatorCodecs,
  signal: AbortSignal | undefined,
): Promise<Readonly<WindowLocatorRecord> | null> {
  const record = await readWindowLocator(root, hostId, windowId, codecs, signal);
  return record === null || record.bindingId !== bindingId ? null : record;
}

/** 写入或整体替换某窗口的定位器：绑定代际变化时定位器随之更换。 */
export async function writeWindowLocator(
  root: RootedDirectory,
  record: Readonly<WindowLocatorRecord>,
  codecs: LocatorCodecs,
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
    if (error instanceof DurableDirectoryMaterializationError)
      failIo("locator-directory", "$locator", error);
    throw error;
  }
  const bytes = encodeUtf8(renderWindowLocatorRecord(record), "$locator");
  const current = await readLocatorSource(root, record.hostId, record.windowId, codecs, signal);
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
    if (error instanceof DurableAtomicFileWriteError) failIo("locator-write", "$locator", error);
    throw error;
  }
  return ref;
}

/** 删除某窗口的定位器；不存在视为已完成。 */
export async function retireWindowLocator(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  windowId: string,
  codecs: LocatorCodecs,
  signal: AbortSignal | undefined,
): Promise<"retired" | "absent"> {
  const current = await readLocatorSource(root, hostId, windowId, codecs, signal);
  if (current === null) return "absent";
  try {
    await unlinkRegularFileExactly(root, windowLocatorRef(hostId, windowId), {
      expectedNode: current.read.node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) failIo("locator-retire", "$locator", error);
    throw error;
  }
  return "retired";
}
