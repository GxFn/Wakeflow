import {
  WAKEFLOW_ACTIVE_ROOT,
  WAKEFLOW_LOCAL_ROOT,
} from "../../configuration/wakeflow-config-v3.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../wakeflow-workspace-static-resource-matrix.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  WAKEFLOW_WORKSPACE_HOST_IDS,
  type WakeflowWorkspaceHostId,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import type {
  WakeflowManagedTextEnvelopeTarget,
} from "./wakeflow-managed-text-envelope.js";

/**
 * Wakeflow Workspace / Managed Integration：Workspace 根 `.gitignore` 的正文权威。
 *
 * 本模块从完整 Host Profile 集合生成一份 host-neutral 规则并集。规则只包含 Wakeflow
 * 私有根和各宿主声明的 local settings 路径；不读取 Git 配置、索引或工作树，也不把
 * 自己的词法判断描述成完整 Git wildmatch 结论。
 * Authority digest 只证明记录内部自洽，不是签名；执行 owner 必须从完整 Profiles
 * 重推导当前 authority，并与调用方预期比较后才能产生文件 effect。
 */

export const WAKEFLOW_GITIGNORE_BODY_AUTHORITY_KIND =
  "WakeflowGitignoreBodyAuthority" as const;
export const WAKEFLOW_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION = 1 as const;
export const WAKEFLOW_GITIGNORE_COMPONENT = "workspace-ignore" as const;
export const WAKEFLOW_GITIGNORE_OWNER =
  "workspace-ignore-integration" as const;

declare const WAKEFLOW_GITIGNORE_RULE_BRAND: unique symbol;

/** 已生成并验证为根锚定字面 Gitignore pattern 的规则。 */
export type WakeflowGitignoreRule = string & {
  readonly [WAKEFLOW_GITIGNORE_RULE_BRAND]: "WakeflowGitignoreRule";
};

export interface WakeflowGitignoreBodyAuthority {
  readonly kind: typeof WAKEFLOW_GITIGNORE_BODY_AUTHORITY_KIND;
  readonly schemaVersion:
    typeof WAKEFLOW_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION;
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

export type WakeflowGitignoreBodyAuthorityErrorReason =
  | "input"
  | "profile-set"
  | "path"
  | "authority"
  | "outside";

const ERROR_MESSAGES = {
  input: "Wakeflow Gitignore body authority input is invalid.",
  "profile-set":
    "Wakeflow Gitignore body authority requires one complete host profile set.",
  path:
    "Wakeflow Gitignore body authority cannot encode a private resource path.",
  authority: "Wakeflow Gitignore body authority record is invalid.",
  outside: "Wakeflow Gitignore outside text input is invalid.",
} as const satisfies Readonly<Record<
  WakeflowGitignoreBodyAuthorityErrorReason,
  string
>>;

/** Gitignore body authority 准入失败的稳定、脱敏错误。 */
export class WakeflowGitignoreBodyAuthorityError extends Error {
  override readonly name = "WakeflowGitignoreBodyAuthorityError";
  readonly code = "wakeflow-gitignore-body-authority" as const;
  readonly reason: WakeflowGitignoreBodyAuthorityErrorReason;
  readonly path: string;

  constructor(reason: WakeflowGitignoreBodyAuthorityErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const ACTIVE_ROOT_REF = parsePortableResourcePath(WAKEFLOW_ACTIVE_ROOT);
const LOCAL_ROOT_REF = parsePortableResourcePath(WAKEFLOW_LOCAL_ROOT);
const GITIGNORE_MAGIC_PATTERN = /[\\*?\[\]#!]/gu;
const GITIGNORE_MAGIC_CHARACTERS = new Set([
  "\\",
  "*",
  "?",
  "[",
  "]",
  "#",
  "!",
]);

function fail(
  reason: WakeflowGitignoreBodyAuthorityErrorReason,
  path: string,
): never {
  throw new WakeflowGitignoreBodyAuthorityError(reason, path);
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeLiteralPath(value: PortableResourcePath): string {
  return value.replace(GITIGNORE_MAGIC_PATTERN, (character) => (
    `\\${character}`
  ));
}

function rootRule(
  resourcePath: PortableResourcePath,
  directory: boolean,
): WakeflowGitignoreRule {
  const escaped = escapeLiteralPath(resourcePath);
  if (escaped.length === 0 || escaped.endsWith("\\")) fail("path", "$path");
  return `/${escaped}${directory ? "/" : ""}` as WakeflowGitignoreRule;
}

function isLiteralRootRule(value: string): boolean {
  if (!value.startsWith("/") || value === "/") return false;
  let encodedPath = value.slice(1);
  if (encodedPath.endsWith("/")) encodedPath = encodedPath.slice(0, -1);
  if (encodedPath.length === 0) return false;
  let resourcePath = "";
  for (let index = 0; index < encodedPath.length; index += 1) {
    const character = encodedPath[index];
    if (character === undefined) return false;
    if (character === "\\") {
      const escaped = encodedPath[index + 1];
      if (
        escaped === undefined
        || !GITIGNORE_MAGIC_CHARACTERS.has(escaped)
      ) {
        return false;
      }
      resourcePath += escaped;
      index += 1;
      continue;
    }
    if (GITIGNORE_MAGIC_CHARACTERS.has(character)) return false;
    resourcePath += character;
  }
  try {
    parsePortableResourcePath(resourcePath);
    return true;
  } catch {
    return false;
  }
}

function coveredByPrivateRoot(resourcePath: PortableResourcePath): boolean {
  return resourcePath === ACTIVE_ROOT_REF
    || resourcePath === LOCAL_ROOT_REF
    || resourcePath.startsWith(`${ACTIVE_ROOT_REF}/`)
    || resourcePath.startsWith(`${LOCAL_ROOT_REF}/`);
}

function parseProfiles(
  value: unknown,
): readonly Readonly<WakeflowWorkspaceHostResourceProfile>[] {
  let values: readonly unknown[];
  try {
    values = parseDenseArray(
      value,
      WAKEFLOW_WORKSPACE_HOST_IDS.length,
      "$profiles",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$profiles");
    throw error;
  }
  if (values.length !== WAKEFLOW_WORKSPACE_HOST_IDS.length) {
    fail("profile-set", "$profiles");
  }
  const byHostId = new Map<
    WakeflowWorkspaceHostId,
    Readonly<WakeflowWorkspaceHostResourceProfile>
  >();
  for (const [index, value] of values.entries()) {
    let profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
    try {
      profile = parseWakeflowWorkspaceHostResourceProfile(value);
    } catch (error: unknown) {
      if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
        fail("input", `$/profiles/${index}`);
      }
      throw error;
    }
    if (byHostId.has(profile.hostId)) fail("profile-set", "$profiles");
    byHostId.set(profile.hostId, profile);
  }
  if (WAKEFLOW_WORKSPACE_HOST_IDS.some((hostId) => !byHostId.has(hostId))) {
    fail("profile-set", "$profiles");
  }
  return Object.freeze(WAKEFLOW_WORKSPACE_HOST_IDS.map((hostId) => {
    const profile = byHostId.get(hostId);
    if (profile === undefined) fail("profile-set", "$profiles");
    return profile;
  }));
}

/** 从完整宿主画像集合生成唯一、确定性的 Gitignore 正文权威。 */
export function createWakeflowGitignoreBodyAuthority(
  profileValues: unknown,
): Readonly<WakeflowGitignoreBodyAuthority> {
  const profiles = parseProfiles(profileValues);
  const rules = new Set<WakeflowGitignoreRule>([
    rootRule(ACTIVE_ROOT_REF, true),
    rootRule(LOCAL_ROOT_REF, true),
  ]);
  for (const [index, profile] of profiles.entries()) {
    const localPath = profile.surfaces.settingsIntegration?.localPath;
    if (localPath === ACTIVE_ROOT_REF || localPath === LOCAL_ROOT_REF) {
      fail(
        "path",
        `$/profiles/${index}/surfaces/settingsIntegration/localPath`,
      );
    }
    const matrix = createWakeflowWorkspaceStaticResourceMatrix(profile);
    for (const declaration of matrix.declarations) {
      const relativePath = declaration.placement.relativePath;
      if (
        declaration.placement.root.kind !== "workspace"
        || declaration.tracking.disposition !== "ignored"
        || relativePath === null
        || coveredByPrivateRoot(relativePath)
      ) {
        continue;
      }
      rules.add(rootRule(
        relativePath,
        declaration.nodePolicy.kind !== "file",
      ));
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

function authorityRecord(
  value: unknown,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, "$authority");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("authority", "$authority");
    throw error;
  }
}

/** 重新验证正文、规则、宿主集合和两个摘要，返回解除别名的冻结 authority。 */
export function parseWakeflowGitignoreBodyAuthority(
  value: unknown,
): Readonly<WakeflowGitignoreBodyAuthority> {
  const record = authorityRecord(value);
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 8
    || keys[0] !== "authorityDigest"
    || keys[1] !== "body"
    || keys[2] !== "bodyDigest"
    || keys[3] !== "envelopeTarget"
    || keys[4] !== "hostIds"
    || keys[5] !== "kind"
    || keys[6] !== "rules"
    || keys[7] !== "schemaVersion"
    || record.kind !== WAKEFLOW_GITIGNORE_BODY_AUTHORITY_KIND
    || record.schemaVersion !== WAKEFLOW_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION
    || typeof record.body !== "string"
    || !record.body.isWellFormed()
  ) {
    fail("authority", "$authority");
  }
  let hostIdValues: readonly unknown[];
  let ruleValues: readonly unknown[];
  try {
    hostIdValues = parseDenseArray(
      record.hostIds,
      WAKEFLOW_WORKSPACE_HOST_IDS.length,
      "$authority.hostIds",
    );
    ruleValues = parseDenseArray(record.rules, 256, "$authority.rules");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("authority", "$authority");
    throw error;
  }
  if (
    hostIdValues.length !== WAKEFLOW_WORKSPACE_HOST_IDS.length
    || hostIdValues.some((hostId, index) => (
      hostId !== WAKEFLOW_WORKSPACE_HOST_IDS[index]
    ))
    || ruleValues.length === 0
    || ruleValues.some((rule) => (
      typeof rule !== "string"
      || !rule.isWellFormed()
      || rule.normalize("NFC") !== rule
      || !isLiteralRootRule(rule)
    ))
  ) {
    fail("authority", "$authority");
  }
  const rules = Object.freeze(
    ruleValues as readonly WakeflowGitignoreRule[],
  );
  if (
    new Set(rules).size !== rules.length
    || rules.some((rule, index) => (
      index > 0 && lexicalCompare(rules[index - 1] ?? "", rule) >= 0
    ))
    || record.body !== `${rules.join("\n")}\n`
  ) {
    fail("authority", "$authority");
  }
  let bodyDigest: Sha256Digest;
  let suppliedAuthorityDigest: Sha256Digest;
  try {
    bodyDigest = parseSha256Digest(record.bodyDigest, "$authority.bodyDigest");
    suppliedAuthorityDigest = parseSha256Digest(
      record.authorityDigest,
      "$authority.authorityDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("authority", error.path);
    throw error;
  }
  const hostIds = Object.freeze(
    hostIdValues as readonly WakeflowWorkspaceHostId[],
  );
  if (
    computeSha256Digest(encodeUtf8(record.body), "$authority.body")
      !== bodyDigest
    || computeCanonicalJsonSha256Digest({
      kind: "WakeflowGitignoreBodyAuthorityDigestBasis",
      schemaVersion: WAKEFLOW_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION,
      hostIds,
      rules,
    }) !== suppliedAuthorityDigest
  ) {
    fail("authority", "$authority");
  }
  let target: Readonly<Record<string, unknown>>;
  try {
    target = parsePlainRecord(record.envelopeTarget, "$authority.envelopeTarget");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("authority", "$authority");
    throw error;
  }
  if (
    Object.keys(target).sort().join("\u0000")
      !== "body\u0000component\u0000owner"
    || target.component !== WAKEFLOW_GITIGNORE_COMPONENT
    || target.owner !== WAKEFLOW_GITIGNORE_OWNER
    || target.body !== record.body
  ) {
    fail("authority", "$authority");
  }
  return Object.freeze({
    kind: WAKEFLOW_GITIGNORE_BODY_AUTHORITY_KIND,
    schemaVersion: WAKEFLOW_GITIGNORE_BODY_AUTHORITY_SCHEMA_VERSION,
    hostIds,
    rules,
    body: record.body,
    bodyDigest,
    authorityDigest: suppliedAuthorityDigest,
    envelopeTarget: Object.freeze({
      component: WAKEFLOW_GITIGNORE_COMPONENT,
      owner: WAKEFLOW_GITIGNORE_OWNER,
      body: record.body,
    }),
  });
}

function outsideSegments(
  value: unknown,
): Readonly<{ readonly prefix: string; readonly suffix: string }> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$outside");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("outside", "$outside");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2
    || keys[0] !== "prefix"
    || keys[1] !== "suffix"
    || typeof record.prefix !== "string"
    || typeof record.suffix !== "string"
    || !record.prefix.isWellFormed()
    || !record.suffix.isWellFormed()
  ) {
    fail("outside", "$outside");
  }
  return Object.freeze({ prefix: record.prefix, suffix: record.suffix });
}

function exactLines(text: string): ReadonlySet<string> {
  return new Set(text.split("\n").map((line) => (
    line.endsWith("\r") ? line.slice(0, -1) : line
  )));
}

/**
 * 只分类 outside 中与 authority 完全相同的正向或 `!` 规则行。
 * 通配、父目录、全局 excludes 与顺序后的真实匹配结论必须由 Git 自身验证。
 */
export function classifyWakeflowGitignoreExactOutsideRules(
  authorityValue: unknown,
  outsideValue: unknown,
): Readonly<WakeflowGitignoreExactOutsideClassification> {
  const authority = parseWakeflowGitignoreBodyAuthority(authorityValue);
  const outside = outsideSegments(outsideValue);
  const lines = new Set([
    ...exactLines(outside.prefix),
    ...exactLines(outside.suffix),
  ]);
  const exactDuplicateRules = Object.freeze(authority.rules.filter((rule) => (
    lines.has(rule)
  )));
  const exactNegatedRules = Object.freeze(authority.rules.filter((rule) => (
    lines.has(`!${rule}`)
  )));
  return Object.freeze({
    kind: exactNegatedRules.length === 0 ? "compatible" : "conflict",
    exactDuplicateRules,
    exactNegatedRules,
  });
}
