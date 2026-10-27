import { computeSha256Digest } from "../foundation/crypto/sha256.js";
import { decodeUtf8 } from "../foundation/text/utf8.js";
/**
 * Wakeflow Kernel / 制品身份的两条轴（§13.127；1.2 计划 §3.6 C6；open-items V6、W14）。
 *
 * 一份制品由根下 `artifact-manifest.json` 标识。摘要轴是 manifest 的字节摘要：同路径覆盖
 * （Claude Code 的就地更新）由它发现，但只能在同一宿主的进程里比——对端宿主的制品是另一份
 * 构建，摘要天然不同（R-ROOT-04）。版本轴是 manifest 的 `version`（`assets/release/version.json`
 * 的发布版本，两宿主制品同值）：按版本目录并存的安装（Codex 缓存）只有它能发现，而且可以跨宿主比。
 * 版本只按主、次、补丁的数值序排序；预发布或构建后缀被接受但不参与排序，同主次补丁的两份制品
 * 再比摘要。读不出或形状不对一律 null——"不知道"从不冒充"一致"。
 */
export const WAKEFLOW_ARTIFACT_MANIFEST_FILE_NAME = "artifact-manifest.json";
/** `主.次.补丁`，各段至多十位、不带前导零；可选的 `-预发布` 或 `+构建` 后缀至多 48 个字符。 */
const ARTIFACT_VERSION_PATTERN = /^(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})(?:[-+][0-9A-Za-z][0-9A-Za-z.+-]{0,47})?$/u;
export function isWakeflowArtifactVersion(value) {
    return typeof value === "string" && ARTIFACT_VERSION_PATTERN.test(value);
}
function versionNumbers(version) {
    const match = ARTIFACT_VERSION_PATTERN.exec(version);
    if (match === null)
        throw new TypeError("artifact-version");
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}
/**
 * 主、次、补丁的数值序：左小于右为 -1，相等为 0，左大于右为 1。后缀不参与。
 * 两个参数都必须是 `isWakeflowArtifactVersion` 接受的文本；调用方在边界先判定。
 */
export function compareWakeflowArtifactVersions(left, right) {
    const a = versionNumbers(left);
    const b = versionNumbers(right);
    for (let index = 0; index < 3; index += 1) {
        const l = a[index];
        const r = b[index];
        if (l < r)
            return -1;
        if (l > r)
            return 1;
    }
    return 0;
}
/** 一组可能缺席的版本里最高的一个（按数值序，首个达到最高者胜出）；没有可比的版本为 null。 */
export function newestWakeflowArtifactVersion(versions) {
    let newest = null;
    for (const version of versions) {
        if (version === null || !isWakeflowArtifactVersion(version))
            continue;
        if (newest === null || compareWakeflowArtifactVersions(version, newest) > 0)
            newest = version;
    }
    return newest;
}
/**
 * 从 manifest 字节解析身份：摘要总是有的；`version` 要是合法版本文本，否则为 null。
 * manifest 不是 JSON 对象时只剩摘要——旧制品或被改坏的 manifest 不让读它的进程失败。
 */
export function parseWakeflowArtifactManifestIdentity(bytes) {
    const manifestDigest = computeSha256Digest(bytes, "$artifactManifest");
    let version = null;
    try {
        const parsed = JSON.parse(decodeUtf8(bytes, "$artifactManifest"));
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            const candidate = parsed.version;
            if (isWakeflowArtifactVersion(candidate))
                version = candidate;
        }
    }
    catch {
        version = null;
    }
    return Object.freeze({ version, manifestDigest });
}
