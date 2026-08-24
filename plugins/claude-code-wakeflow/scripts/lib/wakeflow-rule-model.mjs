import { createHash } from "node:crypto";
import path from "node:path";

import { assertWakeflowId } from "./wakeflow-identifiers.mjs";

// 本模块只把已经由配置、layout 与 owner 选定的稳定事实渲染为三类 v3 memory 语义字节。
// managed marker、文件归属、物理写入和宿主运行时事实分别由 managed-content/support owner 与宿主接缝负责。

export class WakeflowRuleModelError extends Error {
  constructor(code, message, { path = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowRuleModelError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

function list(lines) {
  return lines.filter(Boolean).map((line) => `- ${line}`).join("\n");
}

function candidateFail(code, at, message, details = {}) {
  throw new WakeflowRuleModelError(code, `${message} at ${at}`, { path: at, details });
}

function exactObject(value, at, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    candidateFail("wakeflow-rule-model-type", at, "expected a plain object");
  }
  const allowedSet = new Set(allowed);
  const snapshot = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedSet.has(key)) {
      const display = typeof key === "string" ? key : "<symbol>";
      candidateFail("wakeflow-rule-model-unknown", `${at}/${display}`, `unknown field ${display}`, { allowed });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      candidateFail(
        "wakeflow-rule-model-type",
        `${at}/${key}`,
        `field ${key} must be an enumerable data property`,
      );
    }
    snapshot[key] = descriptor.value;
  }
  for (const key of required) {
    if (!Object.hasOwn(snapshot, key)) {
      candidateFail("wakeflow-rule-model-missing", `${at}/${key}`, `missing required field ${key}`);
    }
  }
  return Object.freeze(snapshot);
}

// windows 是跨 owner 传入的纯数据集合；自定义原型、附加字段、稀疏槽和 accessor 都不能参与渲染。
function exactDenseArray(value, at, { minimum = 0, code = "wakeflow-rule-model-type" } = {}) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum) {
    candidateFail(code, at, `expected a standard array with at least ${minimum} item(s)`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(key)
      || Number(key) >= value.length
    ) {
      candidateFail(code, at, "array cannot carry additional properties");
    }
  }
  const snapshot = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      candidateFail(code, `${at}/${index}`, "array items must be dense enumerable data properties");
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function candidateString(value, at) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\r\n\0]/u.test(value)) {
    candidateFail("wakeflow-rule-model-type", at, "expected a non-empty single-line string without outer whitespace");
  }
  return value;
}

// 可展示文本只保留可见语义，不允许配置字段创建 Markdown link、HTML 或新的格式边界。
function markdownText(value) {
  const escaped = new Set(["\\", "`", "*", "_", "{", "}", "[", "]", "(", ")", "#", "+", "-", ".", "!", "|"]);
  let output = "";
  for (const character of value) {
    if (character === "&") output += "&amp;";
    else if (character === "<") output += "&lt;";
    else if (character === ">") output += "&gt;";
    else output += escaped.has(character) ? `\\${character}` : character;
  }
  return output;
}

// portable path 仍可能合法含有反引号；按最长连续反引号选择 fence，避免路径逃出 inline-code context。
function inlineCode(value) {
  let longest = 0;
  let current = 0;
  for (const character of value) {
    if (character === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  const fence = "`".repeat(longest + 1);
  const padding = longest > 0 ? " " : "";
  return `${fence}${padding}${value}${padding}${fence}`;
}

function portablePath(value, at, { nullable = false, component = false } = {}) {
  if (nullable && value === null) return null;
  const candidate = candidateString(value, at);
  if (
    candidate.includes("\\")
    || path.posix.isAbsolute(candidate)
    || /^[A-Za-z]:\//u.test(candidate)
    || path.posix.normalize(candidate) !== candidate
    || candidate === "."
    || (component && (candidate === ".." || path.posix.basename(candidate) !== candidate))
  ) {
    candidateFail("wakeflow-rule-model-path", at, "expected a canonical portable relative path", { value: candidate });
  }
  return candidate;
}

function rawContentDigest(content) {
  return `sha256:${createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex")}`;
}

function deepFreeze(value) {
  // 只接收本模块刚构造的结果树；外部输入在进入该阶段前已经由 descriptor-first gate 快照化。
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function candidateHost(value, at = "$/host") {
  const host = exactObject(value, at, ["hostId", "hostName", "memoryFile"]);
  const hostId = candidateString(host.hostId, `${at}/hostId`);
  if (hostId !== "codex" && hostId !== "claude-code") {
    candidateFail("wakeflow-rule-model-host", `${at}/hostId`, "unknown Wakeflow host", { value: hostId });
  }
  return {
    hostId,
    hostName: markdownText(candidateString(host.hostName, `${at}/hostName`)),
    memoryFile: portablePath(host.memoryFile, `${at}/memoryFile`, { component: true }),
  };
}

function candidateMemoryPaths(value, names, at = "$/paths") {
  const paths = exactObject(value, at, names);
  return Object.fromEntries(names.map((name) => [
    name,
    portablePath(paths[name], `${at}/${name}`),
  ]));
}

function candidateOptionalString(value, at) {
  return value === undefined ? null : markdownText(candidateString(value, at));
}

/**
 * 生成当前宿主 program-root memory component 的 v3 语义字节与内容摘要。
 * managed-content owner 负责机器所有权 envelope 和物理写入；本方法不读取文件系统。
 */
export function renderProgramMemoryCandidate(value) {
  const input = exactObject(value, "$", ["program", "controllerWindowId", "host", "paths"]);
  const program = exactObject(
    input.program,
    "$/program",
    ["programId", "displayName", "description", "interfaceLanguage"],
    ["programId", "displayName", "interfaceLanguage"],
  );
  const programId = assertWakeflowId(program.programId, "program", "$/program/programId");
  const controllerWindowId = assertWakeflowId(input.controllerWindowId, "window", "$/controllerWindowId");
  const displayName = markdownText(candidateString(program.displayName, "$/program/displayName"));
  const description = candidateOptionalString(program.description, "$/program/description");
  const interfaceLanguage = candidateString(program.interfaceLanguage, "$/program/interfaceLanguage");
  if (!new Set(["auto", "en", "zh"]).has(interfaceLanguage)) {
    candidateFail(
      "wakeflow-rule-model-language",
      "$/program/interfaceLanguage",
      "interfaceLanguage must be auto, en, or zh",
      { value: interfaceLanguage },
    );
  }
  const host = candidateHost(input.host);
  const paths = candidateMemoryPaths(input.paths, [
    "config",
    "activeIndex",
    "activeStatus",
    "activeCurrent",
    "localRoot",
    "ledgerRecordMap",
  ]);
  const content = `${[
    "## Wakeflow Program Contract",
    `> Generated for ${host.hostName}. Wakeflow owns only the enclosing managed component in ${inlineCode(host.memoryFile)}; surrounding owner text remains outside this contract.`,
    "### Stable identity",
    list([
      `Program: ${inlineCode(programId)} (${displayName})`,
      description === null ? null : `Program description: ${description}`,
      `Controller window: ${inlineCode(controllerWindowId)}`,
      `Host protocol: ${inlineCode(host.hostId)}`,
    ]),
    "### First read and authority",
    list([
      `All paths below are relative to the program root. Read ${inlineCode(paths.config)}, ${inlineCode(paths.activeIndex)}, and ${inlineCode(paths.activeStatus)} before acting.`,
      `For active work, continue only to the exact demand state, card, and task package selected beneath ${inlineCode(paths.activeCurrent)}; do not infer work from filenames or empty directories.`,
      `Durable history starts at ${inlineCode(paths.ledgerRecordMap)}. Rendered Markdown is navigation and status, not a replacement for typed authority.`,
      "Use Wakeflow capabilities for every state, delivery, evidence, Pod, identity, and retention transition. Do not hand-edit their files.",
    ]),
    "### Local runtime and offline boundary",
    list([
      `${inlineCode(paths.localRoot)} contains machine-local identity, transport, coordination, host evidence, operations, and audit material. Never commit, move, edit, or delete it by hand.`,
      "If the Wakeflow plugin surface is unavailable, use these files only for read-only orientation and report the plugin-surface blocker; do not reconstruct backend commands or mutate authority manually.",
      "Live binding, sendability, lease, Pod, process, and host health come from Wakeflow status/verify after the plugin is restored, not from this static memory.",
    ]),
    "### Responsibility and safety",
    list([
      "The Controller owns cross-repository sequencing and final acceptance; product implementation remains with the exact repository/window assignment in the current packet.",
      "Do not reset, revert, delete user work, rewrite history, expose secrets, or mutate unrelated repositories.",
      "Commit, push, tag, publish, release, cache refresh, destructive cleanup, and scope expansion each require their own explicit authorization.",
    ]),
  ].filter(Boolean).join("\n\n")}\n`;
  return deepFreeze({
    kind: "WakeflowProgramMemory",
    schemaVersion: 1,
    programId,
    controllerWindowId,
    hostId: host.hostId,
    content,
    sha256: rawContentDigest(content),
  });
}

/**
 * 生成一个 repository 级共享访问卡；同仓库的 durable Product 窗口只在同一 block 内建立索引。
 * 本方法不生成逐窗口文件，也不把当前 binding、handle 或宿主存活事实写入静态 memory。
 */
export function renderRepositoryMemoryCandidate(value) {
  const input = exactObject(value, "$", ["programId", "repository", "windows", "host", "paths"]);
  const programId = assertWakeflowId(input.programId, "program", "$/programId");
  const repository = exactObject(
    input.repository,
    "$/repository",
    ["repositoryId", "path", "displayName", "description", "instructionManagement", "validation"],
    ["repositoryId", "path", "displayName", "instructionManagement"],
  );
  const repositoryId = assertWakeflowId(repository.repositoryId, "repository", "$/repository/repositoryId");
  portablePath(repository.path, "$/repository/path");
  const repositoryName = markdownText(candidateString(repository.displayName, "$/repository/displayName"));
  const repositoryDescription = candidateOptionalString(repository.description, "$/repository/description");
  if (repository.instructionManagement !== "managed-block") {
    candidateFail(
      "wakeflow-rule-model-ownership",
      "$/repository/instructionManagement",
      "repository memory requires managed-block instruction ownership",
      { value: repository.instructionManagement },
    );
  }
  const windowCandidates = exactDenseArray(input.windows, "$/windows", {
    minimum: 1,
    code: "wakeflow-rule-model-window",
  });
  const windows = windowCandidates.map((candidate, index) => {
    const at = `$/windows/${index}`;
    const window = exactObject(
      candidate,
      at,
      ["windowId", "role", "displayName", "description", "root"],
      ["windowId", "role", "displayName", "root"],
    );
    const root = exactObject(window.root, `${at}/root`, ["kind", "repositoryId"]);
    const windowId = assertWakeflowId(window.windowId, "window", `${at}/windowId`);
    if (window.role !== "product" || root.kind !== "repository" || root.repositoryId !== repositoryId) {
      candidateFail(
        "wakeflow-rule-model-window",
        at,
        "repository memory windows must be product windows for the exact repository",
        { repositoryId, windowId },
      );
    }
    return {
      windowId,
      displayName: markdownText(candidateString(window.displayName, `${at}/displayName`)),
      description: candidateOptionalString(window.description, `${at}/description`),
    };
  }).sort((left, right) => left.windowId < right.windowId ? -1 : left.windowId > right.windowId ? 1 : 0);
  if (new Set(windows.map((entry) => entry.windowId)).size !== windows.length) {
    candidateFail("wakeflow-rule-model-window", "$/windows", "repository memory windows must be unique");
  }
  const host = candidateHost(input.host);
  const paths = candidateMemoryPaths(input.paths, [
    "programMemory",
    "activeIndex",
    "activeStatus",
    "localRoot",
    "ledgerRecordMap",
  ]);
  const responsibilityIndex = windows.map((window) => (
    `- ${inlineCode(window.windowId)} — ${window.displayName}${window.description === null ? "" : `: ${window.description}`}`
  )).join("\n");
  const content = `${[
    "## Wakeflow Repository Contract",
    `> Generated for ${host.hostName}. Wakeflow owns only the enclosing managed component in ${inlineCode(host.memoryFile)}; the repository owner owns all surrounding bytes.`,
    "### Repository boundary",
    list([
      `Program: ${inlineCode(programId)}`,
      `Repository: ${inlineCode(repositoryId)} (${repositoryName})`,
      repositoryDescription === null ? null : `Repository responsibility: ${repositoryDescription}`,
      "This repository owns its product source, local engineering rules, physical health, validation, and dirty-worktree decisions. Wakeflow does not grant parallel write authority merely because several windows reference it.",
    ]),
    "### Durable responsibility windows",
    `${responsibilityIndex}\n\nThese are alternative durable responsibility entries for one repository, not parallel execution lanes. Current authority comes only from the exact host binding and packet assignment.`,
    "### Exact assignment rule",
    list([
      `Act only when the entry identity and current packet agree on ${inlineCode(programId)}, ${inlineCode(repositoryId)}, one listed ${inlineCode("windowId")}, and the exact target task.`,
      "Without an exact packet, perform identity alignment only and wait. Never consume another window's task merely because it shares this checkout.",
      "The task package owns the current scope, exclusions, forbidden actions, acceptance, and validation. Window descriptions and this static card cannot expand it.",
    ]),
    "### Program-root-relative coordinates",
    list([
      `Program memory: ${inlineCode(paths.programMemory)}`,
      `Active index/status: ${inlineCode(paths.activeIndex)} and ${inlineCode(paths.activeStatus)}`,
      `Durable record map: ${inlineCode(paths.ledgerRecordMap)}`,
      `Machine-local runtime boundary: ${inlineCode(paths.localRoot)} — never hand-edit, commit, move, or delete it.`,
    ]),
    "### Safety boundary",
    list([
      "Do not reset, revert, delete user work, rewrite history, expose secrets, or mutate unrelated repositories.",
      "Commit, push, tag, publish, release, cache refresh, destructive cleanup, and scope expansion each require their own explicit authorization.",
      "Stop and return the contradiction when identity, authority, ownership, paths, or the packet is missing, stale, or inconsistent.",
    ]),
  ].filter(Boolean).join("\n\n")}\n`;
  return deepFreeze({
    kind: "WakeflowRepositoryMemory",
    schemaVersion: 1,
    programId,
    repositoryId,
    hostId: host.hostId,
    windowIds: windows.map((entry) => entry.windowId),
    content,
    sha256: rawContentDigest(content),
  });
}

/**
 * 为稳定 Design/Test 角色生成 v3 memory 语义字节。
 * 调用方必须提供已经验证的 identity 与 program-root-relative 路径；本方法没有旧版默认值，也不写文件。
 */
export function renderSupportRoleMemoryCandidate(value) {
  const input = exactObject(value, "$", [
    "programId",
    "surfaceId",
    "windowId",
    "role",
    "surfaceOwnership",
    "instructionManagement",
    "host",
    "paths",
  ]);
  const role = candidateString(input.role, "$/role");
  if (role !== "design" && role !== "test") {
    candidateFail("wakeflow-rule-model-role", "$/role", "role must be design or test", { value: role });
  }
  const surfaceOwnership = candidateString(input.surfaceOwnership, "$/surfaceOwnership");
  if (surfaceOwnership !== "wakeflow-managed" && surfaceOwnership !== "external-owned") {
    candidateFail(
      "wakeflow-rule-model-ownership",
      "$/surfaceOwnership",
      "surfaceOwnership must be wakeflow-managed or external-owned",
      { value: surfaceOwnership },
    );
  }
  const instructionManagement = input.instructionManagement;
  if (
    (surfaceOwnership === "wakeflow-managed" && instructionManagement !== null)
    || (surfaceOwnership === "external-owned" && instructionManagement !== "managed-block")
  ) {
    candidateFail(
      "wakeflow-rule-model-ownership",
      "$/instructionManagement",
      "whole-file memory requires null and external memory components require managed-block",
      { surfaceOwnership, instructionManagement },
    );
  }

  const programId = assertWakeflowId(input.programId, "program", "$/programId");
  const surfaceId = assertWakeflowId(input.surfaceId, "surface", "$/surfaceId");
  const windowId = assertWakeflowId(input.windowId, "window", "$/windowId");
  const host = exactObject(input.host, "$/host", ["hostId", "hostName", "memoryFile"]);
  const hostId = candidateString(host.hostId, "$/host/hostId");
  if (hostId !== "codex" && hostId !== "claude-code") {
    candidateFail("wakeflow-rule-model-host", "$/host/hostId", "unknown Wakeflow host", { value: hostId });
  }
  const hostName = markdownText(candidateString(host.hostName, "$/host/hostName"));
  const memoryFile = portablePath(host.memoryFile, "$/host/memoryFile", { component: true });
  const paths = exactObject(input.paths, "$/paths", [
    "supportRoot",
    "memory",
    "programMemory",
    "activeIndex",
    "activeStatus",
    "activeCurrent",
    "requirements",
    "drafts",
    "harnesses",
    "fixtures",
  ]);
  const normalizedPaths = Object.fromEntries(Object.entries(paths).map(([name, candidate]) => [
    name,
    portablePath(candidate, `$/paths/${name}`, {
      nullable: name === "drafts" || name === "harnesses" || name === "fixtures",
    }),
  ]));
  const expectedMemory = path.posix.join(normalizedPaths.supportRoot, memoryFile);
  if (normalizedPaths.memory !== expectedMemory) {
    candidateFail("wakeflow-rule-model-path", "$/paths/memory", "memory path does not match support root and host memory filename", {
      expected: expectedMemory,
      actual: normalizedPaths.memory,
    });
  }
  const internal = surfaceOwnership === "wakeflow-managed";
  const expectedCapabilityPaths = role === "design"
    ? {
        drafts: internal ? path.posix.join(normalizedPaths.supportRoot, "drafts") : null,
        harnesses: null,
        fixtures: null,
      }
    : {
        drafts: null,
        harnesses: internal ? path.posix.join(normalizedPaths.supportRoot, "harnesses") : null,
        fixtures: internal ? path.posix.join(normalizedPaths.supportRoot, "fixtures") : null,
      };
  for (const [name, expected] of Object.entries(expectedCapabilityPaths)) {
    if (normalizedPaths[name] !== expected) {
      candidateFail("wakeflow-rule-model-path", `$/paths/${name}`, `${name} path does not match role ownership`, {
        role,
        surfaceOwnership,
        expected,
        actual: normalizedPaths[name],
      });
    }
  }

  const design = role === "design";
  const roleName = design ? "Design" : "Test";
  const sections = [
    `${internal ? "#" : "##"} Wakeflow ${roleName} Window Contract`,
    `> Generated for ${hostName}. ${internal
      ? `Wakeflow owns this whole ${inlineCode(memoryFile)} file.`
      : `Wakeflow owns only the marked component containing this contract; the external owner owns all surrounding content.`}`,
    "## Stable coordinates",
    list([
      `Program: ${inlineCode(programId)}`,
      `${roleName} surface: ${inlineCode(surfaceId)}`,
      `${roleName} window: ${inlineCode(windowId)}`,
      `Host protocol: ${inlineCode(hostId)}; memory file: ${inlineCode(memoryFile)}`,
      `Support root (relative to the program root): ${inlineCode(normalizedPaths.supportRoot)}`,
    ]),
    "## First read and authority",
    list([
      `Resolve paths from the program root. Read ${inlineCode(normalizedPaths.programMemory)}, ${inlineCode(normalizedPaths.activeIndex)}, and ${inlineCode(normalizedPaths.activeStatus)} before acting.`,
      `For assigned work, read the exact demand, card, and package beneath ${inlineCode(normalizedPaths.activeCurrent)}; durable requirement authority is beneath ${inlineCode(normalizedPaths.requirements)}.`,
      "Controller events and the reduced demand state are authority. Conversation, drafts, local notes, rendered status, and Agent claims are not workflow state.",
      "Use Wakeflow capabilities for transitions and deliveries. Never hand-edit controller state, event history, TODO authority, dispatch records, or TargetResult artifacts.",
    ]),
    `## ${roleName} role and write boundary`,
    list(design
      ? [
          "Clarify objectives, compare bounded options, make scope and non-goals explicit, define acceptance and validation intent, and prepare reviewable requirement material.",
          internal
            ? `Only optional Design drafts belong under ${inlineCode(normalizedPaths.drafts)}; files there remain non-authoritative.`
            : "The external owner controls draft locations and repository conventions. Wakeflow creates no Design scaffold outside this managed component.",
          "Do not implement product code, mutate product repositories, create controller task packages, dispatch work, accept delivery, or decide workflow state.",
        ]
      : [
          "Execute only a frozen Test card/package after controller acceptance of the implementation chain, or a controller-scoped Test-only reproduction or environment diagnostic.",
          "Product source is always read-only. A Test card may authorize bounded operations in the confirmed environment and changes to Test-owned harnesses or fixtures only; it cannot authorize product repair.",
          internal
            ? `Reusable Test-owned helpers belong only under ${inlineCode(normalizedPaths.harnesses)}; reusable non-secret fixtures belong only under ${inlineCode(normalizedPaths.fixtures)}.`
            : "The external owner controls its Test assets and repository conventions. Wakeflow creates no Test scaffold outside this managed component.",
          "Raw logs, credentials, private paths, live handles, and large attachments stay in the authorized execution environment; return only bounded portable evidence refs and digests.",
        ]),
    design ? "## Promotion and delivery" : "## Test execution and return",
    list(design
      ? [
          "A draft never becomes demand authority merely because of its filename or location.",
          "After explicit user or controller confirmation, resolve exact Design/controller window IDs with `wakeflow_view`, inspect the TODO board with `wakeflow_next_work`, then use `wakeflow_deliver` to append one exact 13-column row with the observed `expectedBoardDigest`; never copy drafts into the durable ledger or edit TODO authority by hand.",
          "TODO append validates row shape and board CAS only. It does not promote a draft or freeze demand authority. If the item will need a TaskPackage, the controller must resolve the submitted references and include authority in the initial `wakeflow_create_demand` publication; the current public surface cannot add it later.",
          "Load the installed `wakeflow-design` Skill for method. Its procedure cannot expand authority, write scope, or delivery permission.",
        ]
      : [
          "Use `wakeflow-target` for packet receipt, alignment, execution boundaries, and result protocol. Use installed `wakeflow-test` methods only within the frozen card and package.",
          "The card's `allowedSkills` is the only capability allowance. An empty list means execute the approved steps directly; unknown or unlisted methods, targets, environments, gates, or operations must return blocked.",
          "Map every approved test step exactly once to portable evidence. Review your own evidence for completeness and scope, but do not review product acceptance on the controller's behalf.",
          "Return completion, failure, or blockage only through the assigned strict `TargetResult` (`artifactKind: wakeflow-target-result`); the controller independently decides acceptance, rework, or follow-up.",
        ]),
    "## Safety boundary",
    list([
      "Do not reset, revert, delete user work, rewrite history, expose secrets, or mutate unrelated repositories.",
      "Commit, push, tag, publish, release, cache refresh, destructive cleanup, live-data mutation, and scope expansion require their own explicit authorization in addition to role authority.",
      "Stop and return the contradiction when identity, authority, ownership, paths, or the assigned contract is missing, stale, or inconsistent.",
    ]),
  ];
  const content = `${sections.join("\n\n")}\n`;
  return deepFreeze({
    kind: "WakeflowSupportRoleMemory",
    schemaVersion: 1,
    role,
    content,
    sha256: rawContentDigest(content),
  });
}
