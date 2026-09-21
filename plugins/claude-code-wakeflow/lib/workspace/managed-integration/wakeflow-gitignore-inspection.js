import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { GitIgnoreCandidateObservationError, observeGitIgnoreCandidate, } from "../../foundation/git/git-ignore-candidate-observation.js";
import { GitIgnoreObservationError, observeGitIgnorePaths, } from "../../foundation/git/git-ignore-observation.js";
import { parseByteCount, } from "../../foundation/numeric/byte-count.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableFile, StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { decodeUtf8, Utf8Error, } from "../../foundation/text/utf8.js";
import { createWakeflowWorkspaceStaticResourceOperationContext, WakeflowWorkspaceStaticResourceOperationContextError, } from "../wakeflow-workspace-static-resource-operation-context.js";
import { classifyWakeflowGitignoreExactOutsideRules, createWakeflowGitignoreBodyAuthority, WakeflowGitignoreBodyAuthorityError, } from "./wakeflow-gitignore-body-authority.js";
import { WAKEFLOW_GITIGNORE_REF, } from "./wakeflow-managed-integration-resource-catalog.js";
import { inspectWakeflowManagedTextEnvelope, recomposeWakeflowManagedTextEnvelope, WakeflowManagedTextEnvelopeError, } from "./wakeflow-managed-text-envelope.js";
/**
 * Wakeflow Workspace / Managed Integration：Workspace 根 `.gitignore` 的只读检查。
 *
 * 本模块组合 digest-bound Operation Context、完整宿主正文权威、稳定文件读取、byte-exact
 * envelope 与 Git 自身的 ignore 判定。它只返回当前结论和候选目标，不创建、替换、删除
 * 或修复文件；全局 excludes 与 `.git/info/exclude` 不替代 tracked `.gitignore` 证据。
 */
export const WAKEFLOW_GITIGNORE_MAXIMUM_BYTES = parseByteCount(2 * 1024 * 1024, "$gitignore.maximumBytes");
const GIT_DIRECTORY_PROBE_NAME = ".wakeflow-ignore-probe";
const ERROR_MESSAGES = {
    input: "Wakeflow Gitignore inspection input is invalid.",
    context: "Wakeflow Gitignore operation context is invalid.",
    authority: "Wakeflow Gitignore body authority is invalid.",
    source: "Wakeflow Gitignore source cannot be read stably.",
    "source-policy": "Wakeflow Gitignore source violates its node policy.",
    envelope: "Wakeflow Gitignore managed envelope is invalid.",
    "outside-conflict": "Wakeflow Gitignore outside rules conflict with managed rules.",
    "unknown-managed-body": "Wakeflow Gitignore managed body is not an admitted render.",
    "target-capacity": "Wakeflow Gitignore candidate exceeds its byte budget.",
    "candidate-semantics": "Wakeflow Gitignore candidate does not provide its required Git semantics.",
    git: "Wakeflow Gitignore semantics could not be verified by Git.",
    aborted: "Wakeflow Gitignore inspection was aborted.",
};
/** Gitignore 只读检查失败的稳定、脱敏错误。 */
export class WakeflowGitignoreInspectionError extends Error {
    name = "WakeflowGitignoreInspectionError";
    code = "wakeflow-gitignore-inspection";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowGitignoreInspectionError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function parseRequest(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$request");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$request");
        throw error;
    }
    const keys = Object.keys(record).sort();
    if ((keys.length !== 3 && keys.length !== 4)
        || keys[0] !== "expectedMatrixDigest"
        || keys[1] !== "hostProfiles"
        || keys[2] !== "matrix"
        || (keys.length === 4 && keys[3] !== "signal")
        || (record.signal !== undefined
            && (types.isProxy(record.signal)
                || !(record.signal instanceof AbortSignal)))) {
        fail("input", "$request");
    }
    return Object.freeze({
        matrix: record.matrix,
        expectedMatrixDigest: record.expectedMatrixDigest,
        hostProfiles: record.hostProfiles,
        signal: record.signal,
    });
}
function currentUserId() {
    if (process.platform === "win32" || typeof process.geteuid !== "function") {
        fail("source-policy", "$source");
    }
    return BigInt(process.geteuid());
}
async function readSource(root, signal, expectedUserId) {
    try {
        const read = await readStableFile(root, WAKEFLOW_GITIGNORE_REF, {
            maximumBytes: WAKEFLOW_GITIGNORE_MAXIMUM_BYTES,
            ...(signal === undefined ? {} : { signal }),
        });
        if (read.node.kind !== "file"
            || read.node.permissionBits !== 0o644
            || read.node.linkCount !== 1n
            || read.node.userId !== expectedUserId) {
            fail("source-policy", "$source");
        }
        return Object.freeze({
            facts: Object.freeze({
                resourcePath: read.resourcePath,
                node: read.node,
                byteCount: read.byteCount,
                digest: read.digest,
            }),
            bytes: read.bytes,
        });
    }
    catch (error) {
        if (error instanceof WakeflowGitignoreInspectionError)
            throw error;
        if (error instanceof StableFileReadError) {
            if (error.reason === "not-found")
                return null;
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "symlink"
                || error.reason === "not-file") {
                fail("source-policy", "$source");
            }
            fail("source", "$source");
        }
        throw error;
    }
}
async function revalidateSource(root, initial, signal) {
    try {
        const current = await readStableFile(root, WAKEFLOW_GITIGNORE_REF, {
            maximumBytes: WAKEFLOW_GITIGNORE_MAXIMUM_BYTES,
            ...(initial === null ? {} : { expectedNode: initial.facts.node }),
            ...(signal === undefined ? {} : { signal }),
        });
        if (initial === null
            || current.digest !== initial.facts.digest
            || current.byteCount !== initial.facts.byteCount) {
            fail("source", "$source");
        }
    }
    catch (error) {
        if (error instanceof WakeflowGitignoreInspectionError)
            throw error;
        if (error instanceof StableFileReadError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (initial === null && error.reason === "not-found")
                return;
            fail("source", "$source");
        }
        throw error;
    }
}
function decodeOutside(bytes, envelope) {
    try {
        if (envelope.kind === "unmanaged") {
            return Object.freeze({ prefix: decodeUtf8(bytes), suffix: "" });
        }
        return Object.freeze({
            prefix: decodeUtf8(bytes.subarray(envelope.prefixOutsideRange.offset, envelope.prefixOutsideRange.endExclusive)),
            suffix: decodeUtf8(bytes.subarray(envelope.suffixOutsideRange.offset, envelope.suffixOutsideRange.endExclusive)),
        });
    }
    catch (error) {
        if (error instanceof Utf8Error)
            fail("envelope", "$source");
        throw error;
    }
}
function decodeLiteralRule(rule) {
    const directory = rule.endsWith("/");
    const encoded = rule.slice(1, directory ? -1 : undefined);
    let resourcePath = "";
    for (let index = 0; index < encoded.length; index += 1) {
        const character = encoded[index];
        if (character === "\\") {
            const escaped = encoded[index + 1];
            if (escaped === undefined)
                fail("authority", "$authority.rules");
            resourcePath += escaped;
            index += 1;
        }
        else {
            resourcePath += character;
        }
    }
    try {
        return Object.freeze({
            resourcePath: parsePortableResourcePath(resourcePath),
            directory,
        });
    }
    catch {
        fail("authority", "$authority.rules");
    }
}
function probePath(rule) {
    const decoded = decodeLiteralRule(rule);
    return decoded.directory
        ? parsePortableResourcePath(`${decoded.resourcePath}/${GIT_DIRECTORY_PROBE_NAME}`)
        : decoded.resourcePath;
}
async function observeRules(root, rules, signal) {
    const probes = Object.freeze(rules.map((rule) => probePath(rule)));
    let observed;
    try {
        observed = await observeGitIgnorePaths(root, probes, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof GitIgnoreObservationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("git", "$git");
        }
        throw error;
    }
    return ruleChecks(rules, probes, observed.paths);
}
function ruleChecks(rules, probes, observations) {
    if (observations.length !== rules.length
        || probes.length !== rules.length) {
        fail("git", "$git");
    }
    return Object.freeze(rules.map((rule, index) => {
        const pathObservation = observations[index];
        const probe = probes[index];
        if (pathObservation === undefined || pathObservation.path !== probe) {
            fail("git", "$git");
        }
        return Object.freeze({
            rule,
            probePath: pathObservation.path,
            ignored: pathObservation.ignored
                && pathObservation.decision?.source === ".gitignore",
        });
    }));
}
function unmatchedRuleChecks(rules) {
    return Object.freeze(rules.map((rule) => Object.freeze({
        rule,
        probePath: probePath(rule),
        ignored: false,
    })));
}
async function observeTargetRules(root, rules, target, signal) {
    if (target.byteCount > WAKEFLOW_GITIGNORE_MAXIMUM_BYTES) {
        fail("target-capacity", "$target");
    }
    const probes = Object.freeze(rules.map((rule) => probePath(rule)));
    let observed;
    try {
        observed = await observeGitIgnoreCandidate(root, target.bytes, probes, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof GitIgnoreCandidateObservationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "capacity")
                fail("target-capacity", "$target");
            fail("git", "$git");
        }
        throw error;
    }
    if (observed.candidateByteCount !== target.byteCount
        || observed.candidateDigest !== target.digest) {
        fail("git", "$git");
    }
    const checks = ruleChecks(rules, probes, observed.paths);
    if (checks.some((entry) => !entry.ignored)) {
        fail("candidate-semantics", "$target");
    }
    return checks;
}
function inspectEnvelope(bytes) {
    try {
        return inspectWakeflowManagedTextEnvelope(bytes);
    }
    catch (error) {
        if (error instanceof WakeflowManagedTextEnvelopeError) {
            fail("envelope", "$source");
        }
        throw error;
    }
}
/** 稳定检查当前 `.gitignore` 并生成零写入的下一操作候选。 */
export async function inspectWakeflowWorkspaceGitignore(rootValue, requestValue) {
    assertRoot(rootValue);
    const request = parseRequest(requestValue);
    if (request.signal?.aborted === true)
        fail("aborted", "$signal");
    const expectedUserId = currentUserId();
    let context;
    try {
        context = createWakeflowWorkspaceStaticResourceOperationContext(request.matrix, {
            expectedMatrixDigest: request.expectedMatrixDigest,
            declarationId: "workspace.ignore-integration",
            recipe: "exact-source-recompose",
        });
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceStaticResourceOperationContextError) {
            fail("context", "$context");
        }
        throw error;
    }
    let authority;
    try {
        authority = createWakeflowGitignoreBodyAuthority(request.hostProfiles);
    }
    catch (error) {
        if (error instanceof WakeflowGitignoreBodyAuthorityError) {
            fail("authority", "$authority");
        }
        throw error;
    }
    const read = await readSource(rootValue, request.signal, expectedUserId);
    const bytes = read?.bytes ?? new Uint8Array();
    const envelope = inspectEnvelope(bytes);
    if (envelope.kind === "managed"
        && (envelope.component !== authority.envelopeTarget.component
            || envelope.owner !== authority.envelopeTarget.owner)) {
        fail("envelope", "$source");
    }
    if (envelope.kind === "managed"
        && (envelope.bodyDigest !== authority.bodyDigest
            || envelope.body !== authority.body)) {
        fail("unknown-managed-body", "$source");
    }
    const exactOutside = classifyWakeflowGitignoreExactOutsideRules(authority, decodeOutside(bytes, envelope));
    if (exactOutside.kind === "conflict") {
        fail("outside-conflict", "$source");
    }
    const gitRuleChecks = read === null
        ? unmatchedRuleChecks(authority.rules)
        : await observeRules(rootValue, authority.rules, request.signal);
    if (read !== null) {
        await revalidateSource(rootValue, read, request.signal);
    }
    const allIgnored = gitRuleChecks.every((entry) => entry.ignored);
    if (envelope.kind === "managed") {
        if (!allIgnored)
            fail("outside-conflict", "$git");
        return Object.freeze({
            status: "managed-current",
            context,
            authority,
            source: read?.facts ?? null,
            envelope,
            exactOutside,
            gitRuleChecks,
            targetGitRuleChecks: null,
            target: null,
        });
    }
    if (read !== null && allIgnored) {
        return Object.freeze({
            status: "satisfied-user-owned",
            context,
            authority,
            source: read.facts,
            envelope,
            exactOutside,
            gitRuleChecks,
            targetGitRuleChecks: null,
            target: null,
        });
    }
    const target = recomposeWakeflowManagedTextEnvelope(bytes, authority.envelopeTarget);
    const targetGitRuleChecks = await observeTargetRules(rootValue, authority.rules, target, request.signal);
    await revalidateSource(rootValue, read, request.signal);
    return Object.freeze({
        status: "recompose-required",
        context,
        authority,
        source: read?.facts ?? null,
        envelope,
        exactOutside,
        gitRuleChecks,
        targetGitRuleChecks,
        target,
    });
}
