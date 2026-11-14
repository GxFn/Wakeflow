import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Wakeflow Tooling / Codegen：业务拒绝 reason 的参考表（open-items G5）。
 *
 * 公共工具的拒绝由 `code` 与 `reason` 两个记号说明。`code` 是封闭的十个，技能文本按它讲了处理办法；
 * `reason` 有一百多个，散在各切片的 `fail(...)`、判定函数的 `reject(...)` 与映射表里，登记时其中 128 个没有
 * 出现在任何随制品发布的文字里——Agent 第一次遇到时只能猜。这里把它们从源码里扫出来，按 `code` 与切片列成
 * 一份参考，随 Controller 技能发布；`check` 进门，源码里多一个或少一个 reason，参考就必须重新生成。
 *
 * 扫描的是文本形状：一个业务 `code` 的字符串字面量后面紧跟一个字符串或模板字面量（同一次调用或同一个元组
 * 里）。模板里的插值写成 `<…>`。按处理办法写的说明与个别 reason 的注记是这里手写的；注记点名的 reason 不在
 * 扫描结果里时生成失败，所以注记不会比代码活得久。
 *
 * 不在这里的：维护与 pod 预览的 `blockerCodes`（它们是数据里的字符串，不是拒绝的 reason，各自在参考文档里
 * 讲）；`invalid-request` 的 reason（路径与 `details.schema` 已经点名字段）；`io-failure` 与 `unexpected`
 * （那是故障，不是拒绝）。
 */

export const REFUSAL_REFERENCE_OUTPUT =
  "assets/agent-text/skills/wakeflow-controller/references/refusals.md";
const SOURCE_ROOT = "src";

/** 拒绝（不是故障）的六个 `code`，按参考里的顺序。 */
const REFUSAL_CODES = [
  "concurrency-conflict",
  "idempotency-mismatch",
  "precondition-failed",
  "not-found",
  "capacity-exceeded",
  "recovery-required",
] as const;
type RefusalCode = (typeof REFUSAL_CODES)[number];

const CODE_GUIDANCE: Readonly<Record<RefusalCode, readonly [string, string]>> = Object.freeze({
  "concurrency-conflict": [
    "something changed between your read and this call",
    "A revision, a claim, a binding or a lock is no longer what the request assumed. Do not resend the same call. Read again - `wakeflow_status` (with the Demand id), or the tool's own inspect or preview - take the new revision, digest or generation from that result, and decide whether the call is still wanted. `retryable: true` marks the transient ones (a writer or a lock was busy): after reading status once, the same call may be repeated.",
  ],
  "idempotency-mismatch": [
    "this idempotency key already belongs to a different request",
    "If you are retrying a call whose response was lost, resend the original request unchanged with the same key - it replays the stored outcome and writes nothing. If you rebuilt the request from memory and a field differs, do not repair it with a new key: a new key is a second write. Read the stored outcome first (status, or the tool's inspect) and use a new key only for an operation that is new.",
  ],
  "precondition-failed": [
    "the workspace state does not allow this now",
    "The reason names the condition; `path` names the request field or the state it concerns, and `details.blocker`, `details.blocker2`... carry every blocker of a refused preview. Resolve the condition with the tool that owns it, then preview or call again. A stale digest or snapshot means read again, not retry; a refusal about a claim or a window in use means wait or read status - never release a live claim and never edit state by hand to make a refusal pass.",
  ],
  "not-found": [
    "the identifier names nothing here",
    "Take identifiers only from a previous result. Read `wakeflow_status` or the board again; an archived Demand is addressed through its archive receipt.",
  ],
  "capacity-exceeded": [
    "a bounded size or count is full",
    "Reduce what the request carries, or tell the user which bound was reached; do not split one record into several to get around it.",
  ],
  "recovery-required": [
    "an earlier write was interrupted",
    'Finish that operation\'s recovery before anything else. For maintenance, `details.operationId` goes to maintenance recover and, without one, preview reconcile; the Demand, requirement, evidence and pod tools take `mode: recover` themselves, with the operation the refusal names. See "Interrupted writes and cancellation" in `workspace-and-windows.md`.',
  ],
});

/** 个别 reason 的注记：本能的处理办法是错的、或要点名下一步的那些。 */
const REASON_NOTES: Readonly<Record<string, string>> = Object.freeze({
  "request-digest":
    'the key was used with a different request body. Replay the original unchanged, or read the stored outcome; never "fix" it with a fresh key.',
  "stream-advanced":
    "the Demand's event stream moved while you worked. Read status with the Demand id and continue from what it names.",
  "snapshot-stale":
    "the review snapshot you inspected is no longer current. Inspect the review again and decide on that result.",
  "review-unit-stale":
    "the review unit changed after your inspection (a newer result landed). Inspect again; the decision must cite the current digests.",
  "fence-mismatch":
    "the report carries a claim digest that no recorded outcome of this delivery has: it was written for another delivery. The target imports with the digest from its own delivery prompt - never edit the digest to make it pass.",
  "window-claimed":
    "the window already works on another delivery. Wait for that result or read status; do not release its claim.",
  "claim-held":
    "the window still holds a work claim, so its binding cannot be retired. Let the delivery finish or cancel the Demand first; never release a live claim to get past it.",
  "pod-busy":
    "the pod already carries an active Demand, or an interrupted Demand publication still reserves it. One Demand per pod: complete, cancel or recover that one, or claim into another pod.",
  "hook-evidence-missing":
    "no hook record proves the session named in the observation started in that window. Launch or resume the window with the host procedure, then register again - never register a handle the host did not report.",
  "authority-reference-unknown":
    "the task package cites a ledger member that the Demand's requirement packages do not contain. Use the member references the inspection of the requirement returned.",
});

export class RefusalReferenceCodegenError extends Error {
  override readonly name = "RefusalReferenceCodegenError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new RefusalReferenceCodegenError(code, message);
}

function sourceFiles(directory: string, out: string[] = []): string[] {
  for (const name of readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) {
      if (name !== "generated" && name !== "assets") sourceFiles(absolute, out);
    } else if (name.endsWith(".ts")) out.push(absolute);
  }
  return out;
}

/** 一个源文件归到哪个切片：能力目录的名字，其余按层。 */
export function refusalSliceOf(relativeFile: string): string {
  const segments = relativeFile.split("/");
  if (segments[1] === "capabilities" && segments.length > 3) return segments[2] ?? "capabilities";
  return segments[1] ?? "src";
}

const REASON_AFTER_CODE = new RegExp(
  `"(${REFUSAL_CODES.join("|")})",\\s*(?:"([^"\\n]+)"|\`([^\`\\n]+)\`)`,
  "gu",
);
const REASON_SHAPE = /^[a-z0-9][a-z0-9<>:.-]*$/u;

/** 模板字面量里的插值写成占位：`record-${error.reason}` 是 `record-<reason>`。 */
function displayTemplate(template: string): string {
  return template.replace(/\$\{([^}]*)\}/gu, (_whole: string, expression: string) => {
    const name = /([A-Za-z]+)\s*$/u.exec(expression.replace(/\?\?.*$/u, "").trim())?.[1] ?? "value";
    return `<${name}>`;
  });
}

export interface ScannedRefusals {
  /** code -> slice -> 排好序的 reason。 */
  readonly byCode: ReadonlyMap<RefusalCode, ReadonlyMap<string, readonly string[]>>;
  readonly reasons: ReadonlySet<string>;
}

export function scanRefusalReasons(
  files: readonly Readonly<{ file: string; text: string }>[],
): Readonly<ScannedRefusals> {
  const byCode = new Map<RefusalCode, Map<string, Set<string>>>();
  const reasons = new Set<string>();
  for (const { file, text } of files) {
    for (const match of text.matchAll(REASON_AFTER_CODE)) {
      const code = match[1] as RefusalCode;
      const reason = match[2] ?? displayTemplate(match[3] ?? "");
      // 路径（`$request…`）与别的不是 reason 形状的第二个参数不算；`wakeflow-<模块>` 是旧错误类的 code
      // （`legacy-error-families` 表里一行接一行），不是 reason。
      if (!REASON_SHAPE.test(reason) || reason.startsWith("wakeflow-")) continue;
      const slices = byCode.get(code) ?? new Map<string, Set<string>>();
      byCode.set(code, slices);
      const slice = refusalSliceOf(file);
      const set = slices.get(slice) ?? new Set<string>();
      slices.set(slice, set);
      set.add(reason);
      reasons.add(reason);
    }
  }
  return Object.freeze({
    byCode: new Map(
      [...byCode].map(([code, slices]) => [
        code,
        new Map(
          [...slices]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([slice, set]) => [slice, Object.freeze([...set].sort())]),
        ),
      ]),
    ),
    reasons,
  });
}

export function renderRefusalReference(scanned: Readonly<ScannedRefusals>): string {
  for (const reason of Object.keys(REASON_NOTES)) {
    if (!scanned.reasons.has(reason)) {
      fail(
        "wakeflow-refusal-reference-note",
        `the note for ${reason} names a reason the source no longer raises; remove or rename the note`,
      );
    }
  }
  const lines: string[] = [
    "# Refusals by code and reason",
    "",
    "<!-- Generated from the source by `npm run refusals:build`. Do not edit: change the code or the generator's notes, then rebuild. -->",
    "",
    "A refusal is the tool telling you why it did nothing. Act on its `code` first; the",
    "`reason` narrows it and `path` names the field or the state concerned. `invalid-request`",
    "is not listed: its `path` and `details.schema` already name the field to fix. `io-failure`",
    "and `unexpected` are failures, not refusals - the skill's rule for them applies. Preview",
    "`blockerCodes` are explained where their tool is (`workspace-and-windows.md`,",
    "`delivery-and-review.md`). A reason written `<like-this>` carries a value in that place.",
    "",
  ];
  for (const code of REFUSAL_CODES) {
    const [summary, guidance] = CODE_GUIDANCE[code];
    lines.push(`## \`${code}\` - ${summary}`, "", guidance, "");
    const slices = scanned.byCode.get(code);
    if (slices === undefined) continue;
    for (const [slice, reasons] of slices) {
      lines.push(`- **${slice}**: ${reasons.map((reason) => `\`${reason}\``).join(", ")}`);
    }
    lines.push("");
  }
  lines.push("## Reasons where the first instinct is wrong", "");
  for (const [reason, note] of Object.entries(REASON_NOTES)) {
    lines.push(`- \`${reason}\` - ${note}`);
  }
  return `${lines.join("\n")}\n`;
}

function readSources(repoRoot: string): readonly Readonly<{ file: string; text: string }>[] {
  return sourceFiles(path.join(repoRoot, SOURCE_ROOT)).map((absolute) => ({
    file: path.relative(repoRoot, absolute).split(path.sep).join("/"),
    text: readFileSync(absolute, "utf8"),
  }));
}

export interface RefusalReferenceResult {
  readonly output: string;
  readonly reasons: number;
  readonly lines: number;
}

function generate(repoRoot: string): Readonly<{ text: string; result: RefusalReferenceResult }> {
  const scanned = scanRefusalReasons(readSources(repoRoot));
  const text = renderRefusalReference(scanned);
  return {
    text,
    result: Object.freeze({
      output: REFUSAL_REFERENCE_OUTPUT,
      reasons: scanned.reasons.size,
      lines: text.split("\n").length - 1,
    }),
  };
}

export function buildRefusalReference(repoRoot: string): Readonly<RefusalReferenceResult> {
  const { text, result } = generate(repoRoot);
  writeFileSync(path.join(repoRoot, REFUSAL_REFERENCE_OUTPUT), text);
  return result;
}

export function checkRefusalReference(repoRoot: string): Readonly<RefusalReferenceResult> {
  const { text, result } = generate(repoRoot);
  let committed: string;
  try {
    committed = readFileSync(path.join(repoRoot, REFUSAL_REFERENCE_OUTPUT), "utf8");
  } catch {
    fail(
      "wakeflow-refusal-reference-missing",
      `${REFUSAL_REFERENCE_OUTPUT} is missing; run npm run refusals:build`,
    );
  }
  if (committed !== text) {
    fail(
      "wakeflow-refusal-reference-drift",
      `${REFUSAL_REFERENCE_OUTPUT} does not match the reasons the source raises; run npm run refusals:build`,
    );
  }
  return result;
}

function main(): void {
  try {
    const [command, flag, repoRoot, ...rest] = process.argv.slice(2);
    if (
      (command !== "build" && command !== "check") ||
      flag !== "--repo-root" ||
      repoRoot === undefined ||
      rest.length > 0
    ) {
      fail(
        "wakeflow-refusal-reference-argv",
        "usage: refusal-reference <build|check> --repo-root <path>",
      );
    }
    const root = path.resolve(repoRoot);
    const result = command === "build" ? buildRefusalReference(root) : checkRefusalReference(root);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error: unknown) {
    const known = error instanceof RefusalReferenceCodegenError;
    console.error(
      JSON.stringify(
        {
          ok: false,
          code: known ? error.code : "wakeflow-refusal-reference-unexpected",
          message: known ? error.message : "unexpected failure",
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
