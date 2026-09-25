import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeSha256Digest } from "../foundation/crypto/sha256.js";
/**
 * Wakeflow Entrypoint / 制品身份（§13.127）。
 *
 * 一个运行中的进程（MCP 服务、hook 观察脚本）是从哪份制品启动的：制品根是
 * `lib/entrypoints/<入口>.js` 的上两级，身份是根下 `artifact-manifest.json` 的字节摘要。
 * 测试构建（`.build/`）没有 manifest，两者都读成 null——"不知道"从不冒充"一致"。
 */
const WAKEFLOW_ARTIFACT_MANIFEST_FILE_NAME = "artifact-manifest.json";
/** 入口文件的上两级；解析不出为 null。 */
function resolveWakeflowArtifactRoot(importMetaUrl) {
    try {
        return realpathSync(path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..", ".."));
    }
    catch {
        return null;
    }
}
/** 制品根下 manifest 的字节摘要；根为 null 或文件读不出为 null。 */
function readWakeflowArtifactManifestDigest(root) {
    if (root === null)
        return null;
    try {
        const bytes = readFileSync(path.join(root, WAKEFLOW_ARTIFACT_MANIFEST_FILE_NAME));
        return computeSha256Digest(new Uint8Array(bytes), "$artifactManifest");
    }
    catch {
        return null;
    }
}
/** 进程启动时固定一次的制品身份。 */
export function resolveWakeflowArtifactIdentity(importMetaUrl) {
    const root = resolveWakeflowArtifactRoot(importMetaUrl);
    return Object.freeze({
        root,
        manifestDigest: readWakeflowArtifactManifestDigest(root),
        readCurrentManifestDigest: () => readWakeflowArtifactManifestDigest(root),
    });
}
