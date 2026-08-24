import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Wakeflow共享路径准入primitive。
 *
 * 阅读地图：pathIsInside只回答词法包含；inspectFutureFileInside逐层拒绝symlink和错误节点，
 * 并描述一个已存在或未来单文件目标。两者都不提供owner、内容稳定性、CAS、锁或事务证明。
 */

export class WakeflowFsSafetyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "WakeflowFsSafetyError";
    this.code = details.code ?? details.reason ?? "fs-safety-error";
    this.details = {
      ...details,
      code: this.code,
    };
  }
}

// ==================== 一、纯词法包含关系 ====================

/** 只比较两个路径的词法包含关系；不读取filesystem，也不证明realpath或owner。 */
export function pathIsInside(root, candidate) {
  if (typeof root !== "string" || typeof candidate !== "string") return false;
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

// ==================== 二、未来单文件目标准入 ====================

/**
 * 检查existing root下的未来regular-file目标，不要求目标或全部后代目录已经存在。
 *
 * 返回词法/物理root、最近existing ancestor、缺失段和目标类型；不创建目录、不跟随symlink、
 * 不写入、不加业务锁，也不声称关闭其他进程的竞态。writer仍须在自己的commit边界重验source。
 */
export function inspectFutureFileInside(input = undefined) {
  const { root, candidate, label } = normalizeFutureFileInput(input);
  if (typeof root !== "string" || !root.trim()) {
    throw new WakeflowFsSafetyError(`${label} root must be a non-empty path string`, {
      code: "invalid-root",
      root,
      candidate,
    });
  }
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new WakeflowFsSafetyError(`${label} must be a non-empty path string`, {
      code: "invalid-candidate",
      root,
      candidate,
    });
  }

  const lexicalRoot = path.resolve(root);
  const lexicalCandidate = path.resolve(candidate);
  if (!pathIsInside(lexicalRoot, lexicalCandidate) || lexicalRoot === lexicalCandidate) {
    throw new WakeflowFsSafetyError(`${label} must stay below ${lexicalRoot}: ${lexicalCandidate}`, {
      code: "lexical-containment",
      root: lexicalRoot,
      candidate: lexicalCandidate,
    });
  }

  let rootStat;
  try {
    rootStat = lstatSync(lexicalRoot);
  } catch (cause) {
    const code = cause?.code === "ENOENT" ? "root-missing" : "root-inspection-failed";
    throw new WakeflowFsSafetyError(`cannot inspect ${label} root ${lexicalRoot}: ${cause.message}`, {
      code,
      root: lexicalRoot,
      candidate: lexicalCandidate,
      cause,
    });
  }
  if (rootStat.isSymbolicLink()) {
    throw new WakeflowFsSafetyError(`${label} root cannot be a symbolic link: ${lexicalRoot}`, {
      code: "root-symlink",
      root: lexicalRoot,
      candidate: lexicalCandidate,
    });
  }
  if (!rootStat.isDirectory()) {
    throw new WakeflowFsSafetyError(`${label} root must be a directory: ${lexicalRoot}`, {
      code: "root-type",
      root: lexicalRoot,
      candidate: lexicalCandidate,
      actualType: statType(rootStat),
    });
  }

  let realRoot;
  try {
    realRoot = realpathSync(lexicalRoot);
  } catch (cause) {
    throw new WakeflowFsSafetyError(`cannot resolve ${label} root ${lexicalRoot}: ${cause.message}`, {
      code: "root-realpath-failed",
      root: lexicalRoot,
      candidate: lexicalCandidate,
      cause,
    });
  }

  const relative = path.relative(lexicalRoot, lexicalCandidate);
  const segments = relative.split(path.sep);
  let current = lexicalRoot;
  let currentReal = realRoot;
  let nearestExistingAncestor = lexicalRoot;
  let targetStat = null;
  let missingSegments = [];

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (cause) {
      if (cause?.code === "ENOENT") {
        missingSegments = segments.slice(index);
        break;
      }
      throw new WakeflowFsSafetyError(`cannot inspect ${label} path ${current}: ${cause.message}`, {
        code: "path-inspection-failed",
        root: lexicalRoot,
        candidate: lexicalCandidate,
        inspectedPath: current,
        cause,
      });
    }

    const isTarget = index === segments.length - 1;
    if (stat.isSymbolicLink()) {
      throw new WakeflowFsSafetyError(`${label} path must not be a symbolic link: ${current}`, {
        code: isTarget ? "target-symlink" : "ancestor-symlink",
        root: lexicalRoot,
        candidate: lexicalCandidate,
        symlinkPath: current,
      });
    }
    if (!isTarget && !stat.isDirectory()) {
      throw new WakeflowFsSafetyError(`${label} ancestor must be a directory: ${current}`, {
        code: "ancestor-type",
        root: lexicalRoot,
        candidate: lexicalCandidate,
        inspectedPath: current,
        actualType: statType(stat),
      });
    }
    if (isTarget && !stat.isFile()) {
      throw new WakeflowFsSafetyError(`${label} target must be a regular file: ${current}`, {
        code: "target-type",
        root: lexicalRoot,
        candidate: lexicalCandidate,
        inspectedPath: current,
        actualType: statType(stat),
      });
    }

    try {
      currentReal = realpathSync(current);
    } catch (cause) {
      throw new WakeflowFsSafetyError(`cannot resolve ${label} path ${current}: ${cause.message}`, {
        code: "path-realpath-failed",
        root: lexicalRoot,
        candidate: lexicalCandidate,
        inspectedPath: current,
        cause,
      });
    }
    if (!pathIsInside(realRoot, currentReal)) {
      throw new WakeflowFsSafetyError(`${label} resolves outside ${realRoot}: ${current}`, {
        code: "realpath-containment",
        root: realRoot,
        candidate: lexicalCandidate,
        realPath: currentReal,
      });
    }

    if (isTarget) {
      targetStat = stat;
      nearestExistingAncestor = path.dirname(current);
    } else {
      nearestExistingAncestor = current;
    }
  }

  const projectedRealCandidate = missingSegments.length > 0
    ? path.resolve(currentReal, ...missingSegments)
    : currentReal;
  if (!pathIsInside(realRoot, projectedRealCandidate) || projectedRealCandidate === realRoot) {
    throw new WakeflowFsSafetyError(`${label} resolves outside ${realRoot}: ${lexicalCandidate}`, {
      code: "realpath-containment",
      root: realRoot,
      candidate: lexicalCandidate,
      realPath: projectedRealCandidate,
    });
  }

  return Object.freeze({
    lexicalRoot,
    lexicalCandidate,
    realRoot,
    projectedRealCandidate,
    nearestExistingAncestor,
    missingSegments: Object.freeze([...missingSegments]),
    parentExists: targetStat !== null || missingSegments.length === 1,
    targetType: targetStat ? "file" : "absent",
  });
}

// operation object本身也是输入边界；先读descriptor再复制，避免路径检查前执行getter。
function normalizeFutureFileInput(input) {
  const value = input === undefined ? {} : input;
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new WakeflowFsSafetyError("future file inspection requires one plain data object", {
      code: "invalid-input",
    });
  }
  const allowed = new Set(["candidate", "label", "root"]);
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new WakeflowFsSafetyError("future file inspection contains an unknown field", {
        code: "invalid-input",
        field: typeof key === "string" ? key : "<symbol>",
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new WakeflowFsSafetyError("future file inspection requires enumerable data properties", {
        code: "invalid-input",
        field: key,
      });
    }
    result[key] = descriptor.value;
  }
  const label = result.label === undefined ? "file" : result.label;
  if (typeof label !== "string" || !label.trim()) {
    throw new WakeflowFsSafetyError("future file inspection label must be a non-empty string", {
      code: "invalid-label",
    });
  }
  return Object.freeze({ root: result.root, candidate: result.candidate, label });
}

// ==================== 三、诊断节点类型 ====================

function statType(stat) {
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isSocket()) return "socket";
  if (stat.isFIFO()) return "fifo";
  if (stat.isCharacterDevice()) return "character-device";
  if (stat.isBlockDevice()) return "block-device";
  return "unknown";
}
