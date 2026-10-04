import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeSha256Digest, type Sha256Digest } from "../foundation/crypto/sha256.js";
import { fail } from "../kernel/error.js";

/**
 * Wakeflow Entrypoint / 制品身份（§13.127）。
 *
 * 一个运行中的进程（MCP 服务、hook 观察脚本）是从哪份制品启动的：制品根是
 * `lib/entrypoints/<入口>.js` 的上两级，身份是根下 `artifact-manifest.json` 的字节摘要。
 * 测试构建（`.build/`）没有 manifest，两者都读成 null——"不知道"从不冒充"一致"。
 */

const WAKEFLOW_ARTIFACT_MANIFEST_FILE_NAME = "artifact-manifest.json" as const;

/** 入口文件的上两级；解析不出为 null。 */
export function resolveWakeflowArtifactRoot(importMetaUrl: string): string | null {
  try {
    return realpathSync(path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..", ".."));
  } catch {
    return null;
  }
}

/** 制品根下 manifest 的字节摘要；根为 null 或文件读不出为 null。 */
function readWakeflowArtifactManifestDigest(root: string | null): Sha256Digest | null {
  if (root === null) return null;
  try {
    const bytes = readFileSync(path.join(root, WAKEFLOW_ARTIFACT_MANIFEST_FILE_NAME));
    return computeSha256Digest(new Uint8Array(bytes), "$artifactManifest");
  } catch {
    return null;
  }
}

export interface WakeflowArtifactIdentity {
  readonly root: string | null;
  /** 进程启动时读到的 manifest 摘要；之后磁盘再变，这个值不变。 */
  readonly manifestDigest: Sha256Digest | null;
  /** 现在磁盘上同一处 manifest 的摘要：与 `manifestDigest` 不同即制品已在进程脚下更新。 */
  readonly readCurrentManifestDigest: () => Sha256Digest | null;
  /** Called by the actual generated MCP entrypoint before any mutation. */
  readonly assertUnchanged: () => void;
}

/** 进程启动时固定一次的制品身份。 */
export function resolveWakeflowArtifactIdentity(importMetaUrl: string): WakeflowArtifactIdentity {
  const root = resolveWakeflowArtifactRoot(importMetaUrl);
  const manifestDigest = readWakeflowArtifactManifestDigest(root);
  const generated = root !== null && existsSync(path.join(root, "mcp/server.mjs"));
  return Object.freeze({
    root,
    manifestDigest,
    readCurrentManifestDigest: () => readWakeflowArtifactManifestDigest(root),
    assertUnchanged: () => {
      if (!generated && manifestDigest === null) return;
      const current = readWakeflowArtifactManifestDigest(root);
      if (manifestDigest === null || current === null)
        fail("precondition-failed", "runtime-artifact-unavailable", "$runtime");
      if (current !== manifestDigest)
        fail("precondition-failed", "runtime-artifact-outdated", "$runtime");
    },
  });
}
