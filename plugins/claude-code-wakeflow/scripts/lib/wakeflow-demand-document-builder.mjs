import { createHash } from "node:crypto";

import { canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import {
  validateDemandCoreStack,
  validateDemandStateRecord,
  WAKEFLOW_DEMAND_AUTHORITY_FILE,
  WAKEFLOW_DEMAND_EVENTS_FILE,
  WAKEFLOW_DEMAND_FILE,
  WAKEFLOW_DEMAND_STATE_FILE,
} from "./wakeflow-demand-core-records.mjs";
import {
  wakeflowDemandCapabilityRoots,
  WAKEFLOW_DEMAND_RECOVERY_ROOT,
} from "./wakeflow-demand-layout.mjs";
import {
  assertParsedWakeflowAssetBundle,
  renderWakeflowAsset,
} from "./wakeflow-template-renderer.mjs";

/**
 * 单需求人类可读投影的纯构建器。
 *
 * 职责导航：
 * 1. 消费已经闭合的demand/authority/state/events stack与已验证模板bundle。
 * 2. 从当前state精确选择仍有效的artifact导航，不扫描目录或猜测orphan文件。
 * 3. 对人类文本和协议引用分别做上下文编码，生成index.md与developer-progress.md。
 * 4. 让source fingerprint绑定完整事件历史、当前state和实际选中的模板版本。
 *
 * 本模块不读取filesystem/config/TODO，不选择界面语言，不写文件，也不授予dispatch或验收权限。
 */

export const WAKEFLOW_DEMAND_DOCUMENT_PROJECTOR_SCHEMA_VERSION = 1;

const INDEX_FILE = "index.md";
const PROGRESS_FILE = "developer-progress.md";
const LANGUAGES = new Set(["en", "zh"]);
const REQUIRED_INPUT_KEYS = Object.freeze([
  "bundle",
  "language",
  "demand",
  "authority",
  "state",
  "events",
]);
const CURRENT_ARTIFACT_GROUPS = Object.freeze([
  Object.freeze({
    artifactKind: "wakeflow-task-package",
    localeKey: "taskPackages",
  }),
  Object.freeze({
    artifactKind: "wakeflow-target-result",
    localeKey: "targetResults",
  }),
  Object.freeze({
    artifactKind: "wakeflow-test-card",
    localeKey: "testCards",
  }),
  Object.freeze({
    artifactKind: "wakeflow-review-candidate",
    localeKey: "reviewCandidate",
  }),
  Object.freeze({
    artifactKind: "wakeflow-evidence",
    localeKey: "evidence",
  }),
]);

const LOCALES = Object.freeze({
  en: Object.freeze({
    indexSuffix: "Demand",
    indexNotice: "Generated navigation only. Linked machine records remain authoritative; capability links describe the staged protocol layout and are not filesystem health claims.",
    sourceLine: "Projection source",
    coreRecords: "Core Records",
    immutableDemand: "immutable demand identity",
    frozenAuthority: "frozen execution authority",
    pendingAuthority: "`demand-authority.json` — not frozen; no authority record is linked",
    currentState: "authoritative current-state snapshot",
    events: "append-only controller transition audit",
    progress: "fully generated human progress projection",
    currentArtifacts: "Current Artifacts",
    currentArtifactNotice: "Only exact portable references selected by the validated current-state snapshot are listed here.",
    artifactGroups: Object.freeze({
      taskPackages: "Active Task Packages",
      targetResults: "Current TargetResults",
      testCards: "Active Test Cards",
      reviewCandidate: "Pending Review Candidate",
      evidence: "State Evidence",
    }),
    capabilityRoots: "Capability Roots",
    capabilityNotice: "These roots are navigation targets established by the demand publication owner. Files appear only through validated domain events and their unique owners.",
    recovery: "Recovery",
    recoveryNotice: "The recovery root contains only incomplete transaction journals and is empty in a healthy demand root.",
    sourceLabels: Object.freeze({
      schema: "Projector schema",
      fingerprint: "Source fingerprint",
      demand: "Demand digest",
      authority: "Authority digest",
      state: "State digest",
      events: "Event-history digest",
      template: "Progress template",
    }),
    none: "none",
    demandLabels: Object.freeze({
      program: "Program ID",
      demand: "Demand ID",
      type: "Demand type",
      created: "Created at",
      source: "Source",
      placement: "Execution placement",
      authorization: "Placement authorization",
    }),
    todoSource: "TODO lineage",
    ledgerSource: "ledger member lineage",
    stateLabels: Object.freeze({
      state: "State",
      revision: "Revision",
      updated: "Updated at",
      event: "Last event",
      reason: "State reason",
    }),
    authorityStatus: "Status",
    notFrozen: "not frozen",
    frozen: "frozen",
    authorityAbsent: "No authority record is linked. This is valid orientation for an un-frozen demand and does not authorize implementation dispatch.",
    entryMode: "Entry mode",
    testMode: "Test mode",
    testSummary: "Test decision",
    environment: "Environment specification",
    authorityRefs: "Authority references",
    eventRevision: "Revision",
    eventId: "Event ID",
    eventTransition: "Transition",
    eventCommand: "Command / type",
    eventCreated: "Created at",
    eventDigest: "Event digest",
    eventReason: "Reason",
    eventDecision: "Decision summary",
    changedArtifacts: "Changed artifacts",
    noChangedArtifacts: "none",
  }),
  zh: Object.freeze({
    indexSuffix: "需求",
    indexNotice: "仅为生成式导航。链接的机器记录仍是权威；能力目录链接描述分阶段发布的协议布局，不代表已完成文件系统健康检查。",
    sourceLine: "投影来源",
    coreRecords: "核心记录",
    immutableDemand: "不可变需求身份",
    frozenAuthority: "冻结的执行授权",
    pendingAuthority: "`demand-authority.json` — 尚未冻结，当前没有授权记录链接",
    currentState: "权威当前状态快照",
    events: "Controller 状态转换追加审计",
    progress: "完全生成的人类进度投影",
    currentArtifacts: "当前制品",
    currentArtifactNotice: "这里只列出经验证的当前状态快照所选择的精确可移植引用。",
    artifactGroups: Object.freeze({
      taskPackages: "活跃任务包",
      targetResults: "当前 TargetResults",
      testCards: "活跃 Test 卡片",
      reviewCandidate: "待决 Review Candidate",
      evidence: "状态证据",
    }),
    capabilityRoots: "能力目录",
    capabilityNotice: "这些目录是需求发布 owner 建立的导航目标；文件只能由通过验证的领域事件及其唯一 owner 生成。",
    recovery: "恢复",
    recoveryNotice: "恢复目录只容纳未完成的事务 journal；健康 demand root 中为空。",
    sourceLabels: Object.freeze({
      schema: "投影器 schema",
      fingerprint: "来源指纹",
      demand: "需求摘要",
      authority: "授权摘要",
      state: "状态摘要",
      events: "完整事件历史摘要",
      template: "进度模板",
    }),
    none: "无",
    demandLabels: Object.freeze({
      program: "程序 ID",
      demand: "需求 ID",
      type: "需求类型",
      created: "创建时间",
      source: "来源",
      placement: "执行位置",
      authorization: "位置授权",
    }),
    todoSource: "TODO 血缘",
    ledgerSource: "台账成员血缘",
    stateLabels: Object.freeze({
      state: "状态",
      revision: "修订号",
      updated: "更新时间",
      event: "末事件",
      reason: "状态原因",
    }),
    authorityStatus: "状态",
    notFrozen: "未冻结",
    frozen: "已冻结",
    authorityAbsent: "当前没有授权记录链接。这是未冻结需求的合法定位状态，但不授权实现派发。",
    entryMode: "进入模式",
    testMode: "测试模式",
    testSummary: "测试决定",
    environment: "环境规范",
    authorityRefs: "授权引用",
    eventRevision: "修订号",
    eventId: "事件 ID",
    eventTransition: "转换",
    eventCommand: "命令 / 类型",
    eventCreated: "创建时间",
    eventDigest: "事件摘要",
    eventReason: "原因",
    eventDecision: "决定摘要",
    changedArtifacts: "变更制品",
    noChangedArtifacts: "无",
  }),
});

export class WakeflowDemandDocumentError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WakeflowDemandDocumentError";
    this.code = code;
    this.path = errorPath;
    this.details = details;
  }
}

function fail(code, errorPath, message, details = {}, cause = undefined) {
  throw new WakeflowDemandDocumentError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
    cause,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function assertInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("wakeflow-demand-document-input", "$", "demand document input must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("wakeflow-demand-document-input", "$", "demand document input must be a plain object");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    fail("wakeflow-demand-document-input-unknown", "$", "symbol-keyed demand document inputs are not allowed");
  }
  const actual = ownKeys;
  const unknown = actual.find((key) => !REQUIRED_INPUT_KEYS.includes(key));
  if (unknown) {
    fail("wakeflow-demand-document-input-unknown", `$/${unknown}`, `unknown demand document input ${unknown}`);
  }
  const missing = REQUIRED_INPUT_KEYS.find((key) => !Object.hasOwn(value, key));
  if (missing) {
    fail("wakeflow-demand-document-input-missing", `$/${missing}`, `missing demand document input ${missing}`);
  }
  const snapshot = {};
  for (const key of REQUIRED_INPUT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) {
      fail("wakeflow-demand-document-input-unknown", `$/${key}`, `non-enumerable demand document input ${key} is not allowed`);
    }
    if (!Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-demand-document-input-accessor", `$/${key}`, `accessor demand document input ${key} is not allowed`);
    }
    snapshot[key] = descriptor.value;
  }
  if (!LANGUAGES.has(snapshot.language)) {
    fail("wakeflow-demand-document-language", "$/language", "language must be the caller-resolved value en or zh");
  }
  try {
    assertParsedWakeflowAssetBundle(snapshot.bundle);
  } catch (cause) {
    fail(
      "wakeflow-demand-document-bundle",
      "$/bundle",
      "bundle must be validated and frozen before entering the pure demand document builder",
      {},
      cause,
    );
  }
  return Object.freeze(snapshot);
}

function sha256Text(content) {
  return `sha256:${createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex")}`;
}

function canonicalMarkdown(content) {
  return `${String(content).replaceAll("\r", "").trimEnd()}\n`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeHeading(value) {
  return escapeHtml(value)
    .replace(/\s+/gu, " ")
    .replace(/([\\`*_[\]()#+.!|])/gu, "\\$1")
    .trim();
}

function safeHumanLine(value) {
  return escapeHtml(value)
    .replace(/([\\`*_[\]()#+.!|:])/gu, "\\$1");
}

function humanBlock(value) {
  return String(value)
    .split("\n")
    .map((line) => `> ${safeHumanLine(line) || " "}`)
    .join("\n");
}

function code(value) {
  return `<code>${escapeHtml(value)}</code>`;
}

function link(label, target) {
  return `[${label}](${target})`;
}

function marker(fingerprint) {
  return `<!-- wakeflow:demand-projection:v${WAKEFLOW_DEMAND_DOCUMENT_PROJECTOR_SCHEMA_VERSION}:${fingerprint} -->`;
}

function refSummary(reference) {
  return [
    `family=${code(reference.family)}`,
    `recordId=${code(reference.recordId)}`,
    `recordRef=${code(reference.recordRef)}`,
    `recordDigest=${code(reference.recordDigest)}`,
    `memberRef=${code(reference.memberRef)}`,
    `memberDigest=${code(reference.memberDigest)}`,
    `role=${code(reference.role)}`,
  ].join("; ");
}

function demandSourceSummary(demand, locale) {
  if (demand.source.artifactKind === "wakeflow-todo-lineage-ref") {
    return `${locale.todoSource}: ${code(demand.source.todoId)} at ${code(demand.source.boardRef)}, row ${code(demand.source.intakeRowDigest)}`;
  }
  return [
    `${locale.ledgerSource}:`,
    ...demand.source.memberRefs.map((reference) => `  - ${refSummary(reference)}`),
  ].join("\n");
}

function placementSummary(demand, locale) {
  if (demand.executionPlacement.mode === "main") return code("main");
  return [
    code("isolated"),
    `  - ${locale.demandLabels.authorization}: ${refSummary(demand.executionPlacement.authorizationRef)}`,
  ].join("\n");
}

function renderSourceSummary(source, locale) {
  return [
    `- ${locale.sourceLabels.schema}: ${code(WAKEFLOW_DEMAND_DOCUMENT_PROJECTOR_SCHEMA_VERSION)}`,
    `- ${locale.sourceLabels.fingerprint}: ${code(source.fingerprint)}`,
    `- ${locale.sourceLabels.demand}: ${code(source.demandDigest)}`,
    `- ${locale.sourceLabels.authority}: ${code(source.authorityDigest ?? locale.none)}`,
    `- ${locale.sourceLabels.state}: ${code(source.stateDigest)}`,
    `- ${locale.sourceLabels.events}: ${code(source.eventHistoryDigest)}`,
    `- ${locale.sourceLabels.template}: ${code(source.progressTemplate.assetId)} — ${code(source.progressTemplate.digest)}`,
  ].join("\n");
}

function renderDemandSummary(demand, locale) {
  return [
    `- ${locale.demandLabels.program}: ${code(demand.programId)}`,
    `- ${locale.demandLabels.demand}: ${code(demand.demandId)}`,
    `- ${locale.demandLabels.type}: ${code(demand.demandType)}`,
    `- ${locale.demandLabels.created}: ${code(demand.createdAt)}`,
    `- ${locale.demandLabels.source}: ${demandSourceSummary(demand, locale)}`,
    `- ${locale.demandLabels.placement}: ${placementSummary(demand, locale)}`,
  ].join("\n");
}

function renderStateSummary(state, locale) {
  return [
    `- ${locale.stateLabels.state}: ${code(state.state)}`,
    `- ${locale.stateLabels.revision}: ${code(state.revision)}`,
    `- ${locale.stateLabels.updated}: ${code(state.updatedAt)}`,
    `- ${locale.stateLabels.event}: ${code(state.lastEvent.eventId)} — ${code(state.lastEvent.eventDigest)}`,
    `- ${locale.stateLabels.reason}:`,
    humanBlock(state.stateReason),
  ].join("\n");
}

function renderAuthoritySummary(authority, locale) {
  if (authority === null) {
    return [
      `- ${locale.authorityStatus}: ${code(locale.notFrozen)}`,
      "",
      humanBlock(locale.authorityAbsent),
    ].join("\n");
  }
  return [
    `- ${locale.authorityStatus}: ${code(locale.frozen)}`,
    `- ${locale.entryMode}: ${code(authority.entryMode)}`,
    `- ${locale.testMode}: ${code(authority.testDecision.mode)}`,
    `- ${locale.testSummary}:`,
    humanBlock(authority.testDecision.summary),
    ...(authority.testDecision.environmentSpecRef
      ? [`- ${locale.environment}: ${code(authority.testDecision.environmentSpecRef)}`]
      : []),
    `- ${locale.authorityRefs}:`,
    ...authority.authorityRefs.map((reference) => `  - ${refSummary(reference)}`),
  ].join("\n");
}

function renderEventSummary(events, locale) {
  return events.map((event) => [
    `### ${locale.eventRevision} ${event.nextRevision}`,
    "",
    `- ${locale.eventId}: ${code(event.eventId)}`,
    `- ${locale.eventTransition}: ${code(event.from ?? "null")} → ${code(event.to)}`,
    `- ${locale.eventCommand}: ${code(event.command)} / ${code(event.type)}`,
    `- ${locale.eventCreated}: ${code(event.createdAt)}`,
    `- ${locale.eventDigest}: ${code(canonicalJsonDigest(event))}`,
    `- ${locale.eventReason}:`,
    humanBlock(event.reason),
    `- ${locale.eventDecision}:`,
    humanBlock(event.decisionSummary),
    `- ${locale.changedArtifacts}:`,
    ...(event.changedArtifacts.length === 0
      ? [`  - ${locale.noChangedArtifacts}`]
      : event.changedArtifacts.map((artifact) => (
          `  - ${code(artifact.artifactKind)} — ${code(artifact.ref)} — ${code(artifact.digest)}`
        ))),
  ].join("\n")).join("\n\n");
}

function selectedArtifactTuple(artifactKind, artifactId, entry) {
  return Object.freeze({
    artifactKind,
    artifactId,
    ref: entry.ref,
    digest: entry.digest,
  });
}

function compareSelectedArtifacts(left, right) {
  for (const key of ["ref", "artifactKind", "artifactId", "digest"]) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }
  return 0;
}

/** 从完整验证后的state中只投影active/current/pending artifact精确引用。 */
export function selectWakeflowStateSelectedArtifacts(state) {
  const validatedState = validateDemandStateRecord(state);
  const candidates = [
    ...validatedState.taskPackages
      .filter((entry) => entry.lifecycleStatus === "active")
      .map((entry) => selectedArtifactTuple(
        "wakeflow-task-package",
        entry.taskPackageId,
        entry,
      )),
    ...validatedState.targetResults
      .filter((entry) => entry.lifecycleStatus === "current")
      .map((entry) => selectedArtifactTuple(
        "wakeflow-target-result",
        entry.targetResultId,
        entry,
      )),
    ...validatedState.testCards
      .filter((entry) => entry.lifecycleStatus === "active")
      .map((entry) => selectedArtifactTuple(
        "wakeflow-test-card",
        entry.testCardId,
        entry,
      )),
    ...(validatedState.review.pendingCandidate
      ? [selectedArtifactTuple(
          "wakeflow-review-candidate",
          validatedState.review.pendingCandidate.reviewCandidateId,
          validatedState.review.pendingCandidate,
        )]
      : []),
    ...validatedState.evidence.map((entry) => selectedArtifactTuple(
      "wakeflow-evidence",
      entry.evidenceId,
      entry,
    )),
  ];
  const uniqueByRef = new Map(candidates.map((entry) => [entry.ref, entry]));
  return deepFreeze([...uniqueByRef.values()].sort(compareSelectedArtifacts));
}

function renderCurrentArtifactNavigation(selectedArtifacts, locale) {
  const groups = CURRENT_ARTIFACT_GROUPS.map((group) => ({
    label: locale.artifactGroups[group.localeKey],
    entries: selectedArtifacts.filter((entry) => entry.artifactKind === group.artifactKind),
  })).filter((group) => group.entries.length > 0);
  if (groups.length === 0) return [];
  return [
    "",
    `## ${locale.currentArtifacts}`,
    "",
    locale.currentArtifactNotice,
    ...groups.flatMap((group) => [
      "",
      `### ${group.label}`,
      "",
      ...group.entries.map((entry) => (
        `- ${link(safeHeading(entry.artifactId), entry.ref)} — ${code(entry.digest)}`
      )),
    ]),
  ];
}

function renderIndex({ demand, authority, selectedArtifacts, source, locale }) {
  const roots = wakeflowDemandCapabilityRoots(demand.executionPlacement)
    .filter((root) => root !== WAKEFLOW_DEMAND_RECOVERY_ROOT)
    .map((root) => `${root}/`);
  const recoveryRoot = `${WAKEFLOW_DEMAND_RECOVERY_ROOT}/`;
  return canonicalMarkdown([
    `# ${safeHeading(demand.title)} — ${locale.indexSuffix}`,
    "",
    marker(source.fingerprint),
    "",
    `> ${locale.indexNotice}`,
    "",
    `${locale.sourceLine}: ${code(`revision ${source.revision}`)}; ${code(source.eventId)}; ${code(source.eventDigest)}; ${code(source.fingerprint)}`,
    "",
    `## ${locale.coreRecords}`,
    "",
    `- ${link(WAKEFLOW_DEMAND_FILE, WAKEFLOW_DEMAND_FILE)} — ${locale.immutableDemand}`,
    ...(authority === null
      ? [`- ${locale.pendingAuthority}`]
      : [`- ${link(WAKEFLOW_DEMAND_AUTHORITY_FILE, WAKEFLOW_DEMAND_AUTHORITY_FILE)} — ${locale.frozenAuthority}`]),
    `- ${link(WAKEFLOW_DEMAND_STATE_FILE, WAKEFLOW_DEMAND_STATE_FILE)} — ${locale.currentState}`,
    `- ${link(WAKEFLOW_DEMAND_EVENTS_FILE, WAKEFLOW_DEMAND_EVENTS_FILE)} — ${locale.events}`,
    `- ${link(PROGRESS_FILE, PROGRESS_FILE)} — ${locale.progress}`,
    ...renderCurrentArtifactNavigation(selectedArtifacts, locale),
    "",
    `## ${locale.capabilityRoots}`,
    "",
    locale.capabilityNotice,
    "",
    ...roots.map((root) => `- ${link(root, root)}`),
    "",
    `## ${locale.recovery}`,
    "",
    locale.recoveryNotice,
    "",
    `- ${link(recoveryRoot, recoveryRoot)}`,
  ].join("\n"));
}

function sourceFingerprint({ language, stack, progressTemplate }) {
  return canonicalJsonDigest({
    artifactKind: "wakeflow-demand-document-source",
    schemaVersion: 1,
    projectorSchemaVersion: WAKEFLOW_DEMAND_DOCUMENT_PROJECTOR_SCHEMA_VERSION,
    language,
    programId: stack.demand.programId,
    demandId: stack.demand.demandId,
    demandDigest: stack.digests.demand,
    authorityDigest: stack.digests.authority,
    stateDigest: stack.digests.state,
    eventHistoryDigest: canonicalJsonDigest(stack.events),
    tail: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    progressTemplate,
  });
}

/** 纯构建两份确定性需求文档及其摘要；物理发布和CAS由外层projector/publication owner负责。 */
export function buildWakeflowDemandDocuments(input = {}) {
  const validatedInput = assertInput(input);
  const stack = validateDemandCoreStack({
    demand: validatedInput.demand,
    authority: validatedInput.authority,
    state: validatedInput.state,
    events: validatedInput.events,
  });
  const locale = LOCALES[validatedInput.language];
  const assetId = validatedInput.language === "zh" ? "progress.demand.zh-CN" : "progress.demand.en";
  const progressTemplate = Object.freeze({
    assetId,
    digest: validatedInput.bundle.assets[assetId].sha256,
  });
  const fingerprint = sourceFingerprint({
    language: validatedInput.language,
    stack,
    progressTemplate,
  });
  const source = deepFreeze({
    fingerprint,
    projectorSchemaVersion: WAKEFLOW_DEMAND_DOCUMENT_PROJECTOR_SCHEMA_VERSION,
    demandDigest: stack.digests.demand,
    authorityDigest: stack.digests.authority,
    stateDigest: stack.digests.state,
    eventHistoryDigest: canonicalJsonDigest(stack.events),
    revision: stack.state.revision,
    eventId: stack.state.lastEvent.eventId,
    eventDigest: stack.state.lastEvent.eventDigest,
    progressTemplate,
  });
  const progress = canonicalMarkdown(renderWakeflowAsset({
    bundle: validatedInput.bundle,
    assetId,
    input: {
      authority: renderAuthoritySummary(stack.authority, locale),
      completionDefinition: humanBlock(stack.demand.completionDefinition),
      currentState: renderStateSummary(stack.state, locale),
      demand: renderDemandSummary(stack.demand, locale),
      events: renderEventSummary(stack.events, locale),
      goal: humanBlock(stack.demand.goal),
      projectionMarker: marker(source.fingerprint),
      source: renderSourceSummary(source, locale),
      title: safeHeading(stack.demand.title),
    },
  }).content);
  const selectedArtifacts = selectWakeflowStateSelectedArtifacts(stack.state);
  const index = renderIndex({
    demand: stack.demand,
    authority: stack.authority,
    selectedArtifacts,
    source,
    locale,
  });
  return deepFreeze({
    kind: "WakeflowDemandDocumentProjection",
    schemaVersion: WAKEFLOW_DEMAND_DOCUMENT_PROJECTOR_SCHEMA_VERSION,
    programId: stack.demand.programId,
    demandId: stack.demand.demandId,
    language: validatedInput.language,
    source,
    files: {
      [INDEX_FILE]: {
        content: index,
        digest: sha256Text(index),
      },
      [PROGRESS_FILE]: {
        content: progress,
        digest: sha256Text(progress),
      },
    },
  });
}
