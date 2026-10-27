import { deepEqual, equal, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  resolveWakeflowArtifactIdentity,
  wakeflowArtifactWriterOf,
} from "../../src/entrypoints/wakeflow-artifact-identity.js";
import {
  createWakeflowPublicMcpServer,
  WakeflowPublicMcpServerConfigurationError,
} from "../../src/entrypoints/wakeflow-public-mcp-server.js";
import { parseSha256Digest } from "../../src/foundation/crypto/sha256.js";
import { fail, WakeflowError } from "../../src/kernel/error.js";
import { useDisposableDurability } from "../support/disposable-durability.js";
import {
  connectWakeflowMcpServerForTest,
  defaultMcpExecutors,
  wakeflowMcpTextContent,
} from "./wakeflow-public-mcp-server.fixture.js";

useDisposableDurability();

test("a generated process reads its version once and refuses mutation if its manifest changed or disappeared", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-artifact-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "lib/entrypoints"), { recursive: true });
  mkdirSync(path.join(root, "mcp"));
  writeFileSync(path.join(root, "mcp/server.mjs"), "");
  const manifest = path.join(root, "artifact-manifest.json");
  writeFileSync(
    manifest,
    JSON.stringify({ kind: "WakeflowPluginArtifactManifest", version: "1.2.0" }),
  );
  const identity = resolveWakeflowArtifactIdentity(
    pathToFileURL(path.join(root, "lib/entrypoints/probe.js")).href,
  );
  equal(identity.version, "1.2.0");
  equal(typeof identity.manifestDigest, "string");
  identity.assertUnchanged();
  // The version axis is fixed at startup like the digest: a rewrite does not move it.
  writeFileSync(manifest, JSON.stringify({ version: "1.3.0" }));
  equal(identity.version, "1.2.0");
  throws(
    identity.assertUnchanged,
    (e: unknown) => e instanceof WakeflowError && e.reason === "runtime-artifact-outdated",
  );
  // A manifest without a usable version still identifies the artifact by digest.
  equal(
    resolveWakeflowArtifactIdentity(pathToFileURL(path.join(root, "lib/entrypoints/probe.js")).href)
      .version,
    "1.3.0",
  );
  writeFileSync(manifest, "next");
  const unversioned = resolveWakeflowArtifactIdentity(
    pathToFileURL(path.join(root, "lib/entrypoints/probe.js")).href,
  );
  equal(unversioned.version, null);
  equal(typeof unversioned.manifestDigest, "string");
  rmSync(manifest);
  throws(
    identity.assertUnchanged,
    (e: unknown) => e instanceof WakeflowError && e.reason === "runtime-artifact-unavailable",
  );
  equal(identity.readCurrentManifestDigest(), null);
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

test("the composition root maps the artifact identity to a writer stamp and the server hands it to every executor through the execution context (C11)", async (t) => {
  const manifestDigest = parseSha256Digest(`sha256:${"a".repeat(64)}`);
  deepEqual(wakeflowArtifactWriterOf({ version: "1.2.0", manifestDigest }), {
    version: "1.2.0",
    manifestDigest,
  });
  // No manifest, no version, or a version the stamp admission refuses: no stamp rather than a
  // failing commit later.
  equal(wakeflowArtifactWriterOf({ version: null, manifestDigest }), null);
  equal(wakeflowArtifactWriterOf({ version: "1.2.0", manifestDigest: null }), null);
  equal(wakeflowArtifactWriterOf({ version: "1.2.0+build.7", manifestDigest }), null);

  const writer = wakeflowArtifactWriterOf({ version: "1.2.0", manifestDigest });
  const seen: unknown[] = [];
  const probe = async (_value: unknown, context: { readonly writer: unknown }) => {
    seen.push(context.writer);
    return { kind: "probe" } as never;
  };
  for (const configured of [writer, null, undefined]) {
    const server = createWakeflowPublicMcpServer({
      serverName: "artifact-writer",
      serverVersion: "test",
      ...defaultMcpExecutors(),
      ...(configured === undefined ? {} : { writer: configured }),
      inspectStatus: probe,
    });
    const connection = await connectWakeflowMcpServerForTest(server);
    t.after(connection.close);
    const result = await connection.client.callTool({
      name: "wakeflow_status",
      arguments: { root: os.tmpdir() },
    });
    equal(result.isError, undefined);
  }
  deepEqual(seen, [writer, null, null]);
  throws(
    () =>
      createWakeflowPublicMcpServer({
        serverName: "artifact-writer",
        serverVersion: "test",
        ...defaultMcpExecutors(),
        writer: { version: "1.2.0" } as never,
      }),
    (error: unknown) =>
      error instanceof WakeflowPublicMcpServerConfigurationError && error.reason === "options",
  );
});
