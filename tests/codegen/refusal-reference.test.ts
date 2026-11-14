import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  checkRefusalReference,
  RefusalReferenceCodegenError,
  refusalSliceOf,
  renderRefusalReference,
  scanRefusalReasons,
} from "../../tooling/codegen/refusal-reference.js";

/**
 * 级别 5（制品与发布）：业务拒绝 reason 的参考表（open-items G5）。
 *
 * 参考随 Controller 技能发布，内容从源码里扫出来。这里钉三件事——提交的参考与当前源码没有漂移；扫描认得
 * 拒绝在源码里的几种写法，并且不把路径与旧错误类的 code 当成 reason；注记点名的 reason 从源码里消失时生成
 * 失败，而不是留下一条没有出处的说明。
 */

test("提交的参考与源码里的拒绝 reason 没有漂移，并且在参考文件的行数预算之内", () => {
  const result = checkRefusalReference(process.cwd());
  ok(result.reasons > 100, `the scan found the refusal reasons (${result.reasons})`);
  ok(result.lines <= 400, `reference files stay within 400 lines (${result.lines})`);
});

test("扫描认得 fail、判定函数的 reject、映射元组与模板四种写法；路径与旧错误类的 code 不是 reason", () => {
  const scanned = scanRefusalReasons([
    {
      file: "src/capabilities/demand/service.ts",
      text: [
        'fail("concurrency-conflict", "stream-advanced", "$demandRoot", { retryable: true });',
        'return reject("precondition-failed", "claim-held", "$request.windowId");',
        '  "idempotency-conflict": ["idempotency-mismatch", "request-digest", "$request.idempotencyKey"],',
        // 模板字面量的写法（占位符拆开写，免得这一行自己被当成漏写的模板）。
        ['fail("precondition-failed", `record-$', "{error.reason}`, path, { cause: error });"].join(
          "",
        ),
        'fail(\n  "not-found",\n  "demand-unknown",\n  "$request.demandId",\n);',
        // 第二个参数是路径：不是 reason。
        'fail("recovery-required", "$request.root");',
        // 别的 code 不在参考里。
        'fail("io-failure", "demand-root-remove", "$demandRoot");',
      ].join("\n"),
    },
    {
      file: "src/kernel/legacy-error-families.ts",
      text: '"wakeflow-a": "precondition-failed",\n"wakeflow-b": "precondition-failed",',
    },
    {
      file: "src/kernel/work-claims.ts",
      text: 'fail("precondition-failed", "window-claimed", "$claim");',
    },
  ]);
  deepEqual(
    [...scanned.byCode].map(([code, slices]) => [code, [...slices]]),
    [
      ["concurrency-conflict", [["demand", ["stream-advanced"]]]],
      [
        "precondition-failed",
        [
          ["demand", ["claim-held", "record-<reason>"]],
          ["kernel", ["window-claimed"]],
        ],
      ],
      ["idempotency-mismatch", [["demand", ["request-digest"]]]],
      ["not-found", [["demand", ["demand-unknown"]]]],
    ],
  );
  equal(refusalSliceOf("src/capabilities/result-review/service.ts"), "result-review");
  equal(refusalSliceOf("src/entrypoints/wakeflow-caller-role-gate.ts"), "entrypoints");
});

test("参考按 code 给出处理办法与各切片的 reason；注记点名的 reason 不在源码里时生成失败", () => {
  const complete = scanRefusalReasons([
    {
      file: "src/capabilities/all/service.ts",
      text: [
        "request-digest",
        "stream-advanced",
        "snapshot-stale",
        "review-unit-stale",
        "fence-mismatch",
        "window-claimed",
        "claim-held",
        "pod-busy",
        "hook-evidence-missing",
        "authority-reference-unknown",
      ]
        .map((reason) => `fail("precondition-failed", "${reason}", "$x");`)
        .join("\n"),
    },
  ]);
  const text = renderRefusalReference(complete);
  ok(text.startsWith("# Refusals by code and reason\n"));
  ok(text.includes("## `idempotency-mismatch` - this idempotency key already belongs"));
  ok(text.includes("- **all**: `authority-reference-unknown`, `claim-held`"));
  ok(text.includes("- `request-digest` - the key was used with a different request body."));
  throws(
    () => renderRefusalReference(scanRefusalReasons([])),
    (error: unknown) =>
      error instanceof RefusalReferenceCodegenError &&
      error.code === "wakeflow-refusal-reference-note",
  );
});
