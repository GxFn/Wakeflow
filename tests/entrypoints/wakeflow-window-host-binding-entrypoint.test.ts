import { equal, match } from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  Client,
  InMemoryTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";

import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { executeCodexWakeflowMaintenance } from "../../src/entrypoints/codex-wakeflow-maintenance.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME } from "../../src/workspace/window-runtime/wakeflow-window-host-binding-public-contract.js";
import { createMinimalWakeflowFreshConfigSelection } from "../configuration/wakeflow-fresh-config-selection.fixture.js";

async function fixture(t: TestContext): Promise<string> {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-window-binding-public-")),
  );
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (initialized.status !== 0)
    throw new Error("Cannot initialize fixture Git.");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function selection() {
  const value = createMinimalWakeflowFreshConfigSelection();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return value;
}

function textContent(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("Expected MCP text content.");
  return first.text;
}

test(
  "Maintenance launch intent 经 Agent result 注册为私有 Binding 与脱敏投影",
  {
    timeout: 30_000,
  },
  async (t) => {
    const root = await fixture(t);
    const preview = await executeCodexWakeflowMaintenance({
      root,
      action: "fresh-initialize",
      mode: "preview",
      request: { selection: selection() },
    });
    if (
      preview.mode !== "preview" ||
      preview.confirmation === null ||
      preview.confirmationDigest === null
    ) {
      throw new Error("Expected a ready Fresh confirmation.");
    }
    await executeCodexWakeflowMaintenance({
      root,
      mode: "apply",
      confirmation: preview.confirmation,
      confirmationDigest: preview.confirmationDigest,
    });
    const launchIntent = preview.launchIntents[0];
    const otherIntent = preview.launchIntents[1];
    const recoveryIntent = preview.launchIntents[2];
    const concurrentIntent = preview.launchIntents[3];
    if (
      launchIntent === undefined ||
      otherIntent === undefined ||
      recoveryIntent === undefined ||
      concurrentIntent === undefined
    ) {
      throw new Error("Expected four launch intents.");
    }

    const server = createCodexWakeflowMcpServer("1.0.0-test");
    const client = new Client({
      name: "wakeflow-window-binding-integration-test",
      version: "1.0.0-test",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    t.after(async () => {
      await Promise.allSettled([client.close(), server.close()]);
    });

    const rawHandle = "codex-host-owned-thread:opaque-7";
    const observedAt = new Date(Date.now() - 1_000).toISOString();
    const observation = {
      kind: "WakeflowAgentHostWindowCreationObservation",
      schemaVersion: 1,
      source: "agent-host-create-result",
      hostId: "codex",
      windowId: launchIntent.windowId,
      launchIntentDigest: launchIntent.intentDigest,
      handle: { kind: "codex-thread", value: rawHandle },
      observedAt,
    } as const;
    const registered = await client.callTool({
      name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      arguments: { root, observation },
    });
    equal(registered.isError, undefined);
    const publicValue = JSON.parse(textContent(registered)) as {
      readonly disposition: string;
      readonly binding: {
        readonly bindingId: string;
        readonly bindingRef: string;
        readonly registeredAt: string;
        readonly source: { readonly observedAt: string };
      };
      readonly projection: { readonly resourceRef: string };
    };
    equal(publicValue.disposition, "registered");
    equal(textContent(registered).includes(rawHandle), false);
    equal(textContent(registered).includes('"bindingDigest"'), false);
    equal(textContent(registered).includes(root), false);

    const bindingFile = path.join(
      root,
      ...publicValue.binding.bindingRef.split("/"),
    );
    const projectionFile = path.join(
      root,
      ...publicValue.projection.resourceRef.split("/"),
    );
    equal(existsSync(bindingFile), true);
    equal(statSync(bindingFile).mode & 0o777, 0o600);
    equal(readFileSync(bindingFile, "utf8").includes(rawHandle), true);
    const projectionText = readFileSync(projectionFile, "utf8");
    equal(projectionText.includes(rawHandle), false);
    equal(projectionText.includes('"handle"'), false);
    match(projectionText, /"status": "registered"/u);
    match(projectionText, /"code": "root-unobserved"/u);

    const replayed = await client.callTool({
      name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      arguments: {
        root,
        observation: {
          ...observation,
          observedAt: new Date(Date.parse(observedAt) + 500).toISOString(),
        },
      },
    });
    equal(replayed.isError, undefined);
    const replayedValue = JSON.parse(textContent(replayed)) as {
      readonly disposition: string;
      readonly binding: {
        readonly bindingId: string;
        readonly registeredAt: string;
        readonly source: { readonly observedAt: string };
      };
    };
    equal(replayedValue.disposition, "replayed");
    equal(replayedValue.binding.bindingId, publicValue.binding.bindingId);
    equal(replayedValue.binding.registeredAt, publicValue.binding.registeredAt);
    equal(
      replayedValue.binding.source.observedAt,
      publicValue.binding.source.observedAt,
    );

    const conflict = await client.callTool({
      name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      arguments: {
        root,
        observation: {
          ...observation,
          windowId: otherIntent.windowId,
          launchIntentDigest: otherIntent.intentDigest,
        },
      },
    });
    equal(conflict.isError, true);
    match(textContent(conflict), /"causeReason":"handle-conflict"/u);
    equal(textContent(conflict).includes(rawHandle), false);

    const recoveryProjectionFile = path.join(
      root,
      ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
      `${recoveryIntent.windowId}.json`,
    );
    const unregisteredProjection = readFileSync(recoveryProjectionFile, "utf8");
    writeFileSync(recoveryProjectionFile, '{\n  "foreign": true\n}\n', "utf8");
    const recoveryObservation = {
      ...observation,
      windowId: recoveryIntent.windowId,
      launchIntentDigest: recoveryIntent.intentDigest,
      handle: {
        kind: "codex-thread",
        value: "codex-host-owned-thread:opaque-recovery",
      },
    } as const;
    const partial = await client.callTool({
      name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      arguments: { root, observation: recoveryObservation },
    });
    equal(partial.isError, true);
    match(textContent(partial), /"bindingAuthority":"current"/u);
    match(textContent(partial), /"causeReason":"projection-conflict"/u);
    equal(
      existsSync(
        path.join(
          root,
          ".wakeflow-local/runtime/hosts/codex/identity/window-bindings",
          `${recoveryIntent.windowId}.json`,
        ),
      ),
      true,
    );

    writeFileSync(recoveryProjectionFile, unregisteredProjection, "utf8");
    const repaired = await client.callTool({
      name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      arguments: { root, observation: recoveryObservation },
    });
    equal(repaired.isError, undefined);
    match(textContent(repaired), /"disposition":"replayed"/u);
    match(
      readFileSync(recoveryProjectionFile, "utf8"),
      /"status": "registered"/u,
    );

    const concurrentObservation = {
      ...observation,
      windowId: concurrentIntent.windowId,
      launchIntentDigest: concurrentIntent.intentDigest,
      handle: {
        kind: "codex-thread",
        value: "codex-host-owned-thread:opaque-concurrent",
      },
    } as const;
    const concurrentProjectionFile = path.join(
      root,
      ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
      `${concurrentIntent.windowId}.json`,
    );
    unlinkSync(concurrentProjectionFile);
    const concurrentResults = await Promise.all([
      client.callTool({
        name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
        arguments: { root, observation: concurrentObservation },
      }),
      client.callTool({
        name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
        arguments: { root, observation: concurrentObservation },
      }),
    ]);
    equal(
      concurrentResults.every((result) => result.isError === undefined),
      true,
    );
    const concurrentValues = concurrentResults.map(
      (result) =>
        JSON.parse(textContent(result)) as {
          readonly disposition: "registered" | "replayed";
          readonly binding: { readonly bindingId: string };
        },
    );
    equal(
      concurrentValues
        .map((value) => value.disposition)
        .sort()
        .join(","),
      "registered,replayed",
    );
    equal(
      new Set(concurrentValues.map((value) => value.binding.bindingId)).size,
      1,
    );
    match(
      readFileSync(concurrentProjectionFile, "utf8"),
      /"status": "registered"/u,
    );

    const rollbackObservation = {
      ...observation,
      windowId: otherIntent.windowId,
      launchIntentDigest: otherIntent.intentDigest,
      handle: {
        kind: "codex-thread",
        value: "codex-host-owned-thread:opaque-future",
      },
      observedAt: new Date(Date.now() + 60_000).toISOString(),
    } as const;
    const rollbackRegistration = await client.callTool({
      name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      arguments: { root, observation: rollbackObservation },
    });
    equal(rollbackRegistration.isError, undefined);
    const rollbackValue = JSON.parse(textContent(rollbackRegistration)) as {
      readonly disposition: string;
      readonly binding: {
        readonly bindingRef: string;
        readonly registeredAt: string;
        readonly source: { readonly observedAt: string };
      };
    };
    equal(rollbackValue.disposition, "registered");
    equal(
      rollbackValue.binding.registeredAt <
        rollbackValue.binding.source.observedAt,
      true,
    );
    equal(
      existsSync(
        path.join(root, ...rollbackValue.binding.bindingRef.split("/")),
      ),
      true,
    );

    const invalidBinding = JSON.parse(readFileSync(bindingFile, "utf8")) as {
      handle: { kind: string };
    };
    invalidBinding.handle.kind = "claude-session";
    writeFileSync(bindingFile, `${JSON.stringify(invalidBinding, null, 2)}\n`);
    const invalidInventory = await client.callTool({
      name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      arguments: {
        root,
        observation: {
          ...rollbackObservation,
          observedAt,
        },
      },
    });
    equal(invalidInventory.isError, true);
    match(textContent(invalidInventory), /"causeReason":"inventory"/u);
    equal(textContent(invalidInventory).includes("claude-session"), false);
  },
);
