import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import {
  DemandEventStreamCommitError,
  type DemandEventStreamCommitWriter,
  parseDemandEventStreamCommitWriter,
} from "../governance/demand/event-sourcing/demand-event-stream-commit.js";
import { fail } from "../kernel/error.js";
import {
  parseWakeflowArtifactManifestIdentity,
  WAKEFLOW_ARTIFACT_MANIFEST_FILE_NAME,
  type WakeflowArtifactManifestIdentity,
} from "../kernel/wakeflow-artifact-identity.js";

/**
 * Wakeflow Entrypoint / 制品身份（§13.127；版本轴见 1.2 计划 §3.6 C6）。
 *
 * 一个运行中的进程（MCP 服务、hook 观察脚本）是从哪份制品启动的：制品根是
 * `lib/entrypoints/<入口>.js` 的上两级，身份是根下 `artifact-manifest.json` 的字节摘要加它的
 * `version`（两条轴的语义在 kernel 的 `wakeflow-artifact-identity.ts`）。测试构建（`.build/`）
 * 没有 manifest，摘要与版本都读成 null——"不知道"从不冒充"一致"。
 */

/** 入口文件的上两级；解析不出为 null。 */
export function resolveWakeflowArtifactRoot(importMetaUrl: string): string | null {
  try {
    return realpathSync(path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..", ".."));
  } catch {
    return null;
  }
}

/** 制品根下 manifest 的身份（摘要与版本）；根为 null 或文件读不出为 null。 */
function readWakeflowArtifactManifestIdentity(
  root: string | null,
): Readonly<WakeflowArtifactManifestIdentity> | null {
  if (root === null) return null;
  try {
    const bytes = readFileSync(path.join(root, WAKEFLOW_ARTIFACT_MANIFEST_FILE_NAME));
    return parseWakeflowArtifactManifestIdentity(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

export interface WakeflowArtifactIdentity {
  readonly root: string | null;
  /** 进程启动时读到的 manifest `version`（发布版本）；manifest 缺席或没有合法版本为 null。 */
  readonly version: string | null;
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
  const identity = readWakeflowArtifactManifestIdentity(root);
  const manifestDigest = identity?.manifestDigest ?? null;
  const generated = root !== null && existsSync(path.join(root, "mcp/server.mjs"));
  return Object.freeze({
    root,
    version: identity?.version ?? null,
    manifestDigest,
    readCurrentManifestDigest: () =>
      readWakeflowArtifactManifestIdentity(root)?.manifestDigest ?? null,
    assertUnchanged: () => {
      if (!generated && manifestDigest === null) return;
      const current = readWakeflowArtifactManifestIdentity(root)?.manifestDigest ?? null;
      if (manifestDigest === null || current === null)
        fail("precondition-failed", "runtime-artifact-unavailable", "$runtime");
      if (current !== manifestDigest)
        fail("precondition-failed", "runtime-artifact-outdated", "$runtime");
    },
  });
}

/**
 * 本进程的写者戳（C11，计划 §3.6）：有版本的制品身份映射成 `{version, manifestDigest}`，由组合根交给每个
 * 公共 executor，随 Demand 提交与维护意图、日志持久化。没有 manifest 或没有版本的构建（测试构建）为 null；
 * 戳的准入不接受的版本文本也为 null——不盖戳，而不是让之后的每次提交失败。
 */
export function wakeflowArtifactWriterOf(
  identity: Readonly<Pick<WakeflowArtifactIdentity, "version" | "manifestDigest">>,
): Readonly<DemandEventStreamCommitWriter> | null {
  if (identity.version === null || identity.manifestDigest === null) return null;
  try {
    return parseDemandEventStreamCommitWriter({
      version: identity.version,
      manifestDigest: identity.manifestDigest,
    });
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamCommitError) return null;
    throw error;
  }
}
