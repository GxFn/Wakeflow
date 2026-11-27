import type { WakeflowHostId } from "../contracts/vocabulary/wakeflow-host-id.js";
import { type JsonValue, parseJsonValue } from "../foundation/data/json-value.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../foundation/filesystem/stable-directory-read.js";
import { readStableFile, StableFileReadError } from "../foundation/filesystem/stable-file-read.js";
import { OperationAbortedError } from "../foundation/node/abort-signal.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { decodeUtf8 } from "../foundation/text/utf8.js";
import { fail } from "./error.js";
import { hostHelperObservationsRootRef } from "./layout.js";

/**
 * Wakeflow Kernel / Helper Observation File：按引用读回助手落盘的一份观察（open-items K2，ADR-0029 决定 4）。
 *
 * 助手把宿主观察——登记、关窗、存活，以及一次投递的结局——写进本宿主的私有观察目录并给出文件与摘要，
 * Agent 传引用而不是把 JSON 逐字抄一遍。这里按引用读回：只认本宿主那个目录里的文件、有界、不跟随符号
 * 链接、字节摘要必须相符。读回来的内容与内联给出的没有区别：它仍是 Agent 转报的观察，不因为走了文件就
 * 多一分可信；内容的形状由调用它的切片用自己的 Schema 重新准入。
 */

export interface HelperObservationFileReference {
  readonly file: string;
  readonly digest: string;
}

/** 助手一次观察的上限：16 个 pane 的两份清单加 git worktree 原文远小于它。 */
const OBSERVATION_FILE_MAXIMUM_BYTES = parseByteCount(256 * 1024, "$observationFile.maximumBytes");

/** 观察文件直接放在那个目录下，名字是助手起的：不认子目录，也不认别的扩展名。 */
const OBSERVATION_FILE_NAME_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}\.json$/u;

export function isHelperObservationFileReference(
  value: unknown,
): value is HelperObservationFileReference {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { file?: unknown }).file === "string" &&
    typeof (value as { digest?: unknown }).digest === "string"
  );
}

/** 读回一份观察文件的 JSON 内容；`path` 是请求里那个引用成员的路径，拒绝时点名它。 */
export async function readHelperObservationFile(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  reference: Readonly<HelperObservationFileReference>,
  path: string,
  signal?: AbortSignal,
): Promise<JsonValue> {
  const directory = `${hostHelperObservationsRootRef(hostId)}/`;
  if (
    !reference.file.startsWith(directory) ||
    !OBSERVATION_FILE_NAME_PATTERN.test(reference.file.slice(directory.length))
  ) {
    fail("invalid-request", "observation-file-host", `${path}.file`);
  }
  let read: Awaited<ReturnType<typeof readStableFile>>;
  try {
    read = await readStableFile(root, parsePortableResourcePath(reference.file, `${path}.file`), {
      maximumBytes: OBSERVATION_FILE_MAXIMUM_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      fail("precondition-failed", `observation-file-${error.reason}`, `${path}.file`, {
        cause: error,
      });
    }
    throw error;
  }
  if (read.digest !== reference.digest) {
    fail("precondition-failed", "observation-file-digest", `${path}.digest`);
  }
  try {
    return parseJsonValue(JSON.parse(decodeUtf8(read.bytes, path)), path);
  } catch {
    fail("precondition-failed", "observation-file-content", `${path}.file`);
  }
}

/** 助手推过一次续跑短句留下的记录（open-items H13）：哪个窗口、短句的摘要、什么时候。 */
export interface HelperNudgeRecord {
  readonly windowId: string;
  readonly textDigest: string;
  readonly sentAt: string;
}

const NUDGE_FILE_NAME_PATTERN = /^[0-9A-Za-z]{1,32}-nudge-[0-9a-f-]{36}\.json$/u;
const NUDGE_FILE_MAXIMUM_BYTES = parseByteCount(4 * 1024, "$nudgeFile.maximumBytes");
const NUDGE_DIRECTORY_MAXIMUM_ENTRIES = 4096;
const NUDGE_RECORDS_MAXIMUM = 256;
const NUDGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const NUDGE_WINDOW_PATTERN =
  /^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function nudgeRecordOf(value: unknown): Readonly<HelperNudgeRecord> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  const { windowId, textDigest, sentAt } = record;
  if (record.kind !== "WakeflowWindowNudge") return null;
  if (typeof windowId !== "string" || !NUDGE_WINDOW_PATTERN.test(windowId)) return null;
  if (typeof textDigest !== "string" || !NUDGE_DIGEST_PATTERN.test(textDigest)) return null;
  if (typeof sentAt !== "string" || Number.isNaN(Date.parse(sentAt))) return null;
  return Object.freeze({ windowId, textDigest, sentAt });
}

/** 目录里名字是续跑记录的文件，新的在前；目录不在或读不出即没有。 */
async function nudgeFileNames(
  root: RootedDirectory,
  directory: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<readonly string[]> {
  try {
    const listing = await readStableResourceDirectory(root, directory, {
      maximumEntries: NUDGE_DIRECTORY_MAXIMUM_ENTRIES,
      ...(signal === undefined ? {} : { signal }),
    });
    return listing.entries
      .filter((entry) => entry.node.kind === "file" && NUDGE_FILE_NAME_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse()
      .slice(0, NUDGE_RECORDS_MAXIMUM);
  } catch (error: unknown) {
    if (!(error instanceof StableDirectoryReadError)) throw error;
    return Object.freeze([]);
  }
}

/** 一个续跑记录文件；读不出、不是 JSON 或形状不对都当作没有这一条。 */
async function readNudgeRecord(
  root: RootedDirectory,
  file: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<Readonly<HelperNudgeRecord> | null> {
  try {
    const read = await readStableFile(root, file, {
      maximumBytes: NUDGE_FILE_MAXIMUM_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
    return nudgeRecordOf(JSON.parse(decodeUtf8(read.bytes, "$nudgeFile")));
  } catch (error: unknown) {
    if (error instanceof OperationAbortedError) throw error;
    return null;
  }
}

/**
 * 本宿主的助手留下的续跑短句记录，新的在前、至多 256 条。它只用来归类目标会话里的 prompt：目录不在、
 * 某个文件读不出或形状不对都当作没有那一条——少认一条的后果是那条 prompt 被算成任务包之外来的，
 * 评审者看得见并且可以追问，不会漏报。中止照常上抛。
 */
export async function listHelperNudgeRecords(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  signal?: AbortSignal,
): Promise<readonly Readonly<HelperNudgeRecord>[]> {
  const directory = hostHelperObservationsRootRef(hostId);
  const records: Readonly<HelperNudgeRecord>[] = [];
  for (const name of await nudgeFileNames(root, directory, signal)) {
    const record = await readNudgeRecord(
      root,
      parsePortableResourcePath(`${directory}/${name}`, "$nudgeFile"),
      signal,
    );
    if (record !== null) records.push(record);
  }
  return Object.freeze(records);
}
