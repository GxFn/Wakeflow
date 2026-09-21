import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { types } from "node:util";
import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "../filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../filesystem/rooted-directory.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { decodeUtf8, Utf8Error } from "../text/utf8.js";
/**
 * Wakeflow Foundation / Git：根作用域 Git ignore 语义观察。
 *
 * 本模块把一组 `PortableResourcePath` 交给 Git 自身的 `check-ignore` 机器协议，
 * 返回最终命中模式及 Git 判定。它固定只读参数、清除可重定向仓库或配置的 `GIT_*`
 * 环境变量，并限制路径数量、输入、输出和执行时间。
 *
 * 本能力不解释哪个 ignore 来源属于业务权威，也不生成 Wakeflow 规则、读取 managed
 * envelope、修改 `.gitignore` 或执行任意 Git 命令。未来 repository、worktree 与 status
 * 观察应继续作为 `foundation/git` 下的独立能力；只有出现第二个真实进程协议消费者后，
 * 才从具体能力中提取共享 runner，避免形成可执行任意 argv 的通用 `GitClient`。
 */
const GIT_IGNORE_OBSERVATION_LIMITS = Object.freeze({
    maximumProbePaths: 512,
    maximumInputBytes: 256 * 1024,
    maximumOutputBytes: 1024 * 1024,
    maximumOutputChunks: 2048,
    timeoutMilliseconds: 5_000,
});
const ERROR_MESSAGES = {
    input: "Git ignore observation input is invalid.",
    "root-scope": "Git ignore observation could not establish its rooted scope.",
    "git-unavailable": "Git ignore observation could not start Git.",
    "query-failure": "Git ignore observation query failed.",
    timeout: "Git ignore observation exceeded its execution deadline.",
    "output-limit": "Git ignore observation exceeded its output budget.",
    protocol: "Git ignore observation returned an invalid machine record.",
    aborted: "Git ignore observation was aborted.",
};
/** Git ignore 观察失败的稳定、脱敏错误。 */
export class GitIgnoreObservationError extends Error {
    name = "GitIgnoreObservationError";
    code = "wakeflow-git-ignore-observation";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new GitIgnoreObservationError(reason, path);
}
function assertRoot(value, path) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", path);
    }
}
function isAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
}
function parseOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    const keys = Object.keys(record);
    if (keys.some((key) => key !== "signal")
        || (record.signal !== undefined && !isAbortSignal(record.signal))) {
        fail("input", "$options");
    }
    return Object.freeze({
        signal: record.signal,
    });
}
function parseProbePaths(value) {
    let members;
    try {
        members = parseDenseArray(value, GIT_IGNORE_OBSERVATION_LIMITS.maximumProbePaths, "$probePaths");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$probePaths");
        throw error;
    }
    if (members.length === 0)
        fail("input", "$probePaths");
    const seen = new Set();
    const paths = [];
    let inputBytes = 0;
    for (const [index, member] of members.entries()) {
        let path;
        try {
            path = parsePortableResourcePath(member, `$probePaths/${index}`);
        }
        catch (error) {
            if (error instanceof PortableResourcePathError) {
                fail("input", `$probePaths/${index}`);
            }
            throw error;
        }
        if (seen.has(path))
            fail("input", `$probePaths/${index}`);
        seen.add(path);
        inputBytes += Buffer.byteLength(path, "utf8") + 1;
        if (inputBytes > GIT_IGNORE_OBSERVATION_LIMITS.maximumInputBytes) {
            fail("input", "$probePaths");
        }
        paths.push(path);
    }
    return Object.freeze(paths);
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$options.signal");
}
async function assertRootCurrent(root, path) {
    try {
        await root.assertCurrent(path);
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            fail("root-scope", path);
        throw error;
    }
}
function nullDevicePath() {
    return process.platform === "win32" ? "NUL" : "/dev/null";
}
/**
 * Git 可以通过环境变量重定向 repository、worktree、配置和标准流。只继承非 Git
 * 环境，并显式关闭系统/全局配置、交互提示和可选锁，使只读观察保持可预测。
 */
function gitObservationEnvironment() {
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
    return Object.freeze(environment);
}
function queryArguments(repositoryRoot, workTreeRoot) {
    return Object.freeze([
        "-C",
        repositoryRoot.absolutePath,
        `--work-tree=${workTreeRoot.absolutePath}`,
        "--no-pager",
        "--no-optional-locks",
        "-c",
        `core.excludesFile=${nullDevicePath()}`,
        "-c",
        `core.worktree=${workTreeRoot.absolutePath}`,
        "-c",
        "core.bare=false",
        "check-ignore",
        "--no-index",
        "--verbose",
        "--non-matching",
        "--stdin",
        "-z",
    ]);
}
function runGitCheckIgnore(repositoryRoot, workTreeRoot, probePaths, signal) {
    let input;
    try {
        input = Buffer.from(`${probePaths.join("\u0000")}\u0000`, "utf8");
    }
    catch {
        return Promise.reject(new GitIgnoreObservationError("query-failure", "$git"));
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        let aborted = false;
        let timedOut = false;
        let outputExceeded = false;
        let outputByteCount = 0;
        let timer;
        const outputChunks = [];
        const child = spawn("git", queryArguments(repositoryRoot, workTreeRoot), {
            cwd: repositoryRoot.absolutePath,
            env: gitObservationEnvironment(),
            shell: false,
            stdio: ["pipe", "pipe", "ignore"],
            windowsHide: true,
        });
        const finish = (operation) => {
            if (settled)
                return;
            settled = true;
            if (timer !== undefined)
                clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            operation();
        };
        const terminate = () => {
            try {
                child.kill("SIGKILL");
            }
            catch {
                // 最终失败分类由 error/close 事件给出，不暴露平台 kill 细节。
            }
        };
        const onAbort = () => {
            aborted = true;
            terminate();
        };
        child.stdout.on("data", (chunk) => {
            outputByteCount += chunk.byteLength;
            if (outputByteCount
                > GIT_IGNORE_OBSERVATION_LIMITS.maximumOutputBytes
                || outputChunks.length
                    >= GIT_IGNORE_OBSERVATION_LIMITS.maximumOutputChunks) {
                outputExceeded = true;
                terminate();
                return;
            }
            outputChunks.push(chunk);
        });
        child.stdout.once("error", () => {
            terminate();
            finish(() => reject(new GitIgnoreObservationError(outputExceeded ? "output-limit" : "query-failure", outputExceeded ? "$git.stdout" : "$git")));
        });
        child.stdin.on("error", () => {
            // Git 可能在读取全部输入前退出；最终分类统一由 error/close 事件完成。
        });
        child.once("error", (error) => {
            const reason = aborted
                ? "aborted"
                : timedOut
                    ? "timeout"
                    : outputExceeded
                        ? "output-limit"
                        : readNodeSystemErrorCode(error) === "ENOENT"
                            ? "git-unavailable"
                            : "query-failure";
            finish(() => reject(new GitIgnoreObservationError(reason, reason === "aborted"
                ? "$options.signal"
                : reason === "output-limit"
                    ? "$git.stdout"
                    : "$git")));
        });
        child.once("close", (code) => {
            finish(() => {
                if (aborted) {
                    reject(new GitIgnoreObservationError("aborted", "$options.signal"));
                    return;
                }
                if (timedOut) {
                    reject(new GitIgnoreObservationError("timeout", "$git"));
                    return;
                }
                if (outputExceeded) {
                    reject(new GitIgnoreObservationError("output-limit", "$git.stdout"));
                    return;
                }
                if (code !== 0 && code !== 1) {
                    reject(new GitIgnoreObservationError("query-failure", "$git"));
                    return;
                }
                let stdout;
                try {
                    stdout = Buffer.concat(outputChunks, outputByteCount);
                }
                catch {
                    reject(new GitIgnoreObservationError("output-limit", "$git.stdout"));
                    return;
                }
                resolve(Object.freeze({ exitCode: code, stdout }));
            });
        });
        timer = setTimeout(() => {
            timedOut = true;
            terminate();
        }, GIT_IGNORE_OBSERVATION_LIMITS.timeoutMilliseconds);
        if (signal !== undefined) {
            if (signal.aborted)
                onAbort();
            else
                signal.addEventListener("abort", onAbort, { once: true });
        }
        try {
            child.stdin.end(input);
        }
        catch {
            terminate();
            finish(() => reject(new GitIgnoreObservationError("query-failure", "$git")));
        }
    });
}
function parseOutput(result, probePaths) {
    let output;
    try {
        output = decodeUtf8(result.stdout, "$git.stdout");
    }
    catch (error) {
        if (error instanceof Utf8Error)
            fail("protocol", "$git.stdout");
        throw error;
    }
    const fields = output.split("\u0000");
    if (fields.length !== (probePaths.length * 4) + 1
        || fields.at(-1) !== "") {
        fail("protocol", "$git.stdout");
    }
    const paths = [];
    for (const [index, expectedPath] of probePaths.entries()) {
        const offset = index * 4;
        const source = fields[offset];
        const line = fields[offset + 1];
        const pattern = fields[offset + 2];
        const pathname = fields[offset + 3];
        if (source === undefined
            || line === undefined
            || pattern === undefined
            || pathname !== expectedPath) {
            fail("protocol", "$git.stdout");
        }
        if (source === "" && line === "" && pattern === "") {
            paths.push(Object.freeze({
                path: expectedPath,
                ignored: false,
                decision: null,
            }));
            continue;
        }
        if (source.length === 0
            || pattern.length === 0
            || !/^[1-9][0-9]*$/u.test(line)) {
            fail("protocol", "$git.stdout");
        }
        const lineNumber = Number(line);
        if (!Number.isSafeInteger(lineNumber))
            fail("protocol", "$git.stdout");
        const negated = pattern.startsWith("!");
        paths.push(Object.freeze({
            path: expectedPath,
            ignored: !negated,
            decision: Object.freeze({
                source,
                lineNumber,
                pattern,
                negated,
            }),
        }));
    }
    const anyIgnored = paths.some((entry) => entry.ignored);
    if ((result.exitCode === 0) !== anyIgnored) {
        fail("protocol", "$git.stdout");
    }
    return Object.freeze({
        paths: Object.freeze(paths),
    });
}
/**
 * 以一次批量、只读 Git 调用观察全部路径，并返回与输入顺序一一对应的最终模式判定。
 */
export async function observeGitIgnorePaths(rootValue, probePathValues, optionsValue) {
    return observeGitIgnorePathsInWorkTreeInternal(rootValue, rootValue, probePathValues, optionsValue, "$root", "$root");
}
async function observeGitIgnorePathsInWorkTreeInternal(repositoryRootValue, workTreeRootValue, probePathValues, optionsValue, repositoryRootPath, workTreeRootPath) {
    assertRoot(repositoryRootValue, repositoryRootPath);
    assertRoot(workTreeRootValue, workTreeRootPath);
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const probePaths = parseProbePaths(probePathValues);
    await assertRootCurrent(repositoryRootValue, repositoryRootPath);
    if (workTreeRootValue !== repositoryRootValue) {
        await assertRootCurrent(workTreeRootValue, workTreeRootPath);
    }
    assertNotAborted(options.signal);
    const result = await runGitCheckIgnore(repositoryRootValue, workTreeRootValue, probePaths, options.signal);
    await assertRootCurrent(repositoryRootValue, repositoryRootPath);
    if (workTreeRootValue !== repositoryRootValue) {
        await assertRootCurrent(workTreeRootValue, workTreeRootPath);
    }
    assertNotAborted(options.signal);
    return parseOutput(result, probePaths);
}
/**
 * 使用 repositoryRoot 发现 Git 元数据，但在独立 workTreeRoot 中解释 ignore 文件。
 *
 * 该入口仍只执行 `check-ignore --no-index`。它用于验证尚未发布的 worktree 候选，
 * 不会把 workTreeRoot 注册为 Git worktree，也不读取或修改 index。
 */
export async function observeGitIgnorePathsInWorkTree(repositoryRootValue, workTreeRootValue, probePathValues, optionsValue) {
    return observeGitIgnorePathsInWorkTreeInternal(repositoryRootValue, workTreeRootValue, probePathValues, optionsValue, "$repositoryRoot", "$workTreeRoot");
}
