import {
  PORTABLE_RESOURCE_PATH_PATTERN_SOURCE,
  type WakeflowPortableResourcePathText,
} from "../../contracts/generated/foundation/portable-resource-path.generated.js";

/**
 * Wakeflow Foundation / Filesystem：根内 portable resource path 词法。
 *
 * 本文件消费 JSON Schema 派生的结构 pattern，并复验 well-formed Unicode、NFC
 * 与非空规范分段。路径只是一段可持久化的逻辑引用；它不解析物理根、不访问
 * filesystem，也不判断 symlink、存在性、权限、case collision 或领域容量。
 *
 * URL、文档 anchor、允许 `../` 的配置 placement 和本机绝对路径具有不同语义，
 * 不会为了共享 string 外形被本 parser 接受或规范化。
 */

const PORTABLE_RESOURCE_PATH_PATTERN = new RegExp(
  PORTABLE_RESOURCE_PATH_PATTERN_SOURCE,
  "u",
);

declare const PORTABLE_RESOURCE_PATH_BRAND: unique symbol;

/** 已严格解析的根内 portable resource path。 */
export type PortableResourcePath = WakeflowPortableResourcePathText & {
  readonly [PORTABLE_RESOURCE_PATH_BRAND]: "PortableResourcePath";
};

/** 至少包含一个成员的冻结 resource path 分段。 */
export type PortableResourcePathSegments = readonly [string, ...string[]];

/** portable resource path 失败的稳定分类。 */
export type PortableResourcePathErrorReason =
  | "format"
  | "unicode-well-formed"
  | "unicode-normalization"
  | "segment";

interface ParsedPortableResourcePath {
  readonly value: PortableResourcePath;
  readonly segments: PortableResourcePathSegments;
}

const ERROR_MESSAGES = {
  "format": "Portable resource path must use one canonical root-relative slash-separated form.",
  "unicode-well-formed": "Portable resource path must contain well-formed Unicode text.",
  "unicode-normalization": "Portable resource path must already use Unicode NFC.",
  "segment": "Portable resource path contains a non-canonical segment.",
} as const satisfies Readonly<Record<PortableResourcePathErrorReason, string>>;

/**
 * portable resource path 词法失败的稳定错误。
 *
 * 错误只暴露能力代码、分类和调用方路径，不回显候选路径、分段或 Unicode 文本。
 */
export class PortableResourcePathError extends Error {
  override readonly name = "PortableResourcePathError";
  readonly code = "wakeflow-portable-resource-path" as const;
  readonly reason: PortableResourcePathErrorReason;
  readonly path: string;

  constructor(reason: PortableResourcePathErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function normalizeErrorPath(path: unknown): string {
  return typeof path === "string" && path.length > 0 ? path : "$";
}

function fail(
  reason: PortableResourcePathErrorReason,
  path: string,
): never {
  throw new PortableResourcePathError(reason, path);
}

function parseSegments(
  value: string,
  path: string,
): PortableResourcePathSegments {
  const segments = value.split("/");
  if (
    segments.length === 0
    || segments.some((segment) => (
      segment.length === 0
      || segment === "."
      || segment === ".."
      || segment !== segment.trim()
    ))
  ) {
    fail("segment", path);
  }
  return Object.freeze(segments) as PortableResourcePathSegments;
}

function parsePath(
  value: unknown,
  path: string,
): ParsedPortableResourcePath {
  if (typeof value !== "string") fail("format", path);
  if (!value.isWellFormed()) fail("unicode-well-formed", path);
  if (value.normalize("NFC") !== value) {
    fail("unicode-normalization", path);
  }
  if (!PORTABLE_RESOURCE_PATH_PATTERN.test(value)) fail("format", path);
  return {
    value: value as PortableResourcePath,
    segments: parseSegments(value, path),
  };
}

/**
 * 严格解析 portable resource path，不执行 trim、slash 转换或 Unicode normalization。
 */
export function parsePortableResourcePath(
  value: unknown,
  errorPath?: string,
): PortableResourcePath {
  return parsePath(value, normalizeErrorPath(errorPath)).value;
}

/**
 * 重新验证品牌输入并返回新的冻结分段数组。
 *
 * 分段保持原始大小写和文本，不执行 basename、parent、URL decode 或 OS 本地化。
 */
export function splitPortableResourcePath(
  value: PortableResourcePath,
  errorPath?: string,
): PortableResourcePathSegments {
  const path = normalizeErrorPath(errorPath);
  return parsePath(value, path).segments;
}
