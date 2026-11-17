import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Wakeflow Tooling / Metrics：1.4 开发计划第 1 节的三个度量。
 *
 * 两个只读的量法，都不进制品、不碰任何工作区状态：
 * - 归档：从一个归档修订目录的 `payload/event-sourcing/commits/` 数事件，算 Controller 手写的字节数
 *   （任务包里由它写的文字，加评审决定里由它写的文字）与两段时长（目标干活、评审）。
 * - 会话记录：从宿主的 JSONL 会话记录数工具调用——Wakeflow 的工具、助手脚本、其余。
 *
 * 手写字节数的口径只含归档里原样存着的两类内容。投递时写的三段文字与证据的选择没有单独存下来
 * （前者只存在渲染后的 prompt 里），所以不计入；这两类在 1.3.1 的小样本里合计约两成。
 */

type JsonRecord = Readonly<Record<string, unknown>>;

interface StoredEvent {
  readonly eventType: string;
  readonly recordedAt: string;
  readonly data: JsonRecord;
}

export interface DemandArchiveMetrics {
  readonly kind: "WakeflowDemandArchiveMetrics";
  readonly schemaVersion: 1;
  readonly status: "passed";
  readonly events: Readonly<{ total: number; byType: Readonly<Record<string, number>> }>;
  readonly targets: number;
  readonly deliveries: number;
  readonly decisions: Readonly<Record<string, number>>;
  readonly evidenceRecords: number;
  readonly authoredBytes: Readonly<{
    total: number;
    taskPackages: number;
    decisions: number;
    perTarget: number;
  }>;
  readonly targetWorkSeconds: Readonly<{ values: readonly number[]; median: number | null }>;
  readonly reviewSeconds: Readonly<{ values: readonly number[]; median: number | null }>;
}

export interface SessionCallMetrics {
  readonly kind: "WakeflowSessionCallMetrics";
  readonly schemaVersion: 1;
  readonly status: "passed";
  readonly since: string | null;
  readonly until: string | null;
  readonly toolCalls: Readonly<{
    total: number;
    wakeflow: Readonly<{ total: number; byTool: Readonly<Record<string, number>> }>;
    helper: number;
    other: number;
  }>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(value: unknown, key: string): JsonRecord {
  const member = isRecord(value) ? value[key] : undefined;
  return isRecord(member) ? member : {};
}

function stringAt(value: unknown, key: string): string {
  const member = isRecord(value) ? value[key] : undefined;
  return typeof member === "string" ? member : "";
}

function listAt(value: unknown, key: string): readonly unknown[] {
  const member = isRecord(value) ? value[key] : undefined;
  return Array.isArray(member) ? member : [];
}

function bytesOf(texts: readonly unknown[]): number {
  let total = 0;
  for (const text of texts) {
    if (typeof text === "string") total += Buffer.byteLength(text, "utf8");
  }
  return total;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? 0) + upper) / 2;
}

function secondsBetween(earlier: string, later: string): number | null {
  const from = Date.parse(earlier);
  const to = Date.parse(later);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.round((to - from) / 1000);
}

function readEvents(revisionDirectory: string): readonly StoredEvent[] {
  const commits = path.join(revisionDirectory, "payload", "event-sourcing", "commits");
  const events: StoredEvent[] = [];
  for (const name of readdirSync(commits).sort()) {
    if (!name.endsWith(".json")) continue;
    const commit: unknown = JSON.parse(readFileSync(path.join(commits, name), "utf8"));
    for (const event of listAt(commit, "events")) {
      events.push({
        eventType: stringAt(event, "eventType"),
        recordedAt: stringAt(event, "recordedAt"),
        data: recordAt(event, "data"),
      });
    }
  }
  return events;
}

/** 任务包里由 Controller 写的文字：目标、已确认的上下文、边界三段、完成预期、锚点的三句话。 */
function taskPackageAuthoredBytes(data: JsonRecord): number {
  const taskPackage = recordAt(data, "taskPackage");
  const boundaries = recordAt(taskPackage, "boundaries");
  const anchors = listAt(taskPackage, "acceptanceAnchors").flatMap((anchor) => [
    stringAt(anchor, "claim"),
    stringAt(anchor, "probe"),
    stringAt(anchor, "expected"),
  ]);
  return bytesOf([
    stringAt(taskPackage, "objective"),
    ...listAt(taskPackage, "confirmedContext"),
    ...listAt(boundaries, "inScope"),
    ...listAt(boundaries, "outOfScope"),
    ...listAt(boundaries, "forbidden"),
    ...listAt(taskPackage, "completionExpectations"),
    ...anchors,
  ]);
}

/** 评审决定里由 Controller 写的文字：理由、独立检查的做法与观察、阻塞原因、剩余风险。 */
function decisionAuthoredBytes(decision: JsonRecord): number {
  const checks = listAt(decision, "independentChecks").flatMap((check) => [
    stringAt(check, "method"),
    stringAt(check, "observation"),
  ]);
  return bytesOf([
    stringAt(decision, "rationale"),
    ...checks,
    ...listAt(decision, "blockingReasons"),
    ...listAt(decision, "residualRisks"),
  ]);
}

function countByType(events: readonly StoredEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.eventType] = (counts[event.eventType] ?? 0) + 1;
  return counts;
}

/** 目标干活的时长：投递结局记下到这份投递的结果导入。 */
function targetWorkSeconds(events: readonly StoredEvent[]): readonly number[] {
  const outcomeAt = new Map<string, string>();
  const seconds: number[] = [];
  for (const event of events) {
    if (event.eventType === "delivery.delivery-outcome-recorded") {
      outcomeAt.set(stringAt(recordAt(event.data, "outcome"), "deliveryId"), event.recordedAt);
    }
    if (event.eventType !== "result.target-result-recorded") continue;
    const started = outcomeAt.get(stringAt(recordAt(event.data, "result"), "deliveryId"));
    const elapsed = started === undefined ? null : secondsBetween(started, event.recordedAt);
    if (elapsed !== null) seconds.push(elapsed);
  }
  return seconds;
}

/** 评审阶段的时长：结果导入到针对这份结果的决定。 */
function reviewSeconds(events: readonly StoredEvent[]): readonly number[] {
  const resultAt = new Map<string, string>();
  const seconds: number[] = [];
  for (const event of events) {
    if (event.eventType === "result.target-result-recorded") {
      resultAt.set(stringAt(recordAt(event.data, "result"), "targetResultId"), event.recordedAt);
    }
    if (event.eventType !== "review.target-result-decided") continue;
    const reviewed = recordAt(recordAt(event.data, "decision"), "reviewed");
    const started = resultAt.get(stringAt(reviewed, "targetResultId"));
    const elapsed = started === undefined ? null : secondsBetween(started, event.recordedAt);
    if (elapsed !== null) seconds.push(elapsed);
  }
  return seconds;
}

function decisionCounts(events: readonly StoredEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    if (event.eventType !== "review.target-result-decided") continue;
    const decision = stringAt(recordAt(event.data, "decision"), "decision");
    counts[decision] = (counts[decision] ?? 0) + 1;
  }
  return counts;
}

/** 一个归档修订目录（`archives/<demandId>/<revision>/`）的度量。 */
export function measureArchivedDemand(revisionDirectory: string): DemandArchiveMetrics {
  const events = readEvents(revisionDirectory);
  const byType = countByType(events);
  let packageBytes = 0;
  let decisionBytes = 0;
  for (const event of events) {
    if (event.eventType === "tasking.target-task-planned") {
      packageBytes += taskPackageAuthoredBytes(event.data);
    }
    if (event.eventType === "review.target-result-decided") {
      decisionBytes += decisionAuthoredBytes(recordAt(event.data, "decision"));
    }
  }
  const targets = byType["tasking.target-task-planned"] ?? 0;
  const work = targetWorkSeconds(events);
  const review = reviewSeconds(events);
  return {
    kind: "WakeflowDemandArchiveMetrics",
    schemaVersion: 1,
    status: "passed",
    events: { total: events.length, byType },
    targets,
    deliveries: byType["delivery.delivery-prepared"] ?? 0,
    decisions: decisionCounts(events),
    evidenceRecords: byType["evidence.managed-evidence-recorded"] ?? 0,
    authoredBytes: {
      total: packageBytes + decisionBytes,
      taskPackages: packageBytes,
      decisions: decisionBytes,
      perTarget: targets === 0 ? 0 : Math.round((packageBytes + decisionBytes) / targets),
    },
    targetWorkSeconds: { values: work, median: median(work) },
    reviewSeconds: { values: review, median: median(review) },
  };
}

const HELPER_COMMAND = /operations\/assets\/[a-z]+\.mjs/u;

/** 宿主给 MCP 工具加的前缀以 `__` 分段（服务器名里也可能有 wakeflow），工具名是最后一段。 */
function wakeflowToolName(name: string): string | undefined {
  const tail = name.includes("__") ? name.slice(name.lastIndexOf("__") + 2) : name;
  return tail.startsWith("wakeflow_") ? tail : undefined;
}

interface ToolUse {
  readonly id: string;
  readonly name: string;
  readonly command: string;
}

interface TimeWindow {
  readonly since: string | null;
  readonly until: string | null;
}

function inWindow(timestamp: string, window: TimeWindow): boolean {
  if (window.since !== null && timestamp < window.since) return false;
  return window.until === null || timestamp <= window.until;
}

function toolUsesOf(line: string, window: TimeWindow): readonly ToolUse[] {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return [];
  }
  if (stringAt(entry, "type") !== "assistant") return [];
  if (!inWindow(stringAt(entry, "timestamp"), window)) return [];
  return listAt(recordAt(entry, "message"), "content")
    .filter((item) => stringAt(item, "type") === "tool_use")
    .map((item) => ({
      id: stringAt(item, "id"),
      name: stringAt(item, "name"),
      command: stringAt(recordAt(item, "input"), "command"),
    }));
}

/**
 * 一份宿主会话记录（JSONL）里的工具调用数。`since` 与 `until` 是 ISO 时间，只数两者之间的（含端点）；
 * 同一个调用在记录里重复出现时按调用标识去重。输出里没有任何标识或正文。
 */
export function measureSessionTranscript(file: string, window: TimeWindow): SessionCallMetrics {
  const seen = new Set<string>();
  const byTool: Record<string, number> = {};
  let helper = 0;
  let other = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    for (const use of toolUsesOf(line, window)) {
      if (seen.has(use.id)) continue;
      seen.add(use.id);
      const wakeflow = wakeflowToolName(use.name);
      if (wakeflow !== undefined) byTool[wakeflow] = (byTool[wakeflow] ?? 0) + 1;
      else if (use.name === "Bash" && HELPER_COMMAND.test(use.command)) helper += 1;
      else other += 1;
    }
  }
  const wakeflowTotal = Object.values(byTool).reduce((sum, count) => sum + count, 0);
  return {
    kind: "WakeflowSessionCallMetrics",
    schemaVersion: 1,
    status: "passed",
    since: window.since,
    until: window.until,
    toolCalls: {
      total: wakeflowTotal + helper + other,
      wakeflow: { total: wakeflowTotal, byTool },
      helper,
      other,
    },
  };
}
