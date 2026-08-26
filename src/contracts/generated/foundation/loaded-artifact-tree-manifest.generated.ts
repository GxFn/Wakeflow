/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/foundation/loaded-artifact-tree-manifest.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string
/**
 * Wakeflow 持久协议使用的根内逻辑资源路径：以正斜杠分段、非空、相对且已经处于唯一结构形式。
 */
export type WakeflowPortableResourcePathText = string

/**
 * Wakeflow 已加载制品树的位置无关内容身份：按 portable ref 排序的 regular-file 摘要、字节数与 executable bit。
 */
export interface LoadedArtifactTreeManifest {
artifactKind: "wakeflow-loaded-artifact-tree"
fileCount: number
/**
 * @minItems 1
 * @maxItems 4096
 */
files: [LoadedArtifactTreeFile, ...(LoadedArtifactTreeFile)[]]
schemaVersion: 1
totalBytes: number
}
export interface LoadedArtifactTreeFile {
bytes: number
digest: WakeflowSha256DigestText
executable: boolean
ref: WakeflowPortableResourcePathText
}
