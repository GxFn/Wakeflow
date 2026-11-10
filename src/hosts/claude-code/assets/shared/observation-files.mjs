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
 * 成功结果里的宿主观察各另存一份并附上引用：`observation` → `observationFile`，`closure` → `closureFile`。
 * 它们是登记工具的 observation、closure 与 evidence.liveness 认的那个对象，原样传过去即可。
 * @param {string} command
 * @param {JsonRecord} result
 * @returns {JsonRecord}
 */
export function withObservationFiles(command, result) {
  if (result.ok !== true) return result;
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
  return { ...result, ...references };
}
