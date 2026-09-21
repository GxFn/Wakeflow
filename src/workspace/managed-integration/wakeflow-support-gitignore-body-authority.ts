import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import { parsePortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type { WakeflowWorkspaceHostId } from "../workspace-host-resource-profile.js";
import {
  parseWakeflowGitignoreHostProfileSet,
  renderWakeflowGitignoreRootRule,
  type WakeflowGitignoreRule,
} from "./wakeflow-gitignore-body-authority.js";
import type { WakeflowManagedTextEnvelopeTarget } from "./wakeflow-managed-text-envelope.js";

/**
 * Wakeflow Workspace / Managed Integration：wakeflow-managed 支撑面根里 `.gitignore`
 * 托管块的正文权威。
 *
 * 宿主在自己的 cwd 里生成的本机设置文件（Claude 的 `.claude/settings.local.json`）不该进入
 * 支撑面所在仓库的跟踪范围；工作区根 `.gitignore` 的规则是根锚定的，覆盖不到支撑面
 * 子目录，所以每个 Wakeflow 管理的支撑面根维护一份只含各宿主本机设置路径的托管块
 * （旧实现 `ignore:<surfaceId>` 组件的同一职责）。没有任何宿主声明本机设置路径时权威为
 * null，什么也不写。正文与工作区 `.gitignore` 共用同一根锚定字面规则词法。
 */

export const WAKEFLOW_SUPPORT_GITIGNORE_FILE_NAME = parsePortableResourcePath(
  ".gitignore",
  "$supportGitignore.fileName",
);
export const WAKEFLOW_SUPPORT_GITIGNORE_COMPONENT = "support-ignore" as const;
export const WAKEFLOW_SUPPORT_GITIGNORE_OWNER =
  "workspace-ignore-integration" as const;
export const WAKEFLOW_SUPPORT_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION = 1 as const;

export interface WakeflowSupportGitignoreBodyAuthority {
  readonly kind: "WakeflowSupportGitignoreBodyAuthority";
  readonly schemaVersion:
    typeof WAKEFLOW_SUPPORT_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION;
  readonly hostIds: readonly WakeflowWorkspaceHostId[];
  readonly rules: readonly WakeflowGitignoreRule[];
  readonly body: string;
  readonly bodyDigest: Sha256Digest;
  readonly authorityDigest: Sha256Digest;
  readonly envelopeTarget: Readonly<WakeflowManagedTextEnvelopeTarget>;
}

/**
 * 从完整宿主画像集合生成支撑面 `.gitignore` 托管块权威；没有宿主本机设置路径时返回 null。
 */
export function createWakeflowSupportGitignoreBodyAuthority(
  profileValues: unknown,
): Readonly<WakeflowSupportGitignoreBodyAuthority> | null {
  const profiles = parseWakeflowGitignoreHostProfileSet(profileValues);
  const rules = new Set<WakeflowGitignoreRule>();
  for (const profile of profiles) {
    const localPath = profile.surfaces.settingsIntegration?.localPath;
    if (localPath === undefined) continue;
    rules.add(renderWakeflowGitignoreRootRule(localPath, false));
  }
  if (rules.size === 0) return null;
  const sortedRules = Object.freeze(
    [...rules].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  );
  const hostIds = Object.freeze(profiles.map((profile) => profile.hostId));
  const body = `${sortedRules.join("\n")}\n`;
  const bodyDigest = computeSha256Digest(encodeUtf8(body), "$body");
  const authorityDigest = computeCanonicalJsonSha256Digest({
    kind: "WakeflowSupportGitignoreBodyAuthorityDigestBasis",
    schemaVersion: WAKEFLOW_SUPPORT_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION,
    hostIds,
    rules: sortedRules,
  });
  return Object.freeze({
    kind: "WakeflowSupportGitignoreBodyAuthority",
    schemaVersion: WAKEFLOW_SUPPORT_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION,
    hostIds,
    rules: sortedRules,
    body,
    bodyDigest,
    authorityDigest,
    envelopeTarget: Object.freeze({
      component: WAKEFLOW_SUPPORT_GITIGNORE_COMPONENT,
      owner: WAKEFLOW_SUPPORT_GITIGNORE_OWNER,
      body,
    }),
  });
}
