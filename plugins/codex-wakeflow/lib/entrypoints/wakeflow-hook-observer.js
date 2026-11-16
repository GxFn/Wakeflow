import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import nodePath from "node:path";
import { computeSha256Digest } from "../foundation/crypto/sha256.js";
import { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import { parseUtcInstant } from "../foundation/time/utc-instant.js";
import { createHostHookObservation, writeHostHookObservation, } from "../kernel/hook-observations.js";
import { createIncidentId, recordIncident } from "../kernel/incident.js";
import { parseWakeflowHostId } from "../kernel/layout.js";
import { computePromptDigest, countPromptCharacters, extractPromptPermitIds, } from "../kernel/prompt-digest.js";
import { parseWakeflowArtifactManifestIdentity, } from "../kernel/wakeflow-artifact-identity.js";
import { isRecord, matchingWorkspaces, parseHookStdinObject, resolveSubject, sessionBoundWindowIds, } from "./wakeflow-hook-workspaces.js";
import { runWakeflowWriteGuardProcess, WAKEFLOW_WRITE_GUARD_MARKER, } from "./wakeflow-hook-write-guard.js";
/**
 * Wakeflow Entrypoint / Hook Observer：两宿主生命周期 hook 的观察脚本（gate-log §13.97 D1–D4）。
 *
 * 宿主在 `SessionStart`、`UserPromptSubmit`、`Stop`、`SessionEnd`（Claude Code 还有 `Notification`，
 * open-items A7，§13.167）时按插件级 hook 配置启动本入口：
 * stdin 是宿主的 hook JSON，argv 只带固定标记与 `--host <codex | claude-code>`，`--host` 只供给写进
 * 记录的 `hostId`，字段映射在两宿主间完全同形。工作区按声明拓扑定位（D2）：锚点是会话 cwd
 * （cwd 已删除时用 `CLAUDE_PROJECT_DIR`）与 worktree 指针指向的主仓库；候选根是锚点及其至多 8 级
 * 祖先里含 `wakeflow.config.json` 的目录，加上祖先的直接子目录里含它的目录；每个候选只结构化读取
 * `topology.repositories[].path` 与 `topology.supportSurfaces[].path`，realpath(cwd) 等于或位于根、
 * 支持面、仓库之下，或位于主仓库为声明仓库的检出之下即匹配。`session-start` 写进每个匹配的工作区，
 * 其余事件只写进绑定目录已持有该 `session_id` 句柄的工作区。记录只经内核 `writeHostHookObservation`
 * 写入（D3）：只有 `session_id`、`cwd`、`hook_event_name` 是必填，不合内核合同即 `stdin-invalid`；
 * 可选字段（turn 标识、transcript 路径、消息正文、权限模式与会话标题）不合合同时只把该字段降级为 null，
 * 会话事实照写。
 * 进程永远退出 0、stdout 为空、stderr 只在异常时打一行固定代码，不含路径、句柄与提示正文（D4）；
 * 进程级守卫经 `registerProcessGuards` 只登记一次，一次故障恰好一行。闭包限于 foundation 与
 * kernel（加上同目录的两个 hook 模块，它们守同一条闭包规则）：不加载配置校验器，非 Wakeflow 会话必须
 * 静默且便宜。工作区定位与绑定读取在 `wakeflow-hook-workspaces.ts`，与写守卫共用。
 *
 * 同一个脚本还有第二种调用（ADR-0020 的 2026-11-16 补充）：argv 以写守卫的标记开头时，进程入口把这一次
 * `PreToolUse` 交给 `wakeflow-hook-write-guard.ts`——它不写观察记录，拒绝时由它向 stdout 写一行决定。
 * "stdout 为空"说的是观察这一种调用；本文件自己从不写 stdout。
 *
 * 记录的语义边界：被打断或 API 失败的回合没有 `stop` 记录，消费者把缺席当 pending；Codex 的
 * `session-end` 最迟滞后 30 分钟，不是活性信号；同一处理器被注册两次会得到两条时间不同的记录，
 * 消费者取首条匹配。
 */
export const WAKEFLOW_HOOK_OBSERVER_MARKER = "--wakeflow-hook-observer-v1";
export const WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT = "--host";
export const WAKEFLOW_HOOK_OBSERVER_STDIN_MAXIMUM_BYTES = 4 * 1024 * 1024;
const HOST_EVENTS = new Map([
    ["SessionStart", "session-start"],
    ["UserPromptSubmit", "user-prompt-submit"],
    ["Stop", "stop"],
    ["SessionEnd", "session-end"],
    ["Notification", "notification"],
]);
function optionalString(value) {
    return typeof value === "string" ? value : null;
}
function failure(code) {
    return Object.freeze({ ok: false, code });
}
function success(value) {
    return Object.freeze({ ok: true, value });
}
// ---- argv 与 stdin ------------------------------------------------------------
/** argv 固定为 `<标记> --host <宿主>`；缺标记或形状不对是 argv-invalid，宿主不识别是 host-unknown。 */
function parseHost(argv) {
    if (!Array.isArray(argv) || argv.length !== 3)
        return failure("argv-invalid");
    const [marker, argument, host] = argv;
    if (marker !== WAKEFLOW_HOOK_OBSERVER_MARKER ||
        argument !== WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT) {
        return failure("argv-invalid");
    }
    try {
        return success(parseWakeflowHostId(host, "$argv.host"));
    }
    catch {
        return failure("host-unknown");
    }
}
/** stdin 是一个宿主 hook JSON 对象；超限先于解析判定，缺公共字段即 stdin-invalid。 */
function parsePayload(stdin) {
    const parsed = parseHookStdinObject(stdin, WAKEFLOW_HOOK_OBSERVER_STDIN_MAXIMUM_BYTES);
    if (!parsed.ok)
        return failure(parsed.code);
    const object = parsed.value;
    const sessionId = object.session_id;
    const cwd = object.cwd;
    const eventName = object.hook_event_name;
    if (typeof sessionId !== "string" ||
        sessionId.length === 0 ||
        typeof cwd !== "string" ||
        !nodePath.isAbsolute(cwd) ||
        typeof eventName !== "string") {
        return failure("stdin-invalid");
    }
    return success(Object.freeze({
        sessionId,
        cwd,
        event: HOST_EVENTS.get(eventName) ?? null,
        transcriptPath: optionalString(object.transcript_path),
        prompt: optionalString(object.prompt),
        lastAssistantMessage: optionalString(object.last_assistant_message),
        turnId: optionalString(object.turn_id) ?? optionalString(object.prompt_id),
        notificationType: optionalString(object.notification_type),
        permissionMode: optionalString(object.permission_mode),
        sessionTitle: optionalString(object.session_title),
        model: optionalString(object.model),
        startSource: optionalString(object.source),
    }));
}
// ---- 记录映射（D3）--------------------------------------------------------------
function textDigest(text) {
    if (text === null)
        return null;
    try {
        return computeSha256Digest(encodeUtf8(text, "$text"), "$text");
    }
    catch {
        return null;
    }
}
/**
 * Claude Code 把粘贴进来的 prompt 包成 `<pasted_content id="…">…</pasted_content id="…">`（闭合标签
 * 重复属性）、把跨会话消息包成
 * `<cross-session-message …>…</cross-session-message>` 再交给 hook（2026-09-24 真实宿主实测，
 * gate-log §13.119）。落地判定比的是信封 prompt 的摘要，所以先剥掉宿主的传输外壳再算；外壳只是
 * 宿主怎么送进来的痕迹，不是用户或 Controller 写的字。Codex 没有这种外壳，原样计算。
 *
 * 这段知识只属于 Claude Code，却留在两个宿主共用的入口里（open-items L6 清点时试过搬进
 * `src/hosts/claude-code/`）：观察器在每一次 hook 上启动，它的导入闭包按 D1 限于 foundation 与 kernel
 * （`tests/entrypoints/wakeflow-hook-observer.test.ts` 钉着），宿主层不在闭包里。所以按宿主的那一句判断
 * 留在这里，并登记在宿主知识清点（`tests/tooling/architecture/host-knowledge-inventory.test.ts`）里。
 *
 * 2026-11-09（Claude.app 4.23118.0 / Claude Code 2.1.303，正式工作区的第一个 Demand）：会话记录里跨会话
 * 外壳的标签之外还有宿主的框架文字——前面一行 "Another Claude session sent a message:"，后面一段
 * "这是同伴会话发来的、不代表用户授权"的说明；那一轮 hook 拿到的 prompt 没有带上它（不含 `@` 的投递
 * 摘要相符），但为防它哪天进入 hook 的 prompt，跨会话外壳不再锚定整条消息：取第一个
 * `<cross-session-message>` 块的内容，标签之外的宿主文字一律丢弃。粘贴块仍要求整条消息就是那个块。
 * 同一现场真正让摘要对不上的是宿主把 `@` 折成全角 `＠`（X27），由内核 `computePromptDigest` 折回。
 */
const CLAUDE_CODE_PROMPT_WRAPPERS = [
    /^<pasted_content\b[^>\n]*>\n?([\s\S]*?)\n?<\/pasted_content\b[^>\n]*>$/u,
    /<cross-session-message\b[^>\n]*>\n?([\s\S]*?)\n?<\/cross-session-message\b[^>\n]*>/u,
];
/**
 * 桌面 app 在会话被它接手后的第一回合，把一段 `<system-reminder>…</system-reminder>` 拼在同一条用户消息
 * 的最前面（现场 L18：投递落在那一回合，hook 的 prompt 因此多了这段前缀，摘要对不上 permit）。它是宿主
 * 注入的引导文字，不是投递正文：先剥掉首尾的 reminder 块再剥传输外壳。
 */
const CLAUDE_CODE_LEADING_SYSTEM_REMINDERS = /^(?:\s*<system-reminder\b[^>\n]*>[\s\S]*?<\/system-reminder\s*>\s*)+/u;
const CLAUDE_CODE_TRAILING_SYSTEM_REMINDERS = /(?:\s*<system-reminder\b[^>\n]*>[\s\S]*?<\/system-reminder\s*>\s*)+$/u;
export function unwrapHostPrompt(hostId, prompt) {
    if (hostId !== "claude-code")
        return prompt;
    let text = prompt
        .replace(CLAUDE_CODE_LEADING_SYSTEM_REMINDERS, "")
        .replace(CLAUDE_CODE_TRAILING_SYSTEM_REMINDERS, "")
        .trim();
    for (let depth = 0; depth < 2; depth += 1) {
        const match = CLAUDE_CODE_PROMPT_WRAPPERS.map((pattern) => pattern.exec(text)).find((entry) => entry !== null);
        if (match === undefined || match === null)
            break;
        text = (match[1] ?? "").trim();
    }
    return text;
}
const NO_PROMPT_FACTS = Object.freeze({
    promptDigest: null,
    promptPermitIds: null,
    promptCharacters: null,
});
/**
 * 一条提交的 prompt 留下的三件事实（ADR-0027 决定 2）：解包后的摘要、摘要所覆盖文本的字符数，与
 * 许可身份行里的标识。身份与摘要各算各的：摘要算不出（文本过长）时身份照样记，宿主改了文本、摘要
 * 对不上时，身份就是认出这条许可的依据。
 */
function promptFacts(hostId, prompt) {
    if (prompt === null)
        return NO_PROMPT_FACTS;
    try {
        const text = unwrapHostPrompt(hostId, prompt);
        return Object.freeze({
            promptDigest: computePromptDigest(text),
            promptPermitIds: extractPromptPermitIds(text),
            promptCharacters: countPromptCharacters(text),
        });
    }
    catch {
        return NO_PROMPT_FACTS;
    }
}
/** 必填字段（宿主、事件、会话、cwd）与时间按内核合同核对：任何一个不合合同即 stdin-invalid。 */
function requiredInput(hostId, payload, event, clock) {
    try {
        const input = Object.freeze({
            hostId,
            event,
            sessionId: payload.sessionId,
            cwd: payload.cwd,
            recordedAt: parseUtcInstant(clock().toISOString(), "$recordedAt"),
            turnId: null,
            promptDigest: null,
            lastAssistantMessageDigest: null,
            transcriptRef: null,
        });
        createHostHookObservation(input);
        return input;
    }
    catch {
        return null;
    }
}
function degradeToKernel(required, field, value) {
    if (value === null)
        return null;
    try {
        createHostHookObservation(withOptionalField(required, field, value));
        return value;
    }
    catch {
        return null;
    }
}
function withOptionalField(required, field, value) {
    switch (field) {
        case "turnId":
            return { ...required, turnId: value };
        case "transcriptRef":
            return { ...required, transcriptRef: value };
        case "permissionMode":
            return { ...required, permissionMode: value };
        case "sessionTitle":
            return { ...required, sessionTitle: value };
        case "model":
            return { ...required, model: value };
        case "startSource":
            return { ...required, startSource: value };
        default:
            return { ...required, notificationType: value };
    }
}
/** 必填字段不合合同即 null（stdin-invalid）；可选字段各自降级；写入阶段只剩 I/O 失败。 */
function recordInput(hostId, payload, event, clock, artifactManifestDigest, artifactVersion) {
    const required = requiredInput(hostId, payload, event, clock);
    if (required === null)
        return null;
    return Object.freeze({
        ...required,
        artifactManifestDigest: artifactManifestDigest ?? null,
        artifactVersion: artifactVersion ?? null,
        turnId: degradeToKernel(required, "turnId", payload.turnId),
        ...(event === "user-prompt-submit" ? promptFacts(hostId, payload.prompt) : NO_PROMPT_FACTS),
        lastAssistantMessageDigest: event === "stop" ? textDigest(payload.lastAssistantMessage) : null,
        transcriptRef: degradeToKernel(required, "transcriptRef", payload.transcriptPath),
        notificationType: event === "notification"
            ? degradeToKernel(required, "notificationType", payload.notificationType)
            : null,
        // 模式与标题是会话事实，按宿主交回的原样逐字段降级；不带它们的宿主（Codex）与事件自然是 null。
        permissionMode: degradeToKernel(required, "permissionMode", payload.permissionMode),
        sessionTitle: degradeToKernel(required, "sessionTitle", payload.sessionTitle),
        // 模型只在会话启动时有意义：别的事件即使带了同名字段也不记（X28）。
        model: event === "session-start" ? degradeToKernel(required, "model", payload.model) : null,
        // 启动来源只属于 SessionStart：它决定这条记录算不算一次运行时的重新装载（B14）。
        startSource: event === "session-start"
            ? degradeToKernel(required, "startSource", payload.startSource)
            : null,
    });
}
async function writeObservation(root, input) {
    let directory = null;
    try {
        directory = await RootedDirectory.open(root, "$workspaceRoot");
        const receipt = await writeHostHookObservation(directory, input);
        return Object.freeze({
            written: Object.freeze({
                workspaceRoot: root,
                recordId: receipt.record.recordId,
                disposition: receipt.disposition,
            }),
        });
    }
    catch (error) {
        return Object.freeze({ failure: error });
    }
    finally {
        if (directory !== null) {
            try {
                await directory.close();
            }
            catch {
                // 记录已写成或已失败；根句柄关闭失败不改变结果。
            }
        }
    }
}
function outcome(code, written) {
    return Object.freeze({ code, written: Object.freeze([...written]) });
}
// ---- 窗口状态投影（ADR-0023） -------------------------------------------------------
const TMUX_PANE_ID_PATTERN = /^%\d{1,9}$/u;
const WINDOW_STATE_OPTION = "@wakeflow_state";
const WINDOW_STATE_TIMEOUT_MILLISECONDS = 1000;
/** 事件到状态的封闭映射；undefined 即不写（其他类型的 Notification）。 */
function windowStateFor(event, notificationType) {
    switch (event) {
        case "session-start":
            return "idle";
        case "user-prompt-submit":
            return "working";
        case "stop":
            return "idle";
        case "session-end":
            return null;
        case "notification":
            if (notificationType === "permission_prompt")
                return "attention";
            if (notificationType === "idle_prompt")
                return "idle";
            return undefined;
        default:
            return undefined;
    }
}
/** hook 进程继承了 pane 里 claude 的环境：`TMUX` 与 `TMUX_PANE` 同时在场才说明它在 tmux 里。 */
function tmuxTargetOf(env) {
    const socketPath = typeof env.TMUX === "string" ? (env.TMUX.split(",")[0] ?? "") : "";
    const paneId = env.TMUX_PANE;
    if (!socketPath.startsWith("/") ||
        typeof paneId !== "string" ||
        !TMUX_PANE_ID_PATTERN.test(paneId)) {
        return null;
    }
    return Object.freeze({ socketPath, paneId });
}
/** 缺省投影器：一次有界的 tmux 客户端，不重试、不抛、不读回。 */
function projectWindowStateWithTmux(projection) {
    try {
        spawnSync("tmux", [
            "-S",
            projection.socketPath,
            "set-option",
            "-w",
            "-t",
            projection.paneId,
            ...(projection.state === null
                ? ["-u", WINDOW_STATE_OPTION]
                : [WINDOW_STATE_OPTION, projection.state]),
        ], { stdio: "ignore", timeout: WINDOW_STATE_TIMEOUT_MILLISECONDS });
    }
    catch {
        // UI 投影失败静默：记录已经写下，落地与验收永不看这个选项。
    }
}
function projectWindowState(input, event, notificationType) {
    const state = windowStateFor(event, notificationType);
    if (state === undefined)
        return;
    const target = tmuxTargetOf(isRecord(input.env) ? input.env : {});
    if (target === null)
        return;
    const projector = input.projectWindowState ?? projectWindowStateWithTmux;
    try {
        projector(Object.freeze({ ...target, state }));
    }
    catch {
        // 注入的投影器抛错同样静默。
    }
}
function defaultClock() {
    return new Date();
}
async function observe(input, written) {
    const host = parseHost(input.argv);
    if (!host.ok)
        return outcome(host.code, written);
    const payload = parsePayload(input.stdin);
    if (!payload.ok)
        return outcome(payload.code, written);
    if (payload.value.event === null)
        return outcome("event-unknown", written);
    const clock = typeof input.clock === "function" ? input.clock : defaultClock;
    const record = recordInput(host.value, payload.value, payload.value.event, clock, input.artifactManifestDigest, input.artifactVersion);
    if (record === null)
        return outcome("stdin-invalid", written);
    const subject = await resolveSubject(payload.value.cwd, isRecord(input.env) ? input.env : {});
    if (subject === null)
        return outcome(null, written);
    const landing = await writeToMatchingWorkspaces(subject, host.value, record, written);
    // ADR-0023：只对已绑定会话投影窗口状态；记录写入的成败不受它影响。
    if (landing.bound)
        projectWindowState(input, record.event, payload.value.notificationType);
    return outcome(landing.failed ? "write-failed" : null, written);
}
/** 写进每个匹配的工作区：session-start 之外只写已绑定的会话；报是否有写失败、是否命中了绑定。 */
async function writeToMatchingWorkspaces(subject, hostId, record, written) {
    let failed = false;
    let bound = false;
    for (const workspace of await matchingWorkspaces(subject)) {
        const binds = (await sessionBoundWindowIds(workspace, hostId, record.sessionId)).length > 0;
        if (record.event !== "session-start" && !binds)
            continue;
        if (binds)
            bound = true;
        const result = await writeObservation(workspace, record);
        if ("failure" in result) {
            failed = true;
            await recordWriteFailure(workspace, hostId, record.event, result.failure);
        }
        else {
            written.push(result.written);
        }
    }
    return { failed, bound };
}
/**
 * 写失败留一条事故记录（open-items G8，§13.166）：工作区已初始化时才写，失败静默；verify 的
 * host-hook-channel 门按宿主数这些记录，用户与 Controller 才看得到"投递看起来发了却没有证据"的原因。
 */
async function recordWriteFailure(root, hostId, event, failure) {
    let directory = null;
    try {
        directory = await RootedDirectory.open(root, "$workspaceRoot");
        await recordIncident(directory, {
            incidentId: createIncidentId(),
            source: "hook-observer",
            hostId,
            event,
            error: failure,
        });
    }
    catch {
        // 事故记录是尽力而为。
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
/**
 * 纯函数入口：从不触碰 `process.*`、从不抛出、从不写 stdout。一个工作区写失败只标记
 * `write-failed`，不影响其他工作区；没有匹配的工作区时 code 为 null 且不写。外层 catch 只兜
 * 预期之外的内部故障（例如调用方传进来的输入对象在取值时抛错），它发生在写之前也可能发生在
 * 写之中，所以报 `internal` 而不是冒充 `write-failed`——已经写成的记录仍在 `written` 里。
 */
export async function runWakeflowHookObserver(input) {
    const written = [];
    try {
        return await observe(input, written);
    }
    catch {
        return outcome("internal", written);
    }
}
// ---- 进程入口（D4）--------------------------------------------------------------
/** stderr 上只出现 `HookObserverStderrCode` 里的词：类型让进程侧与导出的词汇表不会各说各话。 */
function writeStderrLine(code) {
    try {
        process.stderr.write(`wakeflow-hook-observer: ${code}\n`);
    }
    catch {
        // stderr 不可用时也不改变退出码。
    }
}
function internalGuard() {
    writeStderrLine("internal");
    process.exitCode = 0;
}
let processGuardsRegistered = false;
/**
 * 进程级守卫只有一条登记路径：未捕获异常与未处理拒绝各打一行固定代码、退出码钉在 0。模块级
 * 标志让 `main()` 与任何再次调用它的 launcher 都不会登记第二个守卫，一次进程级故障恰好一行。
 */
export function registerProcessGuards() {
    if (processGuardsRegistered)
        return;
    processGuardsRegistered = true;
    process.on("uncaughtException", internalGuard);
    process.on("unhandledRejection", internalGuard);
}
/** 读完整个 stdin；超限后继续消费但不再保留，超限本身由纯函数入口按字节数判定。 */
async function readStandardInput() {
    const chunks = [];
    let total = 0;
    for await (const chunk of process.stdin) {
        const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk), "utf8");
        if (total <= WAKEFLOW_HOOK_OBSERVER_STDIN_MAXIMUM_BYTES)
            chunks.push(bytes);
        total += bytes.byteLength;
    }
    return Buffer.concat(chunks);
}
/**
 * 观察脚本所属制品的身份（§13.127；版本轴 §3.6 C6）：制品根是 `lib/entrypoints/<本文件>` 的上两级，
 * 摘要与 `version` 从同一次读出的 manifest 字节解析；测试构建没有 manifest，读成 null。用 URL 相对
 * 解析而不引入 node:url，保持入口闭包不变（D1）。
 */
async function artifactIdentityOf(importMetaUrl) {
    try {
        const bytes = await readFile(new URL("../../artifact-manifest.json", importMetaUrl));
        return parseWakeflowArtifactManifestIdentity(new Uint8Array(bytes));
    }
    catch {
        return null;
    }
}
/**
 * 进程入口：只在 code 非 null 时向 stderr 打恰好一行固定代码，从不写 stdout，退出码保持 0。
 * 制品 launcher 只调用它；守卫在这里登记，launcher 自己不再登记。
 */
export async function main() {
    process.exitCode = 0;
    registerProcessGuards();
    try {
        const argv = process.argv.slice(2);
        const stdin = await readStandardInput();
        if (argv[0] === WAKEFLOW_WRITE_GUARD_MARKER) {
            // 同一个脚本的第二种调用：`PreToolUse` 上的写守卫。它不写观察记录，决定由它自己写到 stdout。
            await runWakeflowWriteGuardProcess(argv, process.env, stdin);
            process.exitCode = 0;
            return;
        }
        const artifact = await artifactIdentityOf(import.meta.url);
        const result = await runWakeflowHookObserver({
            argv,
            env: process.env,
            stdin,
            artifactManifestDigest: artifact?.manifestDigest ?? null,
            artifactVersion: artifact?.version ?? null,
        });
        if (result.code !== null)
            writeStderrLine(result.code);
    }
    catch {
        writeStderrLine("internal");
    }
    process.exitCode = 0;
}
