import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWindowBindingRequest } from "../../../src/capabilities/endpoint/contract.js";
import { WakeflowError } from "../../../src/kernel/error.js";

/**
 * 端点请求合同的拒绝措辞（第 0 级，纯逻辑；open-items W39，gate-log §13.218 L16）：顶层 oneOf 不匹配时
 * 报的是请求点名的那个操作自己的错，replace / relocate 缺 CAS 字段时点名缺的字段，而不是第一个分支
 * （inspect）的 `additional:observation`；tmux 与桌面两种定位子同样如此。只调用解析函数，不读写文件。
 */

const ROOT = "/workspace";
const WINDOW = "window_55555555-5555-4555-8555-555555555555";
const BINDING = "window_binding_77777777-7777-4777-8777-777777777777";
const DIGEST = `sha256:${"1".repeat(64)}`;

const TMUX_OBSERVATION = Object.freeze({
  handle: { kind: "claude-code-session", value: "5f0c6a52-2f5e-4f7e-9a39-1b2c3d4e5f60" },
  launchIntentDigest: DIGEST,
  observedAt: "2026-11-01T08:00:00.000Z",
  tmux: { socketName: null, sessionName: "wakeflow", windowId: "@3", paneId: "%7" },
});
const DESKTOP_OBSERVATION = Object.freeze({
  handle: { kind: "claude-code-session", value: "5f0c6a52-2f5e-4f7e-9a39-1b2c3d4e5f60" },
  launchIntentDigest: DIGEST,
  observedAt: "2026-11-01T08:00:00.000Z",
  desktop: { sessionId: "local_5f0c6a52-2f5e-4f7e-9a39-1b2c3d4e5f60" },
});

/** 拒绝的 `code/reason`、路径与 Schema 令牌。 */
function refusal(request: unknown): readonly [string, string, string | undefined] {
  try {
    parseWindowBindingRequest(request);
  } catch (error: unknown) {
    if (!(error instanceof WakeflowError)) throw error;
    return [`${error.code}/${error.reason}`, error.path, error.details?.schema];
  }
  throw new Error("Expected the request to be refused.");
}

test("replace 与 relocate 缺 expectedBindingId 或 expectedBindingDigest：拒绝码点名缺的字段（$request），tmux 与桌面定位子相同", () => {
  for (const observation of [TMUX_OBSERVATION, DESKTOP_OBSERVATION]) {
    for (const operation of ["replace", "relocate"] as const) {
      const base = { root: ROOT, operation, windowId: WINDOW, observation };
      deepEqual(refusal(base), [
        "invalid-request/schema",
        "$request",
        "required:expectedBindingId",
      ]);
      deepEqual(refusal({ ...base, expectedBindingId: BINDING }), [
        "invalid-request/schema",
        "$request",
        "required:expectedBindingDigest",
      ]);
      equal(
        parseWindowBindingRequest({
          ...base,
          expectedBindingId: BINDING,
          expectedBindingDigest: DIGEST,
        }).operation,
        operation,
      );
    }
  }
});

test("点名操作的分支决定拒绝码：register 多带 CAS 字段报 additional，decommission 缺 closure 报 required，未知操作仍走整体 oneOf", () => {
  deepEqual(
    refusal({
      root: ROOT,
      operation: "register",
      windowId: WINDOW,
      observation: TMUX_OBSERVATION,
      expectedBindingId: BINDING,
    })[2],
    "additional:expectedBindingId",
  );
  deepEqual(
    refusal({
      root: ROOT,
      operation: "decommission",
      windowId: WINDOW,
      expectedBindingId: BINDING,
      expectedBindingDigest: DIGEST,
    })[2],
    "required:closure",
  );
  deepEqual(
    refusal({
      root: ROOT,
      operation: "replace",
      windowId: WINDOW,
      observation: { ...TMUX_OBSERVATION, launchIntentDigest: "sha256:short" },
      expectedBindingId: BINDING,
      expectedBindingDigest: DIGEST,
    }).slice(0, 2),
    ["invalid-request/schema", "$request/observation/launchIntentDigest"],
  );
  equal(
    refusal({ root: ROOT, operation: "rename", windowId: WINDOW })[0],
    "invalid-request/schema",
  );
  equal(refusal([])[0], "invalid-request/schema");
  throws(() => parseWindowBindingRequest({ root: ROOT, operation: 7 }), WakeflowError);
});
