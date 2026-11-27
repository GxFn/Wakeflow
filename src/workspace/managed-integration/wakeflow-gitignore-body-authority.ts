import { WAKEFLOW_ACTIVE_ROOT, WAKEFLOW_LOCAL_ROOT } from "../../configuration/wakeflow-config.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, type Sha256Digest } from "../../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../wakeflow-workspace-static-resource-matrix.js";
import {
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostId,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import type { WakeflowManagedTextEnvelopeTarget } from "./wakeflow-managed-text-envelope.js";

/**
 * Wakeflow Workspace / Managed Integration：Workspace 根 `.gitignore` 的正文权威。
 *
 * 本模块从完整 Host Profile 集合生成一份 host-neutral 规则并集。规则只包含 Wakeflow
 * 私有根和各宿主声明的 local settings 路径；不读取 Git 配置、索引或工作树，也不把
 * 自己的词法判断描述成完整 Git wildmatch 结论。
 * Authority digest 只证明记录内部自洽，不是签名；执行 owner 必须从完整 Profiles
 * 重推导当前 authority，并与调用方预期比较后才能产生文件 effect。
 */

export const WAKEFLOW_GITIGNORE_BODY_AUTHORITY_KIND = "WakeflowGitignoreBodyAuthority" as const;
export const WAKEFLOW_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION = 1 as const;
const WAKEFLOW_GITIGNORE_COMPONENT = "workspace-ignore" as const;
const WAKEFLOW_GITIGNORE_OWNER = "workspace-ignore-integration" as const;

declare const WAKEFLOW_GITIGNORE_RULE_BRAND: unique symbol;

/** 已生成并验证为根锚定字面 Gitignore pattern 的规则。 */
export type WakeflowGitignoreRule = string & {
  readonly [WAKEFLOW_GITIGNORE_RULE_BRAND]: "WakeflowGitignoreRule";
};

export interface WakeflowGitignoreBodyAuthority {
  readonly kind: typeof WAKEFLOW_GITIGNORE_BODY_AUTHORITY_KIND;
  readonly schemaVersion: typeof WAKEFLOW_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION;
  readonly hostIds: readonly WakeflowWorkspaceHostId[];
  readonly rules: readonly WakeflowGitignoreRule[];
  readonly body: string;
  readonly bodyDigest: Sha256Digest;
  readonly authorityDigest: Sha256Digest;
  readonly envelopeTarget: Readonly<WakeflowManagedTextEnvelopeTarget>;
}

export interface WakeflowGitignoreExactOutsideClassification {
  readonly kind: "compatible" | "conflict";
  readonly exactDuplicateRules: readonly WakeflowGitignoreRule[];
  readonly exactNegatedRules: readonly WakeflowGitignoreRule[];
}

export type WakeflowGitignoreBodyAuthorityErrorReason = "profile-set" | "path";

/** Gitignore body authority 准入失败的稳定、脱敏错误。 */
export class WakeflowGitignoreBodyAuthorityError extends ModuleError<WakeflowGitignoreBodyAuthorityErrorReason> {
  static override readonly code = "wakeflow-gitignore-body-authority";
}

const fail: Fail<WakeflowGitignoreBodyAuthorityErrorReason> = failWith(
  WakeflowGitignoreBodyAuthorityError,
);

const ACTIVE_ROOT_REF = parsePortableResourcePath(WAKEFLOW_ACTIVE_ROOT);
const LOCAL_ROOT_REF = parsePortableResourcePath(WAKEFLOW_LOCAL_ROOT);
const GITIGNORE_MAGIC_PATTERN = /[\\*?[\]#!]/gu;

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeLiteralPath(value: PortableResourcePath): string {
  return value.replace(GITIGNORE_MAGIC_PATTERN, (character) => `\\${character}`);
}

function rootRule(resourcePath: PortableResourcePath, directory: boolean): WakeflowGitignoreRule {
  const escaped = escapeLiteralPath(resourcePath);
  if (escaped.length === 0 || escaped.endsWith("\\")) fail("path", "$path");
  return `/${escaped}${directory ? "/" : ""}` as WakeflowGitignoreRule;
}

/** 把一条根锚定的字面资源路径渲染为 Gitignore 规则；支撑面的 ignore 权威复用同一词法。 */
export function renderWakeflowGitignoreRootRule(
  resourcePath: PortableResourcePath,
  directory: boolean,
): WakeflowGitignoreRule {
  return rootRule(resourcePath, directory);
}

function coveredByPrivateRoot(resourcePath: PortableResourcePath): boolean {
  return (
    resourcePath === ACTIVE_ROOT_REF ||
    resourcePath === LOCAL_ROOT_REF ||
    resourcePath.startsWith(`${ACTIVE_ROOT_REF}/`) ||
    resourcePath.startsWith(`${LOCAL_ROOT_REF}/`)
  );
}

/**
 * 宿主画像集合的关系：每个宿主恰好一份，按宿主词汇排序。画像本身是类型化的（宿主常量，或维护意图
 * 读盘时已逐个解析）；集合规则类型表达不了，留着。
 */
function profileSet(
  values: readonly Readonly<WakeflowWorkspaceHostResourceProfile>[],
): readonly Readonly<WakeflowWorkspaceHostResourceProfile>[] {
  if (values.length !== WAKEFLOW_WORKSPACE_HOST_IDS.length) {
    fail("profile-set", "$profiles");
  }
  const byHostId = new Map<
    WakeflowWorkspaceHostId,
    Readonly<WakeflowWorkspaceHostResourceProfile>
  >();
  for (const profile of values) {
    if (byHostId.has(profile.hostId)) fail("profile-set", "$profiles");
    byHostId.set(profile.hostId, profile);
  }
  if (WAKEFLOW_WORKSPACE_HOST_IDS.some((hostId) => !byHostId.has(hostId))) {
    fail("profile-set", "$profiles");
  }
  return Object.freeze(
    WAKEFLOW_WORKSPACE_HOST_IDS.map((hostId) => {
      const profile = byHostId.get(hostId);
      if (profile === undefined) fail("profile-set", "$profiles");
      return profile;
    }),
  );
}

/** 从完整宿主画像集合生成唯一、确定性的 Gitignore 正文权威。 */
export function createWakeflowGitignoreBodyAuthority(
  profileValues: readonly Readonly<WakeflowWorkspaceHostResourceProfile>[],
): Readonly<WakeflowGitignoreBodyAuthority> {
  const profiles = profileSet(profileValues);
  const rules = new Set<WakeflowGitignoreRule>([
    rootRule(ACTIVE_ROOT_REF, true),
    rootRule(LOCAL_ROOT_REF, true),
  ]);
  for (const [index, profile] of profiles.entries()) {
    const localPath = profile.surfaces.settingsIntegration?.localPath;
    if (localPath === ACTIVE_ROOT_REF || localPath === LOCAL_ROOT_REF) {
      fail("path", `$/profiles/${index}/surfaces/settingsIntegration/localPath`);
    }
    const matrix = createWakeflowWorkspaceStaticResourceMatrix(profile);
    for (const declaration of matrix.declarations) {
      const relativePath = declaration.placement.relativePath;
      if (
        declaration.placement.root.kind !== "workspace" ||
        declaration.tracking.disposition !== "ignored" ||
        relativePath === null ||
        coveredByPrivateRoot(relativePath)
      ) {
        continue;
      }
      rules.add(rootRule(relativePath, declaration.nodePolicy.kind !== "file"));
    }
  }
  const sortedRules = Object.freeze([...rules].sort(lexicalCompare));
  const hostIds = Object.freeze(profiles.map((profile) => profile.hostId));
  const body = `${sortedRules.join("\n")}\n`;
  const bodyDigest = computeSha256Digest(encodeUtf8(body), "$body");
  const authorityDigest = computeCanonicalJsonSha256Digest({
    kind: "WakeflowGitignoreBodyAuthorityDigestBasis",
    schemaVersion: WAKEFLOW_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION,
    hostIds,
    rules: sortedRules,
  });
  return Object.freeze({
    kind: WAKEFLOW_GITIGNORE_BODY_AUTHORITY_KIND,
    schemaVersion: WAKEFLOW_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION,
    hostIds,
    rules: sortedRules,
    body,
    bodyDigest,
    authorityDigest,
    envelopeTarget: Object.freeze({
      component: WAKEFLOW_GITIGNORE_COMPONENT,
      owner: WAKEFLOW_GITIGNORE_OWNER,
      body,
    }),
  });
}

function exactLines(text: string): ReadonlySet<string> {
  return new Set(text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line)));
}

/**
 * 只分类 outside 中与 authority 完全相同的正向或 `!` 规则行。
 * 通配、父目录、全局 excludes 与顺序后的真实匹配结论必须由 Git 自身验证。
 */
export function classifyWakeflowGitignoreExactOutsideRules(
  authority: Readonly<WakeflowGitignoreBodyAuthority>,
  outside: Readonly<{ readonly prefix: string; readonly suffix: string }>,
): Readonly<WakeflowGitignoreExactOutsideClassification> {
  const lines = new Set([...exactLines(outside.prefix), ...exactLines(outside.suffix)]);
  const exactDuplicateRules = Object.freeze(authority.rules.filter((rule) => lines.has(rule)));
  const exactNegatedRules = Object.freeze(authority.rules.filter((rule) => lines.has(`!${rule}`)));
  return Object.freeze({
    kind: exactNegatedRules.length === 0 ? "compatible" : "conflict",
    exactDuplicateRules,
    exactNegatedRules,
  });
}
