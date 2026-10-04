import { equal, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { resolveWakeflowArtifactIdentity } from "../../src/entrypoints/wakeflow-artifact-identity.js";
import { createWakeflowPublicMcpServer } from "../../src/entrypoints/wakeflow-public-mcp-server.js";
import { fail, WakeflowError } from "../../src/kernel/error.js";
import {
  connectWakeflowMcpServerForTest,
  defaultMcpExecutors,
  wakeflowMcpTextContent,
} from "./wakeflow-public-mcp-server.fixture.js";

test("a generated process refuses mutation if its manifest changed or disappeared", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-artifact-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "lib/entrypoints"), { recursive: true });
  mkdirSync(path.join(root, "mcp"));
  writeFileSync(path.join(root, "mcp/server.mjs"), "");
  const manifest = path.join(root, "artifact-manifest.json");
  writeFileSync(manifest, "first");
  const identity = resolveWakeflowArtifactIdentity(
    pathToFileURL(path.join(root, "lib/entrypoints/probe.js")).href,
  );
  identity.assertUnchanged();
  writeFileSync(manifest, "next");
  throws(
    identity.assertUnchanged,
    (e: unknown) => e instanceof WakeflowError && e.reason === "runtime-artifact-outdated",
  );
  rmSync(manifest);
  throws(
    identity.assertUnchanged,
    (e: unknown) => e instanceof WakeflowError && e.reason === "runtime-artifact-unavailable",
  );
});

test("MCP guard leaves reads and previews available while blocking mutations before dispatch", async (t) => {
  let executed = 0;
  let checked = 0;
  const server = createWakeflowPublicMcpServer({
    serverName: "artifact-guard",
    serverVersion: "test",
    ...defaultMcpExecutors(),
    beforeMutation: () => {
      checked++;
      fail("precondition-failed", "runtime-artifact-outdated", "$runtime");
    },
    managePod: async () => {
      executed++;
      return { kind: "probe" } as never;
    },
  });
  const connection = await connectWakeflowMcpServerForTest(server);
  t.after(connection.close);
  const request = {
    root: os.tmpdir(),
    intent: { kind: "create", name: "probe", idempotencyKey: "probe" },
  };
  const preview = await connection.client.callTool({
    name: "wakeflow_pod",
    arguments: { ...request, mode: "preview" },
  });
  equal(preview.isError, undefined);
  equal(executed, 1);
  equal(checked, 0);
  const applied = await connection.client.callTool({
    name: "wakeflow_pod",
    arguments: {
      ...request,
      mode: "apply",
      planDigest: `sha256:${"a".repeat(64)}`,
    },
  });
  equal(applied.isError, true);
  equal(executed, 1);
  equal(checked, 1);
  equal(JSON.parse(wakeflowMcpTextContent(applied)).error.reason, "runtime-artifact-outdated");
});
