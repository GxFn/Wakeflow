import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { runToolingCli } from "../../../tooling/cli.js";
import { inventoryDigest, snapshotLabTree } from "../../../tooling/lab/inventory.js";
import { createLab, disposeLab, inspectLab, runLab } from "../../../tooling/lab/lab.js";
import { type LabToolObservation, withLabMcp } from "../../../tooling/lab/mcp-session.js";
import { sha256 } from "../../../tooling/verification/files.js";

function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-lab-integration-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repository = path.join(base, "Repository");
  mkdirSync(repository);
  return { base, repository, root: path.join(base, "Lab") };
}

for (const host of ["codex", "claude-code"]) {
  test(`generated ${host} artifact creates an isolated dual-product lab, checks readiness and disposes only its frozen inventory`, {
    timeout: 180_000,
  }, async (t) => {
    const { base, repository, root } = fixture(t);
    const created = await createLab(
      repository,
      root,
      path.join(process.cwd(), `plugins/${host}-wakeflow`),
    );
    equal(created.status, "passed", JSON.stringify(created));
    const resources = JSON.parse(
      readFileSync(path.join(repository, ".build/labs", created.id, "resources.json"), "utf8"),
    );
    equal(resources.artifact.hostId, host);
    equal(resources.git.length, 3);
    for (const git of resources.git) ok(/^[a-f0-9]{40,64}$/u.test(git.head));
    const config = JSON.parse(
      readFileSync(path.join(root, "Workspace/wakeflow.config.json"), "utf8"),
    );
    equal(config.topology.repositories.length, 2);
    equal(config.topology.windows.length, 5);
    equal(created.classification.nativeHostAcceptance, "unverified");
    equal(created.classification.durability, "fsync");
    const before = inventoryDigest(snapshotLabTree(root));
    const inspected = inspectLab(repository, created.id);
    equal(inspected.status, "passed", JSON.stringify(inspected));
    equal(inventoryDigest(snapshotLabTree(root)), before);
    const run = await runLab(repository, created.id);
    equal(run.status, "passed", JSON.stringify(run));
    const evidence = readFileSync(path.join(repository, run.receipt), "utf8");
    equal(evidence.includes(base), false);
    equal(JSON.parse(evidence).acts.length, 6);
    equal(inventoryDigest(snapshotLabTree(root)), before);
    const again = await runLab(repository, created.id);
    equal(again.status, "passed", JSON.stringify(again));
    ok(run.receipt !== again.receipt);
    const aborted = new AbortController();
    aborted.abort();
    const interrupted = await runLab(repository, created.id, aborted.signal);
    equal(interrupted.status, "interrupted");
    equal(interrupted.exitCode, 130);
    equal(inventoryDigest(snapshotLabTree(root)), before);
    const preview = await disposeLab(repository, created.id);
    ok("planDigest" in preview);
    equal(inventoryDigest(snapshotLabTree(root)), before);
    await rejects(
      disposeLab(repository, created.id, `sha256:${"0".repeat(64)}`),
      /lab-disposal-plan-stale/u,
    );
    writeFileSync(path.join(root, "user-notes.txt"), "keep this");
    const driftedRun = await runLab(repository, created.id);
    equal(driftedRun.status, "failed");
    equal(driftedRun.reason, "lab-resource-drift");
    equal(
      JSON.parse(readFileSync(path.join(repository, driftedRun.receipt), "utf8")).observations
        .length,
      0,
    );
    await rejects(disposeLab(repository, created.id, preview.planDigest), /lab-resource-drift/u);
    equal(readFileSync(path.join(root, "user-notes.txt"), "utf8"), "keep this");
    rmSync(path.join(root, "user-notes.txt"));
    writeFileSync(path.join(root, "Alpha/.git/refs/heads/unhandled"), `${"0".repeat(40)}\n`);
    equal(inspectLab(repository, created.id).status, "unavailable");
    await rejects(disposeLab(repository, created.id, preview.planDigest), /lab-resource-drift/u);
    rmSync(path.join(root, "Alpha/.git/refs/heads/unhandled"));
    const lock = path.join(repository, ".build/labs", created.id, "operation.lock");
    writeFileSync(lock, "unknown owner");
    await rejects(runLab(repository, created.id), /lab-operation-in-progress-or-interrupted/u);
    equal(inspectLab(repository, created.id).status, "unavailable");
    equal(readFileSync(lock, "utf8"), "unknown owner");
    rmSync(lock);
    const disposed = await disposeLab(repository, created.id, preview.planDigest);
    equal(disposed.status, "passed");
    equal(existsSync(root), false);
    equal(existsSync(path.join(repository, run.receipt)), true);
    await rejects(runLab(repository, created.id), /lab-already-disposed/u);
  });
}

test("lab creation refuses existing roots, repository children and symlinked parents without writes", async (t) => {
  const { base, repository, root } = fixture(t);
  const candidate = path.join(process.cwd(), "plugins/codex-wakeflow");
  mkdirSync(root);
  await rejects(createLab(repository, root, candidate), /lab-root-already-exists/u);
  await rejects(
    createLab(repository, path.join(repository, "Lab"), candidate),
    /lab-root-not-disposable/u,
  );
  mkdirSync(path.join(root, ".git"));
  await rejects(createLab(repository, path.join(root, "Lab"), candidate), /lab-root-inside-git/u);
  symlinkSync(root, path.join(base, "Alias"));
  await rejects(
    createLab(repository, path.join(base, "Alias", "Lab"), candidate),
    /lab-noncanonical-root/u,
  );
  equal(existsSync(path.join(repository, ".build")), false);
});

test("failed MCP startup retains a labelled creation receipt and never acquires automatic cleanup ownership", async (t) => {
  const { base, repository, root } = fixture(t);
  const candidate = path.join(base, "BrokenArtifact");
  mkdirSync(path.join(candidate, "mcp"), { recursive: true });
  const content = "process.exit(1);\n";
  writeFileSync(path.join(candidate, "mcp/server.mjs"), content, { mode: 0o644 });
  writeFileSync(
    path.join(candidate, "artifact-manifest.json"),
    JSON.stringify({
      kind: "WakeflowPluginArtifactManifest",
      version: "1.1.0-rc.5",
      hostId: "codex",
      files: [
        {
          path: "mcp/server.mjs",
          bytes: Buffer.byteLength(content),
          sha256: sha256(content),
          mode: "0644",
        },
      ],
    }),
  );
  const created = await createLab(repository, root, candidate);
  equal(created.status, "unavailable");
  equal(existsSync(root), true);
  const receipt = JSON.parse(readFileSync(path.join(repository, created.receipt), "utf8"));
  equal(receipt.cleanup, "retained-for-manual-inspection");
  equal(existsSync(path.join(repository, ".build/labs", created.id, "resources.json")), false);
  await rejects(disposeLab(repository, created.id), /ENOENT/u);
});

test("lab MCP observations keep stable error codes while excluding arbitrary error payloads", async (t) => {
  const { root } = fixture(t);
  mkdirSync(root);
  const observations: LabToolObservation[] = [];
  await rejects(
    withLabMcp(
      path.join(process.cwd(), "plugins/codex-wakeflow"),
      root,
      observations,
      async (call) => {
        await call("wakeflow_maintain_workspace", {
          root,
          action: "fresh-initialize",
          mode: "preview",
          request: { selection: {} },
        });
      },
    ),
    /lab-mcp-tool-failed/u,
  );
  equal(observations.length, 1);
  equal(observations[0]?.status, "failed");
  equal(observations[0]?.mcpError?.code, "invalid-request");
  equal(JSON.stringify(observations).includes(root), false);
});

test("cancelling a stalled stdio handshake closes the owned child and settles interruption", {
  timeout: 15_000,
}, async (t) => {
  const { base } = fixture(t);
  const artifact = path.join(base, "HungArtifact");
  mkdirSync(path.join(artifact, "mcp"), { recursive: true });
  const pidFile = path.join(base, "child.pid");
  writeFileSync(
    path.join(artifact, "mcp/server.mjs"),
    "import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{});writeFileSync(new URL('../../child.pid',import.meta.url),String(process.pid));setInterval(()=>{},1000);\n",
  );
  const controller = new AbortController();
  let entered = false;
  const call = withLabMcp(
    artifact,
    base,
    [],
    async () => {
      entered = true;
    },
    controller.signal,
  );
  // Poll only for this child handshake checkpoint; no timing assumption about process startup.
  const deadline = Date.now() + 5000;
  while (!existsSync(pidFile) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  ok(existsSync(pidFile));
  const pid = Number(readFileSync(pidFile, "utf8"));
  t.after(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Already reaped. */
    }
  });
  controller.abort();
  await rejects(call);
  equal(entered, false);
  let running = true;
  try {
    process.kill(pid, 0);
  } catch {
    running = false;
  }
  equal(running, false, "the child must be gone before the lab releases its operation lock");
});

test("lab CLI requires explicit creation scope and preview-or-digest disposal; invalid commands have no effects", async (t) => {
  const { repository } = fixture(t);
  for (const args of [
    ["lab", "create", "--candidate", "artifact"],
    ["lab", "dispose", "--id", "id"],
    ["lab", "dispose", "--id", "id", "--preview", "yes"],
    ["lab", "dispose", "--id", "id", "--preview", "--plan-digest", "digest"],
    ["lab", "run", "--id", "../../outside"],
    ["lab", "inspect", "--id", "id", "--candidate", "artifact"],
  ])
    await rejects(runToolingCli(args, repository));
  deepEqual(
    snapshotLabTree(repository).map((entry) => entry.path),
    [""],
  );
});

test("unverified stdio shutdown keeps the lab lock and failure evidence instead of permitting cleanup", {
  timeout: 15_000,
}, async (t) => {
  const { base, repository, root } = fixture(t);
  const candidate = path.join(base, "StalledArtifact");
  mkdirSync(path.join(candidate, "mcp"), { recursive: true });
  const content =
    "import {writeFileSync} from 'node:fs';writeFileSync(new URL('../../child.pid',import.meta.url),String(process.pid));setInterval(()=>{},1000);\n";
  writeFileSync(path.join(candidate, "mcp/server.mjs"), content, { mode: 0o644 });
  writeFileSync(
    path.join(candidate, "artifact-manifest.json"),
    JSON.stringify({
      kind: "WakeflowPluginArtifactManifest",
      version: "1.1.0-rc.5",
      hostId: "codex",
      files: [
        {
          path: "mcp/server.mjs",
          bytes: Buffer.byteLength(content),
          sha256: sha256(content),
          mode: "0644",
        },
      ],
    }),
  );
  // Inject only a transport settlement failure, never a public Wakeflow fault switch.
  t.mock.method(StdioClientTransport.prototype, "close", async () => {});
  const controller = new AbortController();
  const pending = createLab(repository, root, candidate, controller.signal);
  const rejected = rejects(pending, /lab-mcp-shutdown-unverified/u);
  const pidFile = path.join(root, "child.pid");
  const deadline = Date.now() + 5000;
  while (!existsSync(pidFile) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  ok(existsSync(pidFile));
  const pid = Number(readFileSync(pidFile, "utf8"));
  t.after(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Already reaped. */
    }
  });
  controller.abort();
  await rejected;
  const labs = path.join(repository, ".build/labs");
  const [id] = readdirSync(labs);
  ok(id !== undefined);
  equal(existsSync(path.join(labs, id, "operation.lock")), true);
  equal(
    JSON.parse(readFileSync(path.join(labs, id, "creation.json"), "utf8")).reason,
    "lab-mcp-shutdown-unverified",
  );
  equal(existsSync(root), true);
});
