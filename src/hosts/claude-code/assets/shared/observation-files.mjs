// 宿主观察落盘（两个助手共用，open-items K2）：登记、关窗与存活观察另存成私有观察目录里的一个文件，输出里附上
// 它的引用与摘要。Agent 把引用交给登记工具，不必把几千字的 JSON 逐字抄一遍；内联的观察照旧在输出里。

import { randomUUID } from "node:crypto";
import { mkdirSync, opendirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sha256 } from "./text.mjs";
import { HELPER_OBSERVATIONS, ROOT } from "./workspace.mjs";

// 观察文件只为紧接着的那一次登记调用存在：一天之后由下一次落盘顺手清掉，每次至多看这么多个条目。
const OBSERVATION_FILE_RETENTION_MS = 24 * 60 * 60 * 1000;
const OBSERVATION_FILE_SCAN_MAXIMUM = 512;

/** @param {string} directory */
function pruneObservationFiles(directory) {
  const deadline = Date.now() - OBSERVATION_FILE_RETENTION_MS;
  let handle = null;
  try {
    handle = opendirSync(directory);
    for (let seen = 0; seen < OBSERVATION_FILE_SCAN_MAXIMUM; seen += 1) {
      const entry = handle.readSync();
      if (entry === null) break;
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = path.join(directory, entry.name);
      try {
        if (statSync(file).mtimeMs < deadline) unlinkSync(file);
      } catch {
        // 别的助手进程刚清掉它，或它正被写入
      }
    }
  } catch {
    // 清理只是顺手：读不了目录不影响这一次落盘
  } finally {
    if (handle !== null) {
      try {
        handle.closeSync();
      } catch {
        // already closed
      }
    }
  }
}

/**
 * 把一份宿主观察写成私有观察目录里的一个文件（目录 0700、文件 0600，文件名不重复），返回登记工具认的引用：
 * 相对工作区根的路径与字节摘要。写不成返回 null——观察仍内联在输出里，只是没有引用。
 * @param {string} kind
 * @param {JsonRecord} value
 * @returns {{ file: string, digest: string } | null}
 */
function writeObservationFile(kind, value) {
  const text = `${JSON.stringify(value)}\n`;
  const directory = path.join(ROOT, ...HELPER_OBSERVATIONS.split("/"));
  const stamp = new Date().toISOString().replace(/[-:.]/gu, "");
  const name = `${stamp}-${kind}-${randomUUID()}.json`;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    pruneObservationFiles(directory);
    writeFileSync(path.join(directory, name), text, { mode: 0o600, flag: "wx" });
    return { file: `${HELPER_OBSERVATIONS}/${name}`, digest: sha256(text) };
  } catch {
    return null;
  }
}

/**
 * 一次投递的结局另存一份并附上引用（ADR-0029 决定 4）：`outcomeFile` 原样作为结局工具的 `outcome` 传过去，
 * 不必把 attempt 与 readback 抄一遍，也不必自己写观察时刻。tmux 的 `deliver` 只要给出了 attempt 就落盘——
 * 送出、送前失败、结果未知都是可记的结局；这段 prompt 早已落地（`already-landed`）与桌面的 `landing` 查到
 * 落地记录是同一种情形：发送发生过，记的是 `sent`。别的情形不落盘，结局照旧由 Agent 内联给出。
 * @param {string} command
 * @param {JsonRecord} result
 * @returns {JsonRecord}
 */
function outcomeFileOf(command, result) {
  /** @type {JsonRecord | null} */
  let outcome = null;
  const landed =
    (command === "deliver" && result.reason === "already-landed") ||
    (command === "landing" && result.landed === true);
  if (landed) {
    outcome = { attempt: { status: "sent" } };
  } else if (
    command === "deliver" &&
    result.attempt !== null &&
    typeof result.attempt === "object"
  ) {
    const readback = result.readback;
    outcome = {
      attempt: result.attempt,
      ...(readback !== null && typeof readback === "object" ? { readback } : {}),
    };
  }
  if (outcome === null) return {};
  const reference = writeObservationFile("outcome", {
    ...outcome,
    observedAt: new Date().toISOString(),
  });
  return reference === null ? {} : { outcomeFile: reference };
}

/**
 * 成功结果里的宿主观察各另存一份并附上引用：`observation` → `observationFile`，`closure` → `closureFile`。
 * 它们是登记工具的 observation、closure 与 evidence.liveness 认的那个对象，原样传过去即可。投递的结局
 * 不论成败都可能要记，所以它的引用（`outcomeFile`）在成功与失败的结果里都附。
 * @param {string} command
 * @param {JsonRecord} result
 * @returns {JsonRecord}
 */
export function withObservationFiles(command, result) {
  const outcome = outcomeFileOf(command, result);
  if (result.ok !== true) return { ...result, ...outcome };
  /** @type {JsonRecord} */
  const references = {};
  for (const [field, target] of [
    ["observation", "observationFile"],
    ["closure", "closureFile"],
  ]) {
    const value = result[field];
    if (value === null || typeof value !== "object") continue;
    const reference = writeObservationFile(command, value);
    if (reference !== null) references[target] = reference;
  }
  return { ...result, ...references, ...outcome };
}
