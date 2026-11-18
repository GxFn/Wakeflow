import type { WakeflowHostId } from "../contracts/vocabulary/wakeflow-host-id.js";
import { type JsonValue, parseJsonValue } from "../foundation/data/json-value.js";
import { parsePortableResourcePath } from "../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import { readStableFile, StableFileReadError } from "../foundation/filesystem/stable-file-read.js";
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
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
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
