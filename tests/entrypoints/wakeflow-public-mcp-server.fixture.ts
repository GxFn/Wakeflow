import type { TestContext } from "node:test";

import {
  Client,
  InMemoryTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";

import { createWakeflowPublicMcpServer } from "../../src/entrypoints/wakeflow-public-mcp-server.js";

type WakeflowPublicMcpServer = ReturnType<typeof createWakeflowPublicMcpServer>;
type WakeflowPublicMcpServerOptions = Parameters<
  typeof createWakeflowPublicMcpServer
>[0];
type WakeflowMcpExecutorSet = Omit<
  WakeflowPublicMcpServerOptions,
  "serverName" | "serverVersion"
>;

export type WakeflowMcpExecutorOverrides = Readonly<
  Partial<WakeflowMcpExecutorSet>
>;

export interface ConnectedWakeflowMcpTestClient {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

function unexpectedMcpExecutor(
  capability: keyof WakeflowMcpExecutorSet,
): never {
  throw new Error(`${capability} executor was not expected in this test.`);
}

/**
 * 为单能力协议测试提供完整但默认拒绝执行的组合根依赖。
 *
 * 测试必须显式覆盖准备调用的能力；意外跨工具调用会立即失败。
 */
function defaultMcpExecutors(): WakeflowMcpExecutorSet {
  return {
    authorizeProductDefectRemediation: async () =>
      unexpectedMcpExecutor("authorizeProductDefectRemediation"),
    claimTargetHostEffect: async () =>
      unexpectedMcpExecutor("claimTargetHostEffect"),
    completeDemand: async () => unexpectedMcpExecutor("completeDemand"),
    createDemand: async () => unexpectedMcpExecutor("createDemand"),
    executeMaintenance: async () => unexpectedMcpExecutor("executeMaintenance"),
    importTargetResult: async () => unexpectedMcpExecutor("importTargetResult"),
    inspectDemandRoute: async () => unexpectedMcpExecutor("inspectDemandRoute"),
    inspectTargetResultReview: async () =>
      unexpectedMcpExecutor("inspectTargetResultReview"),
    planTargetTask: async () => unexpectedMcpExecutor("planTargetTask"),
    planTestCard: async () => unexpectedMcpExecutor("planTestCard"),
    prepareImplementationDelivery: async () =>
      unexpectedMcpExecutor("prepareImplementationDelivery"),
    prepareTestDelivery: async () =>
      unexpectedMcpExecutor("prepareTestDelivery"),
    rearmTargetHostEffect: async () =>
      unexpectedMcpExecutor("rearmTargetHostEffect"),
    recordControllerImplementationReviewDecision: async () =>
      unexpectedMcpExecutor("recordControllerImplementationReviewDecision"),
    recordControllerTestReviewDecision: async () =>
      unexpectedMcpExecutor("recordControllerTestReviewDecision"),
    recordTargetHostEffectOutcome: async () =>
      unexpectedMcpExecutor("recordTargetHostEffectOutcome"),
    registerWindowHostBinding: async () =>
      unexpectedMcpExecutor("registerWindowHostBinding"),
    resumeTargetResultReview: async () =>
      unexpectedMcpExecutor("resumeTargetResultReview"),
  };
}

/** 使用官方内存Transport连接一个已装配的Wakeflow MCP server。 */
export async function connectWakeflowMcpServerForTest(
  server: WakeflowPublicMcpServer,
): Promise<Readonly<ConnectedWakeflowMcpTestClient>> {
  const client = new Client({
    name: "wakeflow-mcp-focused-client",
    version: "1.0.0-test",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const close = async (): Promise<void> => {
    await Promise.allSettled([client.close(), server.close()]);
  };

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  } catch (error: unknown) {
    await close();
    throw error;
  }

  return Object.freeze({
    client,
    close,
  });
}

/**
 * 创建只覆盖当前用例目标能力的共享MCP测试连接，并交由node:test清理。
 */
export async function connectWakeflowMcpTestClient(
  t: TestContext,
  overrides: WakeflowMcpExecutorOverrides = {},
): Promise<Client> {
  const server = createWakeflowPublicMcpServer({
    serverName: "wakeflow-mcp-focused-test",
    serverVersion: "1.0.0-test",
    ...defaultMcpExecutors(),
    ...overrides,
  });
  const connection = await connectWakeflowMcpServerForTest(server);
  t.after(connection.close);
  return connection.client;
}

/** 读取Wakeflow公共工具返回的唯一文本内容块。 */
export function wakeflowMcpTextContent(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== "text") {
    throw new Error("Expected one MCP text content block.");
  }
  return first.text;
}
