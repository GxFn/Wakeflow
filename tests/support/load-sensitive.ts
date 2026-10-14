import type { TestContext } from "node:test";

/**
 * 推荐并发 2：CI（`.github/workflows/verify.yml`）固定 2 个 worker；本地 `wf verify gate` 缺省一 CPU 一 worker，
 * 复现门的负载特征要显式 `WAKEFLOW_TEST_CONCURRENCY=2`（§13.169：8 worker 下真实 fsync 夹具的准备阶段就超时）。
 */
const LOAD_SENSITIVE_RECOMMENDED_CONCURRENCY = 2;

/**
 * 负载敏感用例的标签（open-items D9；gate-log §13.153、§13.161 的偶发超时都来自这类用例）：真实子进程、
 * 墙钟等待或外部 CLI，机器繁忙或并发高于推荐值时会超时。标签写进测试诊断输出并点名超出推荐值的并发，
 * 不改变断言。开发机繁忙时 `WAKEFLOW_TEST_SKIP_LOAD_SENSITIVE=1` 让这些用例标记为 skip，调用方按返回值
 * 直接 return；门与 CI 从不设置它。
 */
export function loadSensitive(t: TestContext, reason: string): boolean {
  const configured = Number.parseInt(process.env.WAKEFLOW_TEST_CONCURRENCY ?? "", 10);
  const exceeded =
    Number.isInteger(configured) && configured > LOAD_SENSITIVE_RECOMMENDED_CONCURRENCY
      ? `; WAKEFLOW_TEST_CONCURRENCY=${configured} exceeds the recommended ${LOAD_SENSITIVE_RECOMMENDED_CONCURRENCY}`
      : "";
  t.diagnostic(`load-sensitive: ${reason}${exceeded}`);
  if (process.env.WAKEFLOW_TEST_SKIP_LOAD_SENSITIVE !== "1") return false;
  t.skip("WAKEFLOW_TEST_SKIP_LOAD_SENSITIVE=1");
  return true;
}
