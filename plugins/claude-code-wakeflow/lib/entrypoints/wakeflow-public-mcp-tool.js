import os from "node:os";
import { fromJsonSchema, } from "@modelcontextprotocol/server";
import { canonicalizeJson } from "../foundation/data/canonical-json.js";
import { parseJsonValue } from "../foundation/data/json-value.js";
import { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../foundation/schema/runtime-json-schema.js";
import { fail, toWakeflowError } from "../kernel/error.js";
import { createIncidentId, recordIncident } from "../kernel/incident.js";
import { assertCanonicalTextWithinLimit } from "../kernel/limits.js";
import { assertPublicJson, createRedactionBoundary } from "../kernel/redaction.js";
import { publicToolDefinition } from "../kernel/tool-registry.js";
/**
 * Wakeflow Entrypoint / MCP：公共工具的协议边界。
 *
 * 官方 SDK 拥有协议与工具调用生命周期；这里只做三件事：按登记表注册工具、把
 * executor 结果投影为 canonical JSON 并做脱敏与上限检查、把错误收敛为稳定的
 * 错误信封。请求校验用 Wakeflow 自己的运行时校验器（惰性编译），与服务端解析
 * 同一份 Schema、同一套规则。
 */
/** 进程级脱敏边界：用户 home 路径永不进入任何公共结果，与各 owner 的根扫描叠加。 */
const PROCESS_REDACTION_BOUNDARY = createRedactionBoundary([os.homedir()]);
/** 信封本身越过脱敏边界时退回的固定细节：封闭码里的 `unexpected`，原因只说明被脱敏。 */
const REDACTED_ERROR_DETAILS = Object.freeze({
    code: "unexpected",
    reason: "redacted",
    path: "$",
    retryable: false,
});
function errorEnvelope(tool, details) {
    return Object.freeze({
        kind: "WakeflowMcpError",
        schemaVersion: 1,
        tool,
        status: "error",
        error: details,
    });
}
/**
 * 错误信封与成功结果过同一进程脱敏边界；越界时退回固定的 redacted 信封。每个错误先经内核收敛：
 * 内核错误原样投影，旧错误类按 `LEGACY_ERROR_CODE_FAMILIES` 翻成封闭码（§13.166 批次 1，旧的逐字段
 * 投影已退役），其余是 `unexpected`。
 */
function redactedErrorEnvelope(tool, details) {
    const envelope = errorEnvelope(tool, details);
    try {
        assertPublicJson(parseJsonValue(envelope, "$mcpError"), PROCESS_REDACTION_BOUNDARY, "$mcpError");
        return envelope;
    }
    catch {
        return errorEnvelope(tool, REDACTED_ERROR_DETAILS);
    }
}
/** 这两类失败对 Agent 没有可修的原因（G4），所以留事故记录并在信封里回显事故 id（G1）。 */
const INCIDENT_CODES = new Set(["unexpected", "io-failure"]);
function requestRoot(request) {
    if (typeof request !== "object" || request === null)
        return null;
    const root = request.root;
    return typeof root === "string" ? root : null;
}
/** 尽力而为：请求指向一个已初始化的工作区才写；打开失败、不是工作区或写失败都静默。 */
async function recordToolIncident(request, tool, incidentId, failure) {
    const root = requestRoot(request);
    if (root === null)
        return;
    let directory = null;
    try {
        directory = await RootedDirectory.open(root, "$request.root");
        await recordIncident(directory, {
            incidentId,
            source: "mcp-tool",
            tool,
            error: failure,
            requestKeys: Object.keys(request),
        });
    }
    catch {
        // 事故记录从不让失败的调用失败得更厉害。
    }
    finally {
        if (directory !== null) {
            try {
                await directory.close();
            }
            catch {
                // 根句柄关闭失败不改变结果。
            }
        }
    }
}
function writeIncidentLine(line) {
    try {
        process.stderr.write(`${line}\n`);
    }
    catch {
        // stderr 不可用时结果不变。
    }
}
async function failedToolResult(tool, error, request) {
    const failure = toWakeflowError(error, "$");
    let details = failure.toPublicDetails();
    if (INCIDENT_CODES.has(failure.code)) {
        const incidentId = createIncidentId();
        details = Object.freeze({
            ...details,
            details: Object.freeze({ ...(details.details ?? {}), incidentId }),
        });
        await recordToolIncident(request, tool, incidentId, failure);
        writeIncidentLine(`wakeflow: incident ${incidentId} (${tool}: ${failure.code}/${failure.reason})`);
    }
    return {
        content: [
            {
                type: "text",
                text: canonicalizeJson(redactedErrorEnvelope(tool, details), "$mcpError"),
            },
        ],
        isError: true,
    };
}
/**
 * 把领域层的无原型JSON快照转换为MCP SDK可移植的标准JSON对象。
 * 文本与structuredContent共享同一Canonical JSON事实，避免两份独立投影漂移。
 */
function successfulToolResult(value) {
    const text = canonicalizeJson(value, "$result");
    assertCanonicalTextWithinLimit(text, "publicResultBytes", "$result");
    assertPublicJson(parseJsonValue(value, "$result"), PROCESS_REDACTION_BOUNDARY, "$result");
    const structuredContent = JSON.parse(text);
    if (structuredContent === null ||
        Array.isArray(structuredContent) ||
        typeof structuredContent !== "object") {
        throw new TypeError("Wakeflow MCP structured result must be an object.");
    }
    return {
        content: [{ type: "text", text }],
        structuredContent: structuredContent,
    };
}
/**
 * 给 SDK 的请求校验器提供者：Schema 在注册时准入，Ajv 编译推迟到该工具第一次
 * 被调用，因此注册二十余个工具不再支付编译成本。
 */
const WAKEFLOW_JSON_SCHEMA_VALIDATOR = Object.freeze({
    getValidator(schema) {
        const validate = createRuntimeJsonSchemaValidator(schema);
        return (input) => {
            let json;
            try {
                json = parseJsonValue(input, "$request");
            }
            catch {
                return {
                    valid: false,
                    data: undefined,
                    errorMessage: "Wakeflow tool input must be passive JSON.",
                };
            }
            const result = validate(json);
            return result.ok
                ? { valid: true, data: result.value, errorMessage: undefined }
                : {
                    valid: false,
                    data: undefined,
                    errorMessage: `Wakeflow tool input is invalid at ${result.path} (${result.detail}).`,
                };
        };
    },
});
/**
 * 按登记表向一个官方 MCP Server 注册全部公共工具。
 *
 * `tools/list` 只公开请求 Schema（ADR-0004）；结果由各 owner 按结果 Schema 校验。
 * 本函数不保存动态 registry、不选择领域 owner，也不解释业务错误。
 */
export function registerWakeflowPublicMcpCatalog(server, catalog, executors, beforeMutation, writer = null) {
    for (const registration of catalog.tools) {
        const execute = executors[registration.executor];
        if (typeof execute !== "function") {
            fail("unexpected", "tool-executor-missing", `$executors.${registration.executor}`);
        }
        const definition = publicToolDefinition(registration);
        server.registerTool(definition.name, {
            title: definition.title,
            description: definition.description,
            inputSchema: fromJsonSchema(definition.inputSchema, WAKEFLOW_JSON_SCHEMA_VALIDATOR),
            annotations: definition.annotations,
        }, async (request, context) => {
            try {
                const input = parseJsonValue(request, "$request");
                const inspected = input !== null &&
                    typeof input === "object" &&
                    (("mode" in input && input.mode === "preview") ||
                        ("operation" in input && input.operation === "inspect"));
                if (definition.annotations.readOnlyHint !== true && !inspected)
                    beforeMutation?.();
                return successfulToolResult(await execute(request, Object.freeze({ signal: context.mcpReq.signal, writer })));
            }
            catch (error) {
                return await failedToolResult(registration.name, error, request);
            }
        });
    }
}
