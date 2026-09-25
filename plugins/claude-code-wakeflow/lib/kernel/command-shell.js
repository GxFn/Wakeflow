import os from "node:os";
import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import { JsonValueError, parseJsonValue } from "../foundation/data/json-value.js";
import { RootedDirectory, RootedDirectoryError, } from "../foundation/filesystem/rooted-directory.js";
import { fail, toWakeflowError } from "./error.js";
import { assertWithinByteLimit } from "./limits.js";
import { assertPublicJson, assertRequestFreeOfPrivateText, createRedactionBoundary, } from "./redaction.js";
function rootOpenOptions(options) {
    return options.durability === undefined ? undefined : { durability: options.durability };
}
/**
 * 切片把自己的执行选项收窄成调用形状接受的形状。
 *
 * 切片的执行选项还带 `clock`、`signal` 等与内核无关的注入值；这里只取出持久化级别，
 * 缺省就什么都不传，使外壳与生产组合根看到的是同一个"未指定"。
 */
export function commandShellExecutionOptions(durability) {
    return durability === undefined ? Object.freeze({}) : Object.freeze({ durability });
}
function requestJson(value) {
    try {
        return parseJsonValue(value, "$request");
    }
    catch (error) {
        if (error instanceof JsonValueError) {
            fail("invalid-request", "not-json", error.path);
        }
        throw error;
    }
}
function payloadWithoutRoot(json) {
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
        fail("invalid-request", "not-object", "$request");
    }
    return Object.freeze(Object.fromEntries(Object.entries(json).filter(([key]) => key !== "root")));
}
/**
 * 执行一个公共命令：`admit` 在打开上下文之前做形状特有的纯校验，`body` 在上下文里
 * 执行并返回组装好的公共结果。任何异常都收敛为 `WakeflowError`。
 */
export async function runCommandShell(spec, value, admit, body, options = {}) {
    const json = requestJson(value);
    assertWithinByteLimit(json, "publicRequestBytes", "$request");
    const { envelope, input } = spec.parseRequest(json);
    const payload = payloadWithoutRoot(json);
    const requestDigest = computeCanonicalJsonSha256Digest(payload);
    let workspaceRoot;
    try {
        workspaceRoot = await RootedDirectory.open(envelope.root, "$request.root", rootOpenOptions(options));
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            fail("root-invalid", error.reason, "$request.root", { cause: error });
        }
        throw error;
    }
    const binding = Object.freeze({
        envelope,
        input,
        payload,
        requestDigest,
        workspaceRoot,
    });
    let boundary = createRedactionBoundary([envelope.root, workspaceRoot.absolutePath, os.homedir()]);
    let context;
    let result;
    let failure;
    try {
        admit(binding);
        assertRequestFreeOfPrivateText(withoutExemptPaths(payload, spec.requestPrivacyExemptPaths ?? []), boundary, "$request");
        context = await spec.open(workspaceRoot, envelope);
        if (spec.privateValues !== undefined) {
            boundary = createRedactionBoundary([
                ...boundary.privateValues,
                ...spec.privateValues(context),
            ]);
        }
        const assembled = await body(context, binding, boundary);
        const assembledJson = parseJsonValue(assembled, "$result");
        assertPublicJson(assembledJson, boundary, "$result");
        assertWithinByteLimit(assembledJson, "publicResultBytes", "$result");
        result = assembled;
    }
    catch (error) {
        failure = toWakeflowError(error, "$request");
    }
    failure = await releaseCommandShell(spec, context, workspaceRoot, failure);
    if (failure !== undefined)
        throw failure;
    if (result === undefined)
        fail("unexpected", "no-result", "$result");
    return result;
}
/** 去掉请求里豁免扫描的字段（只走对象路径；路径不存在即原样；从不原地修改输入）。 */
function withoutExemptPaths(payload, paths) {
    let current = payload;
    for (const dotted of paths)
        current = withoutPath(current, dotted.split("."));
    return current;
}
function withoutPath(value, segments) {
    const [head, ...rest] = segments;
    if (head === undefined || typeof value !== "object" || value === null || Array.isArray(value)) {
        return value;
    }
    if (!Object.hasOwn(value, head))
        return value;
    const copy = {};
    for (const [key, entry] of Object.entries(value)) {
        if (key !== head) {
            copy[key] = entry;
        }
        else if (rest.length > 0) {
            copy[key] = withoutPath(entry, rest);
        }
    }
    return copy;
}
/** 关闭上下文与根；主体失败优先，关闭失败只在主体成功时成为结局。 */
async function releaseCommandShell(spec, context, workspaceRoot, failure) {
    let outcome = failure;
    if (context !== undefined) {
        try {
            await spec.close(context);
        }
        catch (error) {
            outcome ??= toWakeflowError(error, "$context");
        }
    }
    try {
        await workspaceRoot.close();
    }
    catch (error) {
        outcome ??= toWakeflowError(error, "$request.root");
    }
    return outcome;
}
