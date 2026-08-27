/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/foundation/portable-resource-path.schema.json
 */

/** Wakeflow 可移植资源路径的 Schema 派生正则源。 */
export const PORTABLE_RESOURCE_PATH_PATTERN_SOURCE = "^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\.{1,2}(?:/|$))(?!.*\\/\\.{1,2}(?:/|$))(?!.*\\\\)(?!.*//)(?!.*\\/$)(?!\\s)(?!.*\\s$)(?!.*\\/\\s)(?!.*\\s\\/)(?!.*[\\u0000-\\u001F\\u007F-\\u009F]).+$" as const;

/** Schema 层的可移植资源路径文本；运行时解析后再授予品牌类型。 */
export type WakeflowPortableResourcePathText = string;

/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA = freezeGeneratedSchema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:foundation:filesystem:portable-resource-path:v1",
  "x-wakeflow-runtime-export": "WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA",
  "title": "WakeflowPortableResourcePathText",
  "description": "Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。",
  "$comment": "本 Schema 只拥有 portable wire 结构。well-formed Unicode、NFC 和品牌类型由 foundation/filesystem/portable-resource-path 复验；容量、OS 保留文件名、case collision、物理根、symlink、存在性、URL、文档 anchor 与允许父级的配置 placement 不属于本合同。",
  "type": "string",
  "minLength": 1,
  "pattern": "^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\.{1,2}(?:/|$))(?!.*\\/\\.{1,2}(?:/|$))(?!.*\\\\)(?!.*//)(?!.*\\/$)(?!\\s)(?!.*\\s$)(?!.*\\/\\s)(?!.*\\s\\/)(?!.*[\\u0000-\\u001F\\u007F-\\u009F]).+$",
  "examples": [
    ".wakeflow-active/current/demand.json",
    "requirement-designs/需求说明.md",
    "docs/My Plan.md"
  ]
} as const);
