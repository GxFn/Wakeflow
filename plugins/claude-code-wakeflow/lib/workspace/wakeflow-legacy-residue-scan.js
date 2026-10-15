import nodePath from "node:path";
import { AbsoluteNodeObservationError, listAbsoluteDirectoryEntryNames, observeAbsoluteNode, readAbsoluteRegularFileText, } from "../foundation/filesystem/absolute-node-observation.js";
/**
 * Wakeflow Workspace：旧 JavaScript 插件留下内容的只读扫描（ADR-0008 决定 1、ADR-0020，open-items F4，§13.168）。
 *
 * 旧插件在工作区根、产品仓库与支撑面里写过四类东西，当前实现从不识别：指令文件里的
 * `<!-- wakeflow:scope:start -->` 块（指向已不存在或换义的文件）、`.claude/settings.json` 里的宽泛
 * Bash 允许规则与 `additionalDirectories: [".."]`、旧根标记（`workspace.config.json`、
 * `.workspace-active`、`.wakeflow-publish`、`.wakeflow-stage*`、`.wakeflow-maintenance-*`、
 * `.wakeflow-create-stage-*`）与各仓库旁边的 `wakeflow-ledger/` 目录。本模块只读：按根报告发现，给出
 * 相对路径与行号，让用户自己删；绝不写任何根。读不出的文件只计数，不当作"没有"。
 */
export const WAKEFLOW_LEGACY_SCOPE_MARKER = "<!-- wakeflow:scope:start -->";
export const WAKEFLOW_LEGACY_INSTRUCTION_FILE_NAMES = Object.freeze([
    "CLAUDE.md",
    "AGENTS.md",
]);
export const WAKEFLOW_LEGACY_SETTINGS_FILE_PATHS = Object.freeze([
    ".claude/settings.json",
    ".claude/settings.local.json",
]);
/** 旧插件写进产品仓库设置的三条宽泛规则；Claude 宿主的设置转换以此拒绝（`legacy-broad-permission-present`）。 */
export const WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES = Object.freeze([
    "Bash(node *)",
    "Bash(tmux *)",
    "Bash(git *)",
]);
export const WAKEFLOW_LEGACY_ADDITIONAL_DIRECTORY = "..";
export const WAKEFLOW_LEGACY_ROOT_MARKER_NAMES = Object.freeze([
    "workspace.config.json",
    ".workspace-active",
    ".wakeflow-publish",
]);
export const WAKEFLOW_LEGACY_ROOT_MARKER_PREFIXES = Object.freeze([
    ".wakeflow-stage",
    ".wakeflow-maintenance-",
    ".wakeflow-create-stage-",
]);
export const WAKEFLOW_LEGACY_LEDGER_DIRECTORY_NAME = "wakeflow-ledger";
export const WAKEFLOW_LEGACY_RESIDUE_MAXIMUM_ITEMS = 64;
const TEXT_MAXIMUM_BYTES = 1024 * 1024;
const DIRECTORY_MAXIMUM_ENTRIES = 4096;
function push(collector, item) {
    if (collector.items.length >= WAKEFLOW_LEGACY_RESIDUE_MAXIMUM_ITEMS) {
        collector.omitted += 1;
        return;
    }
    collector.items.push(Object.freeze(item));
}
function lineOf(text, needle) {
    const index = text.indexOf(needle);
    if (index === -1)
        return null;
    return text.slice(0, index).split("\n").length;
}
async function readText(collector, absolutePath) {
    try {
        return await readAbsoluteRegularFileText(absolutePath, TEXT_MAXIMUM_BYTES, "$residue");
    }
    catch (error) {
        if (error instanceof AbsoluteNodeObservationError) {
            collector.unreadable += 1;
            return null;
        }
        throw error;
    }
}
async function scanInstructionFiles(collector, root) {
    for (const name of WAKEFLOW_LEGACY_INSTRUCTION_FILE_NAMES) {
        const text = await readText(collector, nodePath.join(root.absolutePath, name));
        if (text === null)
            continue;
        const line = lineOf(text, WAKEFLOW_LEGACY_SCOPE_MARKER);
        if (line === null)
            continue;
        push(collector, {
            root: root.key,
            kind: "scope-block",
            path: name,
            line,
            detail: WAKEFLOW_LEGACY_SCOPE_MARKER,
        });
    }
}
function stringArray(value) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string")
        ? value
        : null;
}
async function scanSettingsFiles(collector, root) {
    for (const relative of WAKEFLOW_LEGACY_SETTINGS_FILE_PATHS) {
        const text = await readText(collector, nodePath.join(root.absolutePath, ...relative.split("/")));
        if (text === null)
            continue;
        let document;
        try {
            document = JSON.parse(text);
        }
        catch {
            collector.unreadable += 1;
            continue;
        }
        if (typeof document !== "object" || document === null || Array.isArray(document))
            continue;
        const permissions = document.permissions;
        if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions))
            continue;
        const allow = stringArray(permissions.allow) ?? [];
        for (const rule of WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES) {
            if (!allow.includes(rule))
                continue;
            push(collector, {
                root: root.key,
                kind: "broad-permission",
                path: relative,
                line: lineOf(text, JSON.stringify(rule)),
                detail: rule,
            });
        }
        const additional = stringArray(permissions.additionalDirectories) ?? [];
        if (additional.includes(WAKEFLOW_LEGACY_ADDITIONAL_DIRECTORY)) {
            push(collector, {
                root: root.key,
                kind: "additional-directories",
                path: relative,
                line: lineOf(text, "additionalDirectories"),
                detail: WAKEFLOW_LEGACY_ADDITIONAL_DIRECTORY,
            });
        }
    }
}
async function scanRootMarkers(collector, root) {
    let listing;
    try {
        listing = await listAbsoluteDirectoryEntryNames(root.absolutePath, DIRECTORY_MAXIMUM_ENTRIES, "$residue");
    }
    catch (error) {
        if (error instanceof AbsoluteNodeObservationError) {
            collector.unreadable += 1;
            return;
        }
        throw error;
    }
    if (listing === null) {
        collector.unreadable += 1;
        return;
    }
    for (const name of listing.names) {
        const exact = WAKEFLOW_LEGACY_ROOT_MARKER_NAMES.includes(name);
        const prefixed = WAKEFLOW_LEGACY_ROOT_MARKER_PREFIXES.some((prefix) => name.startsWith(prefix));
        if (!exact && !prefixed)
            continue;
        push(collector, { root: root.key, kind: "root-marker", path: name, line: null, detail: null });
    }
    if (listing.truncated > 0)
        collector.unreadable += 1;
}
async function scanLedgerSibling(collector, root) {
    const sibling = nodePath.join(nodePath.dirname(root.absolutePath), WAKEFLOW_LEGACY_LEDGER_DIRECTORY_NAME);
    if (collector.seenAbsolute.has(sibling))
        return;
    collector.seenAbsolute.add(sibling);
    try {
        const observed = await observeAbsoluteNode(sibling, { follow: false, errorPath: "$residue" });
        if (observed.state === "present" && observed.node.kind === "directory") {
            push(collector, {
                root: root.key,
                kind: "ledger-directory",
                path: `../${WAKEFLOW_LEGACY_LEDGER_DIRECTORY_NAME}`,
                line: null,
                detail: null,
            });
        }
    }
    catch (error) {
        if (error instanceof AbsoluteNodeObservationError) {
            collector.unreadable += 1;
            return;
        }
        throw error;
    }
}
/** 只读扫描给定根：按根的给定顺序、根内按指令文件、设置文件、根标记、旁边 ledger 的顺序报告。 */
export async function scanWakeflowLegacyResidue(roots) {
    const collector = { items: [], omitted: 0, unreadable: 0, seenAbsolute: new Set() };
    for (const root of roots) {
        await scanInstructionFiles(collector, root);
        await scanSettingsFiles(collector, root);
        await scanRootMarkers(collector, root);
        await scanLedgerSibling(collector, root);
    }
    return Object.freeze({
        items: Object.freeze(collector.items),
        omitted: collector.omitted,
        unreadable: collector.unreadable,
    });
}
