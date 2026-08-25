/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/foundation/portable-resource-path.schema.json
 */

/** Wakeflow portable resource path 的 Schema 派生正则源。 */
export const PORTABLE_RESOURCE_PATH_PATTERN_SOURCE = "^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\\.{1,2}(?:/|$))(?!.*\\/\\.{1,2}(?:/|$))(?!.*\\\\)(?!.*//)(?!.*\\/$)(?!\\s)(?!.*\\s$)(?!.*\\/\\s)(?!.*\\s\\/)(?!.*[\\u0000-\\u001F\\u007F-\\u009F]).+$" as const;

/** Schema 层的 portable resource path 文本；运行时解析后再授予品牌类型。 */
export type WakeflowPortableResourcePathText = string;
