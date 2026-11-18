import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
const ERROR_MESSAGES = {
    "git-unavailable": "The read-only Git query could not start Git.",
    "query-failure": "The read-only Git query failed.",
    timeout: "The read-only Git query exceeded its execution deadline.",
    "output-limit": "The read-only Git query exceeded its output budget.",
    aborted: "The read-only Git query was aborted.",
};
const FAILURE_PATHS = {
    "git-unavailable": "$git",
    "query-failure": "$git",
    timeout: "$git",
    "output-limit": "$git.stdout",
    aborted: "$options.signal",
};
/** 只读 Git 查询失败的稳定、脱敏错误。 */
export class GitReadOnlyProcessError extends Error {
    name = "GitReadOnlyProcessError";
    code = "wakeflow-git-read-only-process";
    reason;
    path;
    constructor(reason) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = FAILURE_PATHS[reason];
    }
}
const KIBIBYTE = 1024;
const MEBIBYTE = 1024 * KIBIBYTE;
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
/** 补丁正文随证据保存的上限；超过时只留摘要与字节数（ADR-0028 决定 5）。 */
export const GIT_PATCH_RETAINED_BYTES_MAXIMUM = MEBIBYTE;
function nullDevicePath() {
    return process.platform === "win32" ? "NUL" : "/dev/null";
}
function objectId(value) {
    if (!OBJECT_ID_PATTERN.test(value))
        throw new GitReadOnlyProcessError("query-failure");
    return value;
}
function commonArguments(repositoryRoot, workTreeRoot) {
    return [
        "-C",
        repositoryRoot,
        ...(workTreeRoot === null ? [] : [`--work-tree=${workTreeRoot}`]),
        "--no-pager",
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        `core.hooksPath=${nullDevicePath()}`,
    ];
}
/** 相对 base 的两棵树比较；没有 base（根提交）时用 `--root` 的单提交形式。 */
function treeComparison(baseOid, commitOid) {
    return baseOid === null
        ? ["--root", "--no-commit-id", objectId(commitOid)]
        : [objectId(baseOid), objectId(commitOid)];
}
const DIFF_GUARDS = Object.freeze(["--no-ext-diff", "--no-textconv", "--no-renames"]);
function checkIgnoreSpec(query) {
    return {
        arguments: [
            ...commonArguments(query.repositoryRoot, query.workTreeRoot),
            "-c",
            `core.excludesFile=${nullDevicePath()}`,
            "-c",
            `core.worktree=${query.workTreeRoot}`,
            "-c",
            "core.bare=false",
            "check-ignore",
            "--no-index",
            "--verbose",
            "--non-matching",
            "--stdin",
            "-z",
        ],
        input: query.input,
        acceptedExitCodes: [0, 1],
        maximumOutputBytes: MEBIBYTE,
        retainOutputBytes: MEBIBYTE,
        maximumOutputChunks: 2048,
        timeoutMilliseconds: 5_000,
    };
}
function commitObjectSpec(query) {
    return {
        arguments: [...commonArguments(query.repositoryRoot, null), "cat-file", "--batch"],
        input: Buffer.from(`${objectId(query.commitOid)}\n`, "utf8"),
        acceptedExitCodes: [0],
        maximumOutputBytes: 256 * KIBIBYTE,
        retainOutputBytes: 256 * KIBIBYTE,
        maximumOutputChunks: 2048,
        timeoutMilliseconds: 5_000,
    };
}
function changedPathsSpec(query) {
    return {
        arguments: [
            ...commonArguments(query.repositoryRoot, null),
            "diff-tree",
            "-r",
            "-z",
            "--name-status",
            ...DIFF_GUARDS,
            ...treeComparison(query.baseOid, query.commitOid),
        ],
        input: null,
        acceptedExitCodes: [0],
        maximumOutputBytes: 4 * MEBIBYTE,
        retainOutputBytes: 4 * MEBIBYTE,
        maximumOutputChunks: 8192,
        timeoutMilliseconds: 10_000,
    };
}
function patchSpec(query) {
    return {
        arguments: [
            ...commonArguments(query.repositoryRoot, null),
            "diff-tree",
            "-p",
            ...DIFF_GUARDS,
            "--no-color",
            "--full-index",
            "--unified=3",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            ...treeComparison(query.baseOid, query.commitOid),
        ],
        input: null,
        acceptedExitCodes: [0],
        maximumOutputBytes: 64 * MEBIBYTE,
        retainOutputBytes: GIT_PATCH_RETAINED_BYTES_MAXIMUM,
        maximumOutputChunks: 65_536,
        timeoutMilliseconds: 20_000,
    };
}
function isAncestorSpec(query) {
    return {
        arguments: [
            ...commonArguments(query.repositoryRoot, null),
            "merge-base",
            "--is-ancestor",
            objectId(query.ancestorOid),
            objectId(query.descendantOid),
        ],
        input: null,
        acceptedExitCodes: [0, 1],
        maximumOutputBytes: 4 * KIBIBYTE,
        retainOutputBytes: 4 * KIBIBYTE,
        maximumOutputChunks: 16,
        timeoutMilliseconds: 5_000,
    };
}
function specOf(query) {
    switch (query.kind) {
        case "check-ignore":
            return checkIgnoreSpec(query);
        case "commit-object":
            return commitObjectSpec(query);
        case "changed-paths":
            return changedPathsSpec(query);
        case "patch":
            return patchSpec(query);
        case "is-ancestor":
            return isAncestorSpec(query);
    }
}
/**
 * Git 可以通过环境变量重定向 repository、worktree、配置和标准流。只继承非 Git 环境，并显式关闭
 * 系统与全局配置、交互提示和可选锁，使只读观察保持可预测。
 */
function gitObservationEnvironment(repositoryRoot) {
    const environment = Object.create(null);
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !key.toUpperCase().startsWith("GIT_")) {
            environment[key] = value;
        }
    }
    const nullDevice = nullDevicePath();
    environment.GIT_CONFIG_NOSYSTEM = "1";
    environment.GIT_CONFIG_GLOBAL = nullDevice;
    environment.GIT_CONFIG_SYSTEM = nullDevice;
    environment.GIT_OPTIONAL_LOCKS = "0";
    environment.GIT_TERMINAL_PROMPT = "0";
    // 不向上找：给定的根自己不是仓库时就是"不是仓库"，不拿包着它的那个仓库来回答。
    environment.GIT_CEILING_DIRECTORIES = path.dirname(repositoryRoot);
    return Object.freeze(environment);
}
/** 一次查询的输出累计：字节数与摘要始终完整，正文只保留到保留上限。 */
class OutputAccumulator {
    hash = createHash("sha256");
    byteCount = 0;
    chunkCount = 0;
    retained = [];
    /** 返回 false 表示超过硬上限。 */
    accept(chunk, spec) {
        this.byteCount += chunk.byteLength;
        this.chunkCount += 1;
        if (this.byteCount > spec.maximumOutputBytes || this.chunkCount > spec.maximumOutputChunks) {
            return false;
        }
        this.hash.update(chunk);
        if (this.retained !== null) {
            if (this.byteCount > spec.retainOutputBytes)
                this.retained = null;
            else
                this.retained.push(chunk);
        }
        return true;
    }
    result(exitCode) {
        return Object.freeze({
            exitCode,
            stdout: this.retained === null ? null : Buffer.concat(this.retained, this.byteCount),
            outputBytes: this.byteCount,
            outputSha256Hex: this.hash.digest("hex"),
        });
    }
}
/** 进程结束或出错时的失败分类；没有失败返回 null。 */
function failureOf(state) {
    if (state.aborted)
        return "aborted";
    if (state.timedOut)
        return "timeout";
    if (state.outputExceeded)
        return "output-limit";
    return null;
}
function spawnFailure(state, error) {
    return (failureOf(state) ??
        (readNodeSystemErrorCode(error) === "ENOENT" ? "git-unavailable" : "query-failure"));
}
function closeOutcome(state, spec, output, code) {
    const failure = failureOf(state);
    if (failure !== null)
        return failure;
    if (code === null || !spec.acceptedExitCodes.includes(code))
        return "query-failure";
    try {
        return output.result(code);
    }
    catch {
        return "output-limit";
    }
}
function runProcess(repositoryRoot, spec, signal) {
    return new Promise((resolve, reject) => {
        const state = {
            settled: false,
            aborted: false,
            timedOut: false,
            outputExceeded: false,
        };
        const output = new OutputAccumulator();
        const child = spawn("git", spec.arguments, {
            cwd: repositoryRoot,
            env: gitObservationEnvironment(repositoryRoot),
            shell: false,
            stdio: ["pipe", "pipe", "ignore"],
            windowsHide: true,
        });
        const terminate = () => {
            try {
                child.kill("SIGKILL");
            }
            catch {
                // 最终失败分类由 error/close 事件给出，不暴露平台 kill 细节。
            }
        };
        const onAbort = () => {
            state.aborted = true;
            terminate();
        };
        const timer = setTimeout(() => {
            state.timedOut = true;
            terminate();
        }, spec.timeoutMilliseconds);
        const finish = (outcome) => {
            if (state.settled)
                return;
            state.settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            if (typeof outcome === "string")
                reject(new GitReadOnlyProcessError(outcome));
            else
                resolve(outcome);
        };
        child.stdout.on("data", (chunk) => {
            if (state.outputExceeded || output.accept(chunk, spec))
                return;
            state.outputExceeded = true;
            terminate();
        });
        child.stdout.once("error", () => {
            terminate();
            finish(state.outputExceeded ? "output-limit" : "query-failure");
        });
        child.stdin.on("error", () => {
            // Git 可能在读取全部输入前退出；最终分类统一由 error/close 事件完成。
        });
        child.once("error", (error) => finish(spawnFailure(state, error)));
        child.once("close", (code) => finish(closeOutcome(state, spec, output, code)));
        if (signal !== undefined) {
            if (signal.aborted)
                onAbort();
            else
                signal.addEventListener("abort", onAbort, { once: true });
        }
        try {
            child.stdin.end(spec.input ?? Buffer.alloc(0));
        }
        catch {
            terminate();
            finish("query-failure");
        }
    });
}
/** 执行一个封闭的只读查询。调用方负责先确认 `repositoryRoot` 是它有权读取的根。 */
export function runGitReadOnly(query, signal) {
    let spec;
    try {
        spec = specOf(query);
    }
    catch (error) {
        return Promise.reject(error);
    }
    return runProcess(query.repositoryRoot, spec, signal);
}
