/**
 * Wakeflow Tooling / Schema Codegen：新 TypeScript 项目的合同生成器。
 *
 * 本模块只读取 `src/contracts/schemas` 中的 JSON Schema 2020-12 权威定义，建立
 * 不访问网络的 `$id`/`$ref` 目录，并在 `src/contracts/generated` 中生成可提交类型和
 * 少量明确登记的运行时词汇。普通 Schema 的类型转换委托给成熟依赖；Wakeflow 只
 * 负责本地引用解析、输入输出边界、确定性摘要和已提交生成结果的漂移检查。
 *
 * `build` 可以更新唯一的提交型生成目录；`check` 只能写入 `.build`，会独立生成两次
 * 并与已提交结果逐字节比较。它不读取旧 `core/schemas`、不生成领域状态、不决定
 * 校验器的业务错误映射，也不写入插件制品。
 */

import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  opendirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import {
  parseTree,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";
import { compile } from "json-schema-to-typescript";

/** 唯一手写 Schema 权威目录和唯一提交型生成目录。 */
const SCHEMA_ROOT = "src/contracts/schemas";
const GENERATED_ROOT = "src/contracts/generated";

/** `check` 的默认临时输出；任何检查都不得把提交型目录当作临时工作区。 */
const DEFAULT_CHECK_ROOT = ".build/schema-types";

/** Schema 目录和单文件容量是构建资源边界，不代表领域集合容量。 */
const MAX_SCHEMA_FILES = 256;
const MAX_SCHEMA_BYTES = 2 * 1024 * 1024;
const MAX_GENERATED_BYTES = 4 * 1024 * 1024;

const STRICT_JSON_PARSE_OPTIONS = Object.freeze({
  allowTrailingComma: false,
  disallowComments: true,
});

/** 需要同时生成类型和运行时常量的封闭 Schema 白名单。 */
const DURABLE_ID_KIND_SCHEMA_ID =
  "urn:wakeflow:identity:durable-id-kind:v1";
const DURABLE_ID_KIND_SCHEMA_TITLE = "WakeflowDurableIdKind";
const DURABLE_ID_KINDS_EXPORT = "WAKEFLOW_DURABLE_ID_KINDS";

const UTC_INSTANT_SCHEMA_ID =
  "urn:wakeflow:foundation:time:utc-instant:v1";
const UTC_INSTANT_SCHEMA_TITLE = "WakeflowUtcInstantText";
const UTC_INSTANT_PATTERN_EXPORT = "UTC_INSTANT_PATTERN_SOURCE";

const PORTABLE_RESOURCE_PATH_SCHEMA_ID =
  "urn:wakeflow:foundation:filesystem:portable-resource-path:v1";
const PORTABLE_RESOURCE_PATH_SCHEMA_TITLE =
  "WakeflowPortableResourcePathText";
const PORTABLE_RESOURCE_PATH_PATTERN_EXPORT =
  "PORTABLE_RESOURCE_PATH_PATTERN_SOURCE";

const SHA256_DIGEST_SCHEMA_ID =
  "urn:wakeflow:foundation:crypto:sha256-digest:v1";
const SHA256_DIGEST_SCHEMA_TITLE = "WakeflowSha256DigestText";
const SHA256_DIGEST_PATTERN_EXPORT = "SHA256_DIGEST_PATTERN_SOURCE";

const TODO_ITEM_ID_SCHEMA_ID =
  "urn:wakeflow:governance:todo:item-id:v1";
const TODO_ITEM_ID_SCHEMA_TITLE = "WakeflowTodoItemIdText";
const TODO_ITEM_ID_PATTERN_EXPORT = "TODO_ITEM_ID_PATTERN_SOURCE";

const RUNTIME_SCHEMA_EXPORT_KEY = "x-wakeflow-runtime-export";
const RUNTIME_SCHEMA_EXPORT_PATTERN = /^[A-Z][A-Z0-9_]*_SCHEMA$/u;

/** `JSON.parse` 后仅供 Schema 目录和第三方生成器使用的普通对象。 */
type JsonObject = Record<string, unknown>;

/** Schema 目录中单份 Schema 的稳定仓库相对事实。 */
export interface SchemaCatalogRecord {
  readonly relativePath: string;
  readonly id: string;
  readonly externalRefs: readonly string[];
  readonly schema: JsonObject;
}

/** `build` 和 `check` 向调用方公开的最小确定性证据。 */
export interface SchemaTypeBuildResult {
  readonly mode: "build" | "check";
  readonly schemaCount: number;
  readonly externalRefEdges: number;
  readonly digest: string;
  readonly outputRoot: string;
}

/** 已完成允许范围检查的物理输出位置。 */
interface PreparedOutput {
  readonly resolved: string;
  readonly relative: string;
}

/** 一个清单闭合生成目录的文件摘要。 */
interface GeneratedOutputSnapshot {
  readonly paths: readonly string[];
  readonly digest: string;
}

/** Schema 目录构建、生成或漂移检查失败时返回的稳定工具错误。 */
export class SchemaCodegenError extends Error {
  override readonly name = "SchemaCodegenError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new SchemaCodegenError(code, message);
}

function isPlainObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** 生成清单统一使用与 locale 无关的 UTF-16 code-unit 顺序。 */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 严格 JSON source 中任何层级的重复对象键都会使合同产生歧义。 */
function duplicateObjectKeyExists(node: JsonNode): boolean {
  if (node.type === "object") {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0];
      const valueNode = property.children?.[1];
      if (
        keyNode?.type !== "string"
        || typeof keyNode.value !== "string"
        || valueNode === undefined
      ) {
        return true;
      }
      if (seen.has(keyNode.value)) return true;
      seen.add(keyNode.value);
      if (duplicateObjectKeyExists(valueNode)) return true;
    }
    return false;
  }
  if (node.type === "array") {
    return (node.children ?? []).some(duplicateObjectKeyExists);
  }
  return false;
}

/** 只把目标不存在映射为 `null`；权限、类型和其他文件系统错误仍然失败。 */
function lstatOrNull(file: string): Stats | null {
  try {
    return lstatSync(file);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** Schema 和输出的目录边界拒绝符号链接及非目录节点。 */
function assertRealDirectory(directory: string, label: string): void {
  const stat = lstatOrNull(directory);
  if (stat === null || stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-schema-directory", `${label} must be one real directory`);
  }
}

function repositoryRelative(repoRoot: string, absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join("/") || ".";
}

/** 所有写入目录都逐层创建并复验，避免递归 `mkdir` 跟随已有符号链接。 */
function ensureRealDirectoryPath(root: string, directory: string): void {
  const relative = path.relative(root, directory);
  if (relative === "") return;
  if (
    relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    fail("wakeflow-schema-directory-scope", "directory must stay below repository root");
  }

  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = lstatOrNull(current);
    if (stat === null) {
      mkdirSync(current, { mode: 0o755 });
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(
        "wakeflow-schema-directory",
        `${repositoryRelative(root, current)} must be one real directory`,
      );
    }
  }
}

/**
 * 对 Schema 权威目录树执行有界、确定性排序和清单闭合枚举。
 * 普通文件只有使用 `.schema.json` 后缀才能进入目录；遇到未知残留时直接失败。
 */
function collectSchemaFiles(schemaRoot: string): readonly string[] {
  assertRealDirectory(schemaRoot, SCHEMA_ROOT);
  const files: string[] = [];
  let entries = 0;

  function visit(directory: string): void {
    const handle = opendirSync(directory);
    const children: Dirent[] = [];
    try {
      while (true) {
        const child = handle.readSync();
        if (child === null) break;
        children.push(child);
        entries += 1;
        if (entries > MAX_SCHEMA_FILES * 4) {
          fail("wakeflow-schema-tree-size", `${SCHEMA_ROOT} contains too many entries`);
        }
      }
    } finally {
      handle.closeSync();
    }

    children.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      if (child.isSymbolicLink()) {
        fail("wakeflow-schema-link", `${child.name} cannot be a symbolic link`);
      }
      if (child.isDirectory()) {
        visit(absolute);
      } else if (child.isFile() && child.name.endsWith(".schema.json")) {
        files.push(absolute);
        if (files.length > MAX_SCHEMA_FILES) {
          fail(
            "wakeflow-schema-count",
            `schema catalog exceeds ${MAX_SCHEMA_FILES} files`,
          );
        }
      } else {
        fail(
          "wakeflow-schema-type",
          `${child.name} is not an admitted .schema.json file or directory`,
        );
      }
    }
  }

  visit(schemaRoot);
  if (files.length === 0) {
    fail("wakeflow-schema-count", `${SCHEMA_ROOT} must contain at least one schema`);
  }
  return Object.freeze(files.sort(compareCodeUnits));
}

/** 递归收集外部 `$ref` 文档 ID；片段内引用仍由所属 Schema 自行解析。 */
function collectRefs(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectRefs(entry, refs);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" && typeof entry === "string" && !entry.startsWith("#")) {
      refs.add(entry);
    }
    collectRefs(entry, refs);
  }
}

/** 从带片段的引用中取得 Schema 目录使用的文档身份。 */
function referenceDocumentId(reference: string): string {
  const hash = reference.indexOf("#");
  return hash === -1 ? reference : reference.slice(0, hash);
}

/**
 * Ajv 负责 JSON Schema 2020-12 和严格编译语义；本层只提供稳定的工具错误映射，
 * 不把 Ajv 内部异常结构发布为 Wakeflow 合同。
 */
function validateSchemaCatalog(records: readonly SchemaCatalogRecord[]): void {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateSchema: true,
  });
  ajv.addFormat("regex", {
    type: "string",
    validate(value: string): boolean {
      try {
        new RegExp(value, "u");
        return true;
      } catch {
        return false;
      }
    },
  });
  ajv.addKeyword({
    keyword: RUNTIME_SCHEMA_EXPORT_KEY,
    schemaType: "string",
    valid: true,
    errors: false,
  });
  try {
    for (const record of records) ajv.addSchema(record.schema, record.id);
    for (const record of records) {
      if (ajv.getSchema(record.id) === undefined) {
        fail(
          "wakeflow-schema-validation",
          `${SCHEMA_ROOT}/${record.relativePath} did not compile`,
        );
      }
    }
  } catch (error: unknown) {
    if (error instanceof SchemaCodegenError) throw error;
    fail(
      "wakeflow-schema-validation",
      "Schema catalog is not valid strict JSON Schema 2020-12",
    );
  }
}

/** 建立不访问网络、`$id` 唯一且全部 `$ref` 可在新合同树内解析的 Schema 目录。 */
export function loadSchemaCatalog(
  repoRootInput: string,
): readonly SchemaCatalogRecord[] {
  const repoRoot = path.resolve(repoRootInput);
  const schemaRoot = path.join(repoRoot, SCHEMA_ROOT);
  const records: SchemaCatalogRecord[] = [];
  const ids = new Map<string, string>();

  for (const file of collectSchemaFiles(schemaRoot)) {
    const stat = lstatSync(file, { bigint: true });
    const relativePath = repositoryRelative(schemaRoot, file);
    if (
      !stat.isFile()
      || stat.nlink !== 1n
      || stat.size > BigInt(MAX_SCHEMA_BYTES)
    ) {
      fail(
        "wakeflow-schema-file",
        `${SCHEMA_ROOT}/${relativePath} must be one bounded single-link file`,
      );
    }

    const sourceText = readFileSync(file, "utf8");
    const parseErrors: ParseError[] = [];
    let syntaxTree: JsonNode | undefined;
    try {
      syntaxTree = parseTree(
        sourceText,
        parseErrors,
        STRICT_JSON_PARSE_OPTIONS,
      );
    } catch {
      fail(
        "wakeflow-schema-json",
        `${SCHEMA_ROOT}/${relativePath} is not valid JSON`,
      );
    }
    if (syntaxTree === undefined || parseErrors.length > 0) {
      fail(
        "wakeflow-schema-json",
        `${SCHEMA_ROOT}/${relativePath} is not valid strict JSON`,
      );
    }
    if (duplicateObjectKeyExists(syntaxTree)) {
      fail(
        "wakeflow-schema-json-duplicate-key",
        `${SCHEMA_ROOT}/${relativePath} contains a duplicate object key`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(sourceText);
    } catch {
      fail(
        "wakeflow-schema-json",
        `${SCHEMA_ROOT}/${relativePath} is not valid JSON`,
      );
    }
    if (
      !isPlainObject(parsed)
      || typeof parsed.$id !== "string"
      || parsed.$id.length === 0
    ) {
      fail(
        "wakeflow-schema-id",
        `${SCHEMA_ROOT}/${relativePath} requires a non-empty $id`,
      );
    }

    const previous = ids.get(parsed.$id);
    if (previous !== undefined) {
      fail(
        "wakeflow-schema-id-duplicate",
        `${parsed.$id} is declared by both ${previous} and ${relativePath}`,
      );
    }
    ids.set(parsed.$id, relativePath);

    const refs = new Set<string>();
    collectRefs(parsed, refs);
    records.push(Object.freeze({
      relativePath,
      id: parsed.$id,
      externalRefs: Object.freeze([...refs].sort(compareCodeUnits)),
      schema: structuredClone(parsed),
    }));
  }

  for (const record of records) {
    for (const reference of record.externalRefs) {
      const documentId = referenceDocumentId(reference);
      if (!ids.has(documentId)) {
        fail(
          "wakeflow-schema-ref",
          `${record.relativePath} references unknown external schema ${documentId}`,
        );
      }
    }
  }

  const catalog = Object.freeze(
    records.sort((left, right) => compareCodeUnits(
      left.relativePath,
      right.relativePath,
    )),
  );
  validateSchemaCatalog(catalog);
  return catalog;
}

function generatedRelativePath(schemaRelativePath: string): string {
  return schemaRelativePath.replace(/\.schema\.json$/u, ".generated.ts");
}

/**
 * 只允许唯一提交型目录或 `.build` 的严格子目录；先解析再比较，拒绝 `..` 路径别名。
 */
function prepareOutput(repoRoot: string, outputRoot: string): PreparedOutput {
  assertRealDirectory(repoRoot, "repository root");
  const resolved = path.resolve(repoRoot, outputRoot);
  const buildRoot = path.join(repoRoot, ".build");
  const generatedRoot = path.join(repoRoot, GENERATED_ROOT);
  const isGeneratedRoot = resolved === generatedRoot;
  const isBuildDescendant = resolved !== buildRoot
    && resolved.startsWith(`${buildRoot}${path.sep}`);

  if (!isGeneratedRoot && !isBuildDescendant) {
    fail(
      "wakeflow-schema-output-scope",
      `output root must be ${GENERATED_ROOT} or a strict descendant of .build/`,
    );
  }
  if (isGeneratedRoot) {
    assertRealDirectory(path.join(repoRoot, "src/contracts"), "src/contracts");
  } else {
    ensureRealDirectoryPath(repoRoot, buildRoot);
  }
  return Object.freeze({
    resolved,
    relative: repositoryRelative(repoRoot, resolved),
  });
}

/** 删除前确认目标仍为真实目录；调用方只能传入已准备输出目录或内部暂存目录。 */
function removeOutput(output: string): void {
  const stat = lstatOrNull(output);
  if (stat === null) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(
      "wakeflow-schema-output-type",
      "existing codegen output must be one real directory",
    );
  }
  rmSync(output, { recursive: true, force: false });
}

/**
 * 生成目录采用清单闭合输出：只允许有限、单链接、大小受限的 `.generated.ts` 文件。
 */
function collectGeneratedFiles(output: string): readonly string[] {
  assertRealDirectory(output, "generated Schema output");
  const paths: string[] = [];

  function visit(directory: string): void {
    const handle = opendirSync(directory);
    const children: Dirent[] = [];
    try {
      while (true) {
        const child = handle.readSync();
        if (child === null) break;
        children.push(child);
      }
    } finally {
      handle.closeSync();
    }

    children.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      if (child.isSymbolicLink()) {
        fail("wakeflow-schema-generated-link", "generated output cannot contain links");
      }
      if (child.isDirectory()) {
        visit(absolute);
      } else if (child.isFile() && child.name.endsWith(".generated.ts")) {
        const stat = lstatSync(absolute, { bigint: true });
        if (stat.nlink !== 1n || stat.size > BigInt(MAX_GENERATED_BYTES)) {
          fail(
            "wakeflow-schema-generated-file",
            "generated output contains an invalid file",
          );
        }
        paths.push(repositoryRelative(output, absolute));
        if (paths.length > MAX_SCHEMA_FILES) {
          fail("wakeflow-schema-generated-count", "generated output is too large");
        }
      } else {
        fail(
          "wakeflow-schema-generated-extra",
          "generated output contains an undeclared file",
        );
      }
    }
  }

  visit(output);
  return Object.freeze(paths.sort(compareCodeUnits));
}

/** 文件路径、NUL 分隔符和精确字节共同进入摘要，消除拼接与清单歧义。 */
function outputDigest(output: string, relativePaths: readonly string[]): string {
  const hash = createHash("sha256");
  for (const relative of relativePaths) {
    const bytes = readFileSync(path.join(output, relative));
    hash.update(relative, "utf8");
    hash.update("\0", "utf8");
    hash.update(bytes);
    hash.update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

/** 从清单已经闭合的生成目录取得可与独立构建结果比较的快照。 */
function inspectGeneratedOutput(output: string): GeneratedOutputSnapshot {
  const paths = collectGeneratedFiles(output);
  return Object.freeze({
    paths,
    digest: outputDigest(output, paths),
  });
}

/**
 * 持久标识类别是首个显式运行时词汇；这里只投影标准字符串枚举，
 * 不从其他 Schema 的 pattern 反向猜测身份分类。
 */
function parseDurableIdKinds(record: SchemaCatalogRecord): readonly string[] {
  const values: unknown = record.schema.enum;
  if (
    record.schema.title !== DURABLE_ID_KIND_SCHEMA_TITLE
    || record.schema.type !== "string"
    || !Array.isArray(values)
    || values.length === 0
  ) {
    fail(
      "wakeflow-schema-runtime-vocabulary",
      `${record.relativePath} is not the expected durable ID kind enum`,
    );
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) {
      fail(
        "wakeflow-schema-runtime-vocabulary",
        `${record.relativePath} contains an invalid durable ID kind`,
      );
    }
    seen.add(value);
    result.push(value);
  }
  return Object.freeze(result);
}

/** 读取并验证可选的运行时 Schema 导出元数据。 */
function runtimeSchemaExportName(
  record: SchemaCatalogRecord,
): string | null {
  const value = record.schema[RUNTIME_SCHEMA_EXPORT_KEY];
  if (value === undefined) return null;
  if (
    typeof value !== "string"
    || !RUNTIME_SCHEMA_EXPORT_PATTERN.test(value)
  ) {
    fail(
      "wakeflow-schema-runtime-export",
      `${record.relativePath} contains an invalid ${RUNTIME_SCHEMA_EXPORT_KEY}`,
    );
  }
  return value;
}

/** 为已经登记运行时使用者的 Schema 生成递归冻结常量。 */
function runtimeSchemaModuleLines(
  record: SchemaCatalogRecord,
): readonly string[] {
  const exportName = runtimeSchemaExportName(record);
  if (exportName === null) return [];
  const runtimeSchemaJson = JSON.stringify(record.schema);
  if (runtimeSchemaJson === undefined) {
    fail(
      "wakeflow-schema-runtime-export",
      `${record.relativePath} could not be serialized as runtime JSON Schema`,
    );
  }
  const serializedSchema = JSON.stringify(runtimeSchemaJson);
  return [
    "",
    "/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */",
    "function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {",
    "  if (value !== null && typeof value === \"object\" && !Object.isFrozen(value)) {",
    "    for (const child of Object.values(value)) freezeGeneratedSchema(child);",
    "    Object.freeze(value);",
    "  }",
    "  return value;",
    "}",
    "",
    "/** 从 JSON 文本恢复 Schema，保留 `__proto__` 等普通 JSON 自有键。 */",
    "function restoreGeneratedSchema(",
    "  serialized: string,",
    "): Readonly<Record<string, unknown>> {",
    "  const value: unknown = JSON.parse(serialized);",
    "  if (value === null || Array.isArray(value) || typeof value !== \"object\") {",
    "    throw new TypeError(\"Generated Schema must be an object.\");",
    "  }",
    "  return freezeGeneratedSchema(value as Record<string, unknown>);",
    "}",
    "",
    "/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */",
    `export const ${exportName} = restoreGeneratedSchema(${serializedSchema});`,
    "",
  ];
}

/** 为持久标识类别同时生成冻结运行时元组和由该元组派生的联合类型。 */
function generateDurableIdKindVocabulary(
  record: SchemaCatalogRecord,
  bannerComment: string,
): string {
  const kinds = parseDurableIdKinds(record);
  const values = JSON.stringify(kinds, null, 2);
  return [
    bannerComment,
    "",
    "/** Wakeflow 持久类型化身份的 Schema 派生运行时词汇。 */",
    `export const ${DURABLE_ID_KINDS_EXPORT} = Object.freeze(${values} as const);`,
    "",
    "/** 从同一 Schema 枚举派生的持久标识类别联合类型。 */",
    "export type WakeflowDurableIdKind =",
    `  (typeof ${DURABLE_ID_KINDS_EXPORT})[number];`,
    "",
  ].join("\n");
}

/**
 * UTC 时刻的词法模式是可移植持久化表示权威；生成器只验证模式可编译并逐字投影，
 * 不在工具层解释日期、时区或纳秒语义。
 */
function parseUtcInstantPattern(record: SchemaCatalogRecord): string {
  const pattern: unknown = record.schema.pattern;
  if (
    record.schema.title !== UTC_INSTANT_SCHEMA_TITLE
    || record.schema.type !== "string"
    || typeof pattern !== "string"
    || pattern.length === 0
  ) {
    fail(
      "wakeflow-schema-runtime-pattern",
      `${record.relativePath} is not the expected UTC instant string Schema`,
    );
  }
  try {
    new RegExp(pattern, "u");
  } catch {
    fail(
      "wakeflow-schema-runtime-pattern",
      `${record.relativePath} contains an invalid UTC instant pattern`,
    );
  }
  return pattern;
}

/** 为 UTC 时刻生成运行时正则源和对应的持久化字符串类型。 */
function generateUtcInstantContract(
  record: SchemaCatalogRecord,
  bannerComment: string,
): string {
  const pattern = parseUtcInstantPattern(record);
  return [
    bannerComment,
    "",
    "/** Wakeflow strict UTC instant profile 的 Schema 派生正则源。 */",
    `export const ${UTC_INSTANT_PATTERN_EXPORT} = ${JSON.stringify(pattern)} as const;`,
    "",
    "/** Schema 层的 UTC 时刻文本；运行时解析后再授予品牌类型。 */",
    "export type WakeflowUtcInstantText = string;",
    ...runtimeSchemaModuleLines(record),
  ].join("\n");
}

/**
 * 可移植资源路径的词法模式是持久化结构权威；NFC、Unicode 结构完整性和品牌准入
 * 仍由运行时解析器负责，工具层不解释文件系统语义。
 */
function parsePortableResourcePathPattern(
  record: SchemaCatalogRecord,
): string {
  const pattern: unknown = record.schema.pattern;
  if (
    record.schema.title !== PORTABLE_RESOURCE_PATH_SCHEMA_TITLE
    || record.schema.type !== "string"
    || typeof pattern !== "string"
    || pattern.length === 0
  ) {
    fail(
      "wakeflow-schema-runtime-pattern",
      `${record.relativePath} is not the expected portable resource path string Schema`,
    );
  }
  try {
    new RegExp(pattern, "u");
  } catch {
    fail(
      "wakeflow-schema-runtime-pattern",
      `${record.relativePath} contains an invalid portable resource path pattern`,
    );
  }
  return pattern;
}

/** 为可移植资源路径生成运行时正则源和持久化字符串类型。 */
function generatePortableResourcePathContract(
  record: SchemaCatalogRecord,
  bannerComment: string,
): string {
  const pattern = parsePortableResourcePathPattern(record);
  return [
    bannerComment,
    "",
    "/** Wakeflow 可移植资源路径的 Schema 派生正则源。 */",
    `export const ${PORTABLE_RESOURCE_PATH_PATTERN_EXPORT} = ${JSON.stringify(pattern)} as const;`,
    "",
    "/** Schema 层的可移植资源路径文本；运行时解析后再授予品牌类型。 */",
    "export type WakeflowPortableResourcePathText = string;",
    ...runtimeSchemaModuleLines(record),
  ].join("\n");
}

/** SHA-256 摘要的前缀、长度和小写词法由 Schema 单向投影。 */
function generateSha256DigestContract(
  record: SchemaCatalogRecord,
  bannerComment: string,
): string {
  const pattern: unknown = record.schema.pattern;
  if (
    record.schema.title !== SHA256_DIGEST_SCHEMA_TITLE
    || record.schema.type !== "string"
    || typeof pattern !== "string"
    || pattern.length === 0
  ) {
    fail(
      "wakeflow-schema-runtime-pattern",
      `${record.relativePath} is not the expected SHA-256 digest Schema`,
    );
  }
  try {
    new RegExp(pattern, "u");
  } catch {
    fail(
      "wakeflow-schema-runtime-pattern",
      `${record.relativePath} contains an invalid SHA-256 digest pattern`,
    );
  }
  return [
    bannerComment,
    "",
    "/** Wakeflow SHA-256 摘要的 Schema 派生正则源。 */",
    `export const ${SHA256_DIGEST_PATTERN_EXPORT} = ${JSON.stringify(pattern)} as const;`,
    "",
    "/** Schema 层的完整 SHA-256 摘要文本；运行时解析后再授予品牌类型。 */",
    "export type WakeflowSha256DigestText = string;",
    ...runtimeSchemaModuleLines(record),
  ].join("\n");
}

/** TODO 不透明条目 ID 的唯一运行时词法投影。 */
function generateTodoItemIdContract(
  record: SchemaCatalogRecord,
  bannerComment: string,
): string {
  const pattern: unknown = record.schema.pattern;
  if (
    record.schema.title !== TODO_ITEM_ID_SCHEMA_TITLE
    || record.schema.type !== "string"
    || typeof pattern !== "string"
    || pattern.length === 0
  ) {
    fail(
      "wakeflow-schema-runtime-pattern",
      `${record.relativePath} is not the expected TODO item ID Schema`,
    );
  }
  try {
    new RegExp(pattern, "u");
  } catch {
    fail(
      "wakeflow-schema-runtime-pattern",
      `${record.relativePath} contains an invalid TODO item ID pattern`,
    );
  }
  return [
    bannerComment,
    "",
    "/** TODO item ID 的 Schema 派生正则源。 */",
    `export const ${TODO_ITEM_ID_PATTERN_EXPORT} = ${JSON.stringify(pattern)} as const;`,
    "",
    "/** Schema 层的 TODO item ID；运行时解析后再授予品牌类型。 */",
    "export type WakeflowTodoItemIdText = string;",
    ...runtimeSchemaModuleLines(record),
  ].join("\n");
}

/**
 * 已登记的运行时词汇和词法常量使用窄投影；其余结构类型完整委托给
 * `json-schema-to-typescript`，并通过本地 Schema 目录阻止网络引用。
 */
async function generateSchemaModule(
  record: SchemaCatalogRecord,
  schemaRoot: string,
  byId: ReadonlyMap<string, JsonObject>,
  bannerComment: string,
): Promise<string> {
  if (record.id === DURABLE_ID_KIND_SCHEMA_ID) {
    return generateDurableIdKindVocabulary(record, bannerComment);
  }
  if (record.id === UTC_INSTANT_SCHEMA_ID) {
    return generateUtcInstantContract(record, bannerComment);
  }
  if (record.id === PORTABLE_RESOURCE_PATH_SCHEMA_ID) {
    return generatePortableResourcePathContract(record, bannerComment);
  }
  if (record.id === SHA256_DIGEST_SCHEMA_ID) {
    return generateSha256DigestContract(record, bannerComment);
  }
  if (record.id === TODO_ITEM_ID_SCHEMA_ID) {
    return generateTodoItemIdContract(record, bannerComment);
  }

  const fallbackName = path.basename(
    record.relativePath,
    ".schema.json",
  );
  const generated = await compile(
    structuredClone(record.schema) as Parameters<typeof compile>[0],
    typeof record.schema.title === "string" && record.schema.title.length > 0
      ? record.schema.title
      : fallbackName,
    {
      cwd: schemaRoot,
      bannerComment,
      format: false,
      strictIndexSignatures: true,
      unknownAny: true,
      $refOptions: {
        resolve: {
          http: false,
          wakeflowCatalog: {
            order: 1,
            canRead: ({ url }: { readonly url: string }): boolean => (
              byId.has(url)
            ),
            read: ({ url }: { readonly url: string }): JsonObject => {
              const schema = byId.get(url);
              if (schema === undefined) {
                fail(
                  "wakeflow-schema-resolver",
                  `unknown Wakeflow schema reference ${url}`,
                );
              }
              return structuredClone(schema);
            },
          },
        },
      },
    },
  );
  const normalizedGenerated = generated
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
  const runtimeLines = runtimeSchemaModuleLines(record);
  if (runtimeLines.length > 0) {
    return `${[
      normalizedGenerated,
      ...runtimeLines,
    ].join("\n").trimEnd()}\n`;
  }
  return `${normalizedGenerated}\n`;
}

/**
 * 单次生成先完整写入同父目录暂存区；所有 Schema 都成功后才替换目标目录。
 * 生成失败时只清理本次随机暂存区，原提交型目录在替换点之前保持不变。
 */
async function generateOnce(
  repoRoot: string,
  outputRoot: string,
): Promise<SchemaTypeBuildResult> {
  const catalog = loadSchemaCatalog(repoRoot);
  const schemaRoot = path.join(repoRoot, SCHEMA_ROOT);
  const byId: ReadonlyMap<string, JsonObject> = new Map(
    catalog.map((record) => [record.id, record.schema]),
  );
  const prepared = prepareOutput(repoRoot, outputRoot);
  const parent = path.dirname(prepared.resolved);
  ensureRealDirectoryPath(repoRoot, parent);
  const stage = path.join(
    parent,
    `.${path.basename(prepared.resolved)}.stage-${process.pid}-${randomUUID()}`,
  );
  removeOutput(stage);
  mkdirSync(stage, { mode: 0o755 });

  const generatedPaths: string[] = [];
  try {
    for (const record of catalog) {
      const outputPath = generatedRelativePath(record.relativePath);
      const bannerComment = [
        "/**",
        " * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。",
        ` * Source: ${SCHEMA_ROOT}/${record.relativePath}`,
        " */",
      ].join("\n");
      const generated = await generateSchemaModule(
        record,
        schemaRoot,
        byId,
        bannerComment,
      );
      const destination = path.join(stage, outputPath);
      mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
      writeFileSync(destination, generated, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o644,
      });
      generatedPaths.push(outputPath);
    }

    removeOutput(prepared.resolved);
    renameSync(stage, prepared.resolved);
  } catch (error: unknown) {
    const stageStat = lstatOrNull(stage);
    if (
      stageStat !== null
      && !stageStat.isSymbolicLink()
      && stageStat.isDirectory()
    ) {
      rmSync(stage, { recursive: true, force: false });
    }
    throw error;
  }

  return Object.freeze({
    mode: "build",
    schemaCount: catalog.length,
    externalRefEdges: catalog.reduce(
      (sum, record) => sum + record.externalRefs.length,
      0,
    ),
    digest: outputDigest(prepared.resolved, generatedPaths),
    outputRoot: prepared.relative,
  });
}

/** 从新合同 Schema 生成提交型 TypeScript 类型与运行时词汇。 */
export async function buildSchemaTypes(
  repoRootInput: string,
  outputRoot = GENERATED_ROOT,
): Promise<SchemaTypeBuildResult> {
  return generateOnce(path.resolve(repoRootInput), outputRoot);
}

/**
 * 在 `.build` 中独立生成两次，并与已提交的 `src/contracts/generated` 逐字节比较。
 * 本操作不会修改提交型生成目录。
 */
export async function checkSchemaTypes(
  repoRootInput: string,
  outputRoot = DEFAULT_CHECK_ROOT,
): Promise<SchemaTypeBuildResult> {
  const repoRoot = path.resolve(repoRootInput);
  const scratch = prepareOutput(repoRoot, outputRoot);
  if (scratch.resolved === path.join(repoRoot, GENERATED_ROOT)) {
    fail(
      "wakeflow-schema-output-scope",
      "Schema check scratch output must stay below .build/",
    );
  }
  removeOutput(scratch.resolved);
  ensureRealDirectoryPath(repoRoot, scratch.resolved);

  const first = await generateOnce(repoRoot, path.join(outputRoot, "first"));
  const second = await generateOnce(repoRoot, path.join(outputRoot, "second"));
  if (
    first.digest !== second.digest
    || first.schemaCount !== second.schemaCount
    || first.externalRefEdges !== second.externalRefEdges
  ) {
    fail(
      "wakeflow-schema-determinism",
      "two independent Schema type generations differ",
    );
  }

  const committed = prepareOutput(repoRoot, GENERATED_ROOT);
  if (lstatOrNull(committed.resolved) === null) {
    fail(
      "wakeflow-schema-generated-drift",
      `${GENERATED_ROOT} is missing; run the Schema build`,
    );
  }
  const committedSnapshot = inspectGeneratedOutput(committed.resolved);
  if (
    committedSnapshot.digest !== first.digest
    || committedSnapshot.paths.length !== first.schemaCount
  ) {
    fail(
      "wakeflow-schema-generated-drift",
      `${GENERATED_ROOT} does not match ${SCHEMA_ROOT}`,
    );
  }

  return Object.freeze({
    ...first,
    mode: "check",
    outputRoot: committed.relative,
  });
}

interface CliOptions {
  readonly mode: "build" | "check";
  readonly repoRoot: string;
  readonly outputRoot: string;
}

/** CLI 只接受 `build`、`check`、仓库根目录和可选输出根目录，不根据当前目录隐式选择项目。 */
function parseCli(args: readonly string[]): CliOptions {
  const mode = args[0];
  if (mode !== "build" && mode !== "check") {
    fail("wakeflow-schema-argv", "first argument must be build or check");
  }
  let repoRoot: string | null = null;
  let outputRoot: string | null = null;

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    const name = argument?.startsWith("--repo-root=")
      ? "--repo-root"
      : argument?.startsWith("--output-root=")
        ? "--output-root"
        : argument;
    if (name !== "--repo-root" && name !== "--output-root") {
      fail(
        "wakeflow-schema-argv",
        `unknown argument: ${argument ?? "<missing>"}`,
      );
    }
    const value = argument === name
      ? args[index += 1]
      : argument?.slice(name.length + 1);
    if (
      value === undefined
      || value.length === 0
      || value.startsWith("--")
    ) {
      fail("wakeflow-schema-argv", `${name} requires one path`);
    }
    if (name === "--repo-root") {
      if (repoRoot !== null) {
        fail("wakeflow-schema-argv", "--repo-root may be provided only once");
      }
      repoRoot = value;
    } else {
      if (outputRoot !== null) {
        fail("wakeflow-schema-argv", "--output-root may be provided only once");
      }
      outputRoot = value;
    }
  }

  if (repoRoot === null) {
    fail("wakeflow-schema-argv", "--repo-root is required");
  }
  return Object.freeze({
    mode,
    repoRoot,
    outputRoot: outputRoot
      ?? (mode === "build" ? GENERATED_ROOT : DEFAULT_CHECK_ROOT),
  });
}

/** CLI 始终输出结构化结果，并把未分类异常映射为工具错误码。 */
async function main(): Promise<void> {
  try {
    const cli = parseCli(process.argv.slice(2));
    const result = cli.mode === "build"
      ? await buildSchemaTypes(cli.repoRoot, cli.outputRoot)
      : await checkSchemaTypes(cli.repoRoot, cli.outputRoot);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error: unknown) {
    const code = error instanceof SchemaCodegenError
      ? error.code
      : "wakeflow-schema-unexpected";
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ ok: false, error: { code, message } }, null, 2));
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] === undefined
  ? null
  : path.resolve(process.argv[1]);
// 被导入时只提供纯 API；只有直接执行本编译入口时才运行 CLI。
if (invoked !== null && invoked === fileURLToPath(import.meta.url)) {
  await main();
}
