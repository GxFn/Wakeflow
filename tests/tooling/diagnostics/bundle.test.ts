import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { canonicalDigest } from "../../../tooling/capture/io.js";
import { runToolingCli } from "../../../tooling/cli.js";
import {
  collectDiagnosticBundle,
  diagnosticDirectory,
  inspectDiagnosticBundle,
  readDiagnosticBundle,
} from "../../../tooling/diagnostics/bundle.js";
import {
  exportDiagnosticSummary,
  inspectDiagnosticSummary,
} from "../../../tooling/diagnostics/public-summary.js";
import { inventoryDigest, snapshotLabTree } from "../../../tooling/lab/inventory.js";
import { createLab } from "../../../tooling/lab/lab.js";
import { sha256 } from "../../../tooling/verification/files.js";

function json(file: string, value: unknown) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function read(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}
function object(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw Error("fixture object");
  return value as Record<string, unknown>;
}

function fixture(t: TestContext, onCall?: (name: string) => void) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-diagnostic-bundle-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repository = path.join(base, "Reports"),
    root = path.join(base, "Workspace");
  mkdirSync(repository);
  mkdirSync(root);
  const candidate = path.join(process.cwd(), "plugins/codex-wakeflow");
  // The mock only supplies public tool values; actual stdio startup/shutdown still runs.
  writeFileSync(
    path.join(root, "wakeflow.config.json"),
    '{"fixture":"raw config is not parsed by the collector"}\n',
  );
  const attachment = path.join(root, "hook-file.bin");
  writeFileSync(attachment, Buffer.from([0xff, 0, 13, 10, 65]));
  const observedAt = "2026-10-04T14:00:00.000Z";
  const digest = `sha256:${"b".repeat(64)}`;
  const status = {
    kind: "WakeflowStatus",
    observedAt,
    config: { configDigest: digest },
    truncated: {
      windows: 0,
      demands: 0,
      claims: 0,
      pods: 0,
      repositories: 0,
      archives: 0,
      unmergedAccepted: 0,
      worktrees: 0,
    },
    overall: "idle",
    runtime: {
      artifactManifestDigest: sha256(readFileSync(path.join(candidate, "artifact-manifest.json"))),
      artifactOnDisk: "same",
    },
    maintenance: { protocol: "idle", residues: [] },
    demands: [],
    claims: [],
    hooks: [],
    windows: [],
  };
  const verify = {
    kind: "WakeflowVerification",
    observedAt,
    configDigest: digest,
    ok: true,
    summary: { pass: 1, fail: 0, unavailable: 0 },
    gates: [{ name: "config-authority", status: "pass", code: null }],
    next: { frontier: null, owner: "none" },
  };
  const calls: string[] = [];
  t.mock.method(Client.prototype, "callTool", async (...args: Parameters<Client["callTool"]>) => {
    const name = args[0].name;
    ok(name === "wakeflow_status" || name === "wakeflow_verify");
    calls.push(name);
    onCall?.(name);
    const body = name === "wakeflow_status" ? status : verify;
    return { structuredContent: body, content: [{ type: "text", text: JSON.stringify(body) }] };
  });
  return { base, repository, root, candidate, attachment, calls, status, verify };
}

function resealProbe(
  repository: string,
  id: string,
  mutate: (probe: Record<string, unknown>) => void,
) {
  const dir = diagnosticDirectory(repository, id);
  const probe = read(path.join(dir, "probe.json"));
  mutate(probe);
  json(path.join(dir, "probe.json"), probe);
  const manifest = read(path.join(dir, "bundle.json"));
  const { bundleDigest: _old, ...body } = manifest;
  body.probeDigest = sha256(readFileSync(path.join(dir, "probe.json")));
  const bundleDigest = canonicalDigest(body);
  json(path.join(dir, "bundle.json"), { ...body, bundleDigest });
  json(path.join(dir, "ready.json"), { kind: "WakeflowDiagnosticSeal", bundleDigest });
}

function reportWithDigest(value: Record<string, unknown>) {
  const { reportDigest: _old, ...body } = value;
  return { ...body, reportDigest: canonicalDigest(body) };
}

test("private collection keeps exact binary bytes and source identity; inspection/export survive removed originals", async (t) => {
  const f = fixture(t);
  const before = inventoryDigest(snapshotLabTree(f.root));
  const result = await collectDiagnosticBundle(f.repository, f.root, f.candidate, [
    "hook-file.bin",
  ]);
  equal(result.status, "passed", JSON.stringify(result));
  equal(result.nativeHostAcceptance, "unverified");
  deepEqual(f.calls, ["wakeflow_status", "wakeflow_verify"]);
  equal(inventoryDigest(snapshotLabTree(f.root)), before);
  const bundle = readDiagnosticBundle(f.repository, result.id);
  const dir = diagnosticDirectory(f.repository, result.id);
  deepEqual(readFileSync(path.join(dir, "sources/2.bin")), readFileSync(f.attachment));
  if (process.platform !== "win32") {
    equal(statSync(dir).mode & 0o777, 0o700);
    equal(statSync(path.join(dir, "sources/2.bin")).mode & 0o777, 0o600);
  }
  equal(bundle.collection.coherent, true);
  rmSync(f.root, { recursive: true });
  equal(inspectDiagnosticBundle(f.repository, result.id).integrity, "matched");
  const exported = exportDiagnosticSummary(f.repository, result.id);
  const file = path.join(f.repository, exported.file);
  equal(inspectDiagnosticSummary(file).status, "matched");
  const publicText = readFileSync(file, "utf8");
  equal(publicText.includes(f.base), false);
  equal(publicText.includes("hook-file.bin"), false);
  equal(publicText.includes("raw config"), false);
  equal(exported.uploaded, false);
});

test("explicit missing, linked and oversized sources remain unavailable while private collection is retained", async (t) => {
  const f = fixture(t);
  symlinkSync(f.attachment, path.join(f.root, "link.bin"));
  linkSync(f.attachment, path.join(f.root, "hard.bin"));
  writeFileSync(path.join(f.root, "large.bin"), Buffer.alloc(4 * 1024 * 1024 + 1));
  const r = await collectDiagnosticBundle(f.repository, f.root, f.candidate, [
    "missing.bin",
    "link.bin",
    "hard.bin",
    "large.bin",
  ]);
  equal(r.status, "unavailable");
  equal(r.bundleSealed, true);
  const bundle = readDiagnosticBundle(f.repository, r.id);
  equal(bundle.collection.unavailable, 4);
  equal(inspectDiagnosticBundle(f.repository, r.id).status, "matched");
  const e = exportDiagnosticSummary(f.repository, r.id);
  const report = read(path.join(f.repository, e.file));
  equal(report.status, "unavailable");
  equal(report.diagnosisStatus, "passed");
  equal(inspectDiagnosticSummary(path.join(f.repository, e.file)).status, "matched");
});

test("total source budget is enforced without truncating copies or making a partial collection green", async (t) => {
  const f = fixture(t);
  const files = Array.from({ length: 9 }, (_, i) => `large-${i}.bin`);
  const bytes = Buffer.alloc(4 * 1024 * 1024, 65);
  for (const file of files) writeFileSync(path.join(f.root, file), bytes);
  const r = await collectDiagnosticBundle(f.repository, f.root, f.candidate, files);
  const bundle = readDiagnosticBundle(f.repository, r.id);
  equal(r.status, "unavailable");
  ok(bundle.sources.some((s) => s.issue === "source-budget"));
  for (const s of bundle.sources.filter(
    (s) => s.alias.startsWith("attachment-") && s.file !== null,
  ))
    equal(s.observation?.bytes, bytes.length);
  ok(bundle.sources.reduce((n, s) => n + (s.observation?.bytes ?? 0), 0) <= 32 * 1024 * 1024);
});

test("replacement during read-only observations preserves the first bytes but marks the source incoherent", async (t) => {
  let attachment = "";
  const f = fixture(t, (name) => {
    if (name !== "wakeflow_status") return;
    writeFileSync(`${attachment}.next`, readFileSync(attachment));
    renameSync(`${attachment}.next`, attachment);
  });
  attachment = f.attachment;
  const r = await collectDiagnosticBundle(f.repository, f.root, f.candidate, ["hook-file.bin"]);
  equal(r.status, "unavailable");
  const bundle = readDiagnosticBundle(f.repository, r.id);
  equal(bundle.collection.changed, 1);
  equal(bundle.sources[2]?.issue, "source-changed");
  equal(bundle.sources[2]?.observation?.digest, sha256(readFileSync(f.attachment)));
});

test("unknown files, altered copies and missing seals are never silently repaired or exported", async (t) => {
  const f = fixture(t);
  const r = await collectDiagnosticBundle(f.repository, f.root, f.candidate, ["hook-file.bin"]);
  const dir = diagnosticDirectory(f.repository, r.id);
  writeFileSync(path.join(dir, "unknown"), "keep");
  equal(inspectDiagnosticBundle(f.repository, r.id).status, "unavailable");
  throws(() => exportDiagnosticSummary(f.repository, r.id));
  equal(readFileSync(path.join(dir, "unknown"), "utf8"), "keep");
  rmSync(path.join(dir, "unknown"));
  const copy = path.join(dir, "sources/2.bin");
  const original = readFileSync(copy);
  writeFileSync(copy, "changed");
  equal(inspectDiagnosticBundle(f.repository, r.id).status, "unavailable");
  writeFileSync(copy, original);
  const ready = path.join(dir, "ready.json");
  rmSync(ready);
  equal(inspectDiagnosticBundle(f.repository, r.id).status, "unavailable");
  throws(() => exportDiagnosticSummary(f.repository, r.id));
  equal(existsSync(ready), false);
  equal(existsSync(path.join(f.repository, ".build/diagnostics/exports")), false);
});

test("self-consistent checksums cannot turn a missing or duplicated probe sequence into successful collection evidence", async (t) => {
  const f = fixture(t);
  const r = await collectDiagnosticBundle(f.repository, f.root, f.candidate);
  const original = read(path.join(diagnosticDirectory(f.repository, r.id), "probe.json"));
  for (const mode of ["missing", "duplicate", "missing-result"]) {
    resealProbe(f.repository, r.id, (probe) => {
      Object.assign(probe, structuredClone(original));
      const calls = probe.observations as Record<string, unknown>[];
      const first = calls[0];
      ok(first);
      if (mode === "missing") probe.observations = [];
      else if (mode === "duplicate") probe.observations = [first, first];
      else delete first.result;
    });
    equal(inspectDiagnosticBundle(f.repository, r.id).status, "unavailable");
    throws(() => exportDiagnosticSummary(f.repository, r.id));
  }
});

test("early cancellation creates nothing; cancellation during a probe retains an explicitly incomplete observation", async (t) => {
  const signal = new AbortController();
  const f = fixture(t, () => signal.abort());
  const early = new AbortController();
  early.abort();
  await rejects(collectDiagnosticBundle(f.repository, f.root, f.candidate, [], early.signal));
  equal(existsSync(path.join(f.repository, ".build")), false);
  const r = await collectDiagnosticBundle(
    f.repository,
    f.root,
    f.candidate,
    ["hook-file.bin"],
    signal.signal,
  );
  equal(r.status, "interrupted");
  equal(r.exitCode, 130);
  equal(r.bundleSealed, true);
  const bundle = readDiagnosticBundle(f.repository, r.id);
  equal(bundle.diagnosisStatus, "interrupted");
  ok(bundle.collection.notRechecked > 0);
  equal(inspectDiagnosticBundle(f.repository, r.id).status, "matched");
});

test("failed second observation and invalid candidate retain useful private input without claiming successful diagnosis", async (t) => {
  const f = fixture(t, (name) => {
    if (name === "wakeflow_verify") throw new Error("sensitive-private-failure");
  });
  const r = await collectDiagnosticBundle(f.repository, f.root, f.candidate, []);
  equal(r.status, "unavailable");
  equal(r.bundleSealed, true);
  equal(JSON.stringify(r).includes("sensitive-private-failure"), false);
  const bundle = readDiagnosticBundle(f.repository, r.id);
  equal((bundle.probe.observations as unknown[]).length, 2);
  equal(
    object(object(bundle.probe.diagnosis).artifact).manifestDigest,
    sha256(readFileSync(path.join(f.candidate, "artifact-manifest.json"))),
  );
  const invalid = await collectDiagnosticBundle(
    f.repository,
    f.root,
    path.join(f.base, "MissingArtifact"),
  );
  equal(invalid.status, "unavailable");
  equal(invalid.bundleSealed, true);
  equal(readDiagnosticBundle(f.repository, invalid.id).sources[1]?.issue, "source-unavailable");
});

test("private strings in known slots and self-declared native verification do not enter the sharing projection", async (t) => {
  const f = fixture(t);
  const r = await collectDiagnosticBundle(f.repository, f.root, f.candidate, []);
  const secret = "sensitive-private-lowercase-token";
  resealProbe(f.repository, r.id, (probe) => {
    const diagnosis = object(probe.diagnosis),
      facts = object(diagnosis.facts);
    diagnosis.nativeHostAcceptance = "verified";
    diagnosis.hostSelection = secret;
    object(diagnosis.artifact).version = `1.0.0-${secret}`;
    object(diagnosis.artifact).hostId = secret;
    facts.overall = secret;
    facts.next = { owner: secret, frontier: secret };
    const gates = object(facts.verification).gates as Record<string, unknown>[];
    gates[0] = { ...gates[0], name: secret, code: secret, evidence: [{ ref: secret }] };
    diagnosis.raw = { transcript: secret, threadId: secret, cwd: secret };
  });
  const e = exportDiagnosticSummary(f.repository, r.id);
  const file = path.join(f.repository, e.file),
    text = readFileSync(file, "utf8"),
    report = read(file);
  equal(text.includes(secret), false);
  equal(text.includes('"verified"'), false);
  equal(report.nativeHostAcceptance, "unverified");
  equal(report.hostSelection, "not-observed");
  equal((report.gates as Record<string, unknown>[])[0]?.name, "other");
  equal(inspectDiagnosticSummary(file).status, "matched");
});

test("a public checksum does not admit extra fields, inconsistent counts or forged verified claims", async (t) => {
  const f = fixture(t),
    r = await collectDiagnosticBundle(f.repository, f.root, f.candidate);
  const e = exportDiagnosticSummary(f.repository, r.id),
    file = path.join(f.repository, e.file),
    original = read(file);
  const mutations: ((value: Record<string, unknown>) => void)[] = [
    (value) => {
      value.privatePrompt = "secret-fixture";
    },
    (value) => {
      value.nativeHostAcceptance = "verified";
    },
    (value) => {
      object(value.gateCounts).pass = 999;
    },
    (value) => {
      object(value.collection).coherent = false;
    },
    (value) => {
      object(value.observer).configMatches = false;
    },
    (value) => {
      object(value.observer).callsSucceeded = 0;
    },
    (value) => {
      object(value.observer).candidateHost = null;
    },
    (value) => {
      object(value.observer).statusObservedAt = null;
    },
    (value) => {
      const first = (value.gates as Record<string, unknown>[])[0];
      ok(first);
      first.name = "secret-fixture";
    },
    (value) => {
      value.recordedAt = "2026-02-30T10:00:00.000Z";
    },
  ];
  for (const change of mutations) {
    const value = structuredClone(original);
    change(value);
    json(file, reportWithDigest(value));
    equal(inspectDiagnosticSummary(file).status, "unavailable");
  }
  json(file, original);
  equal(inspectDiagnosticSummary(file).status, "matched");
});

test("private readiness publication failure remains incomplete and cannot acquire export eligibility", async (t) => {
  let repository = "";
  const f = fixture(t, () => {
    const bundles = path.join(repository, ".build/diagnostics/bundles");
    const id = snapshotLabTree(bundles).find(
      (row) => row.path !== "" && !row.path.includes("/") && row.kind === "directory",
    )?.path;
    ok(id);
    const file = path.join(bundles, id, "ready.json");
    if (!existsSync(file)) writeFileSync(file, "unknown partial seal", { flag: "wx" });
  });
  repository = f.repository;
  const r = await collectDiagnosticBundle(f.repository, f.root, f.candidate);
  equal(r.bundleSealed, false);
  equal(r.status, "unavailable");
  equal(inspectDiagnosticBundle(f.repository, r.id).status, "unavailable");
  throws(() => exportDiagnosticSummary(f.repository, r.id));
  equal(
    readFileSync(path.join(diagnosticDirectory(f.repository, r.id), "ready.json"), "utf8"),
    "unknown partial seal",
  );
});

test("CLI rejects ambiguous actions, traversal, duplicate sources and output overlap before creating a bundle", async (t) => {
  const f = fixture(t);
  for (const args of [
    ["doctor", "collect", "--root", f.root],
    ["doctor", "inspect", "--id", "bad", "--input", "bad"],
    ["doctor", "export", "--id", "bad", "--files", "extra"],
  ])
    await rejects(runToolingCli(args, f.repository));
  for (const files of [
    ["../outside"],
    [f.attachment],
    ["wakeflow.config.json"],
    ["hook-file.bin", "hook-file.bin"],
    [".git/config"],
  ])
    await rejects(collectDiagnosticBundle(f.repository, f.root, f.candidate, files));
  await rejects(collectDiagnosticBundle(f.root, f.root, f.candidate));
  equal(existsSync(path.join(f.repository, ".build")), false);
  equal(f.calls.length, 0);
});

test("real generated collection preserves workspace bytes and explicitly injected private-file mode drift", {
  timeout: 120_000,
}, async (t) => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-diagnostic-real-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repository = path.join(base, "Reports");
  mkdirSync(repository);
  const lab = path.join(base, "Lab"),
    candidate = path.join(process.cwd(), "plugins/codex-wakeflow");
  equal((await createLab(repository, lab, candidate, t.signal)).status, "passed");
  const root = path.join(lab, "Workspace");
  writeFileSync(path.join(root, "Test/trace.bin"), Buffer.from([0xff, 0, 10]));
  let before = inventoryDigest(snapshotLabTree(lab));
  const r = await runToolingCli(
    ["doctor", "collect", "--root", root, "--candidate", candidate, "--files", "Test/trace.bin"],
    repository,
    t.signal,
  );
  equal(r.status, "passed", JSON.stringify(r));
  ok("id" in r && typeof r.id === "string");
  equal(inventoryDigest(snapshotLabTree(lab)), before);
  const bundle = readDiagnosticBundle(repository, r.id);
  equal(
    (object(object(bundle.probe.diagnosis).facts).verification as { gates: unknown[] }).gates
      .length,
    15,
  );
  const e = await runToolingCli(["doctor", "export", "--id", r.id], repository);
  ok("file" in e && typeof e.file === "string");
  equal(
    (await runToolingCli(["doctor", "inspect", "--input", e.file], repository)).status,
    "matched",
  );
  equal((await runToolingCli(["doctor", "inspect", "--id", r.id], repository)).status, "matched");
  writeFileSync(
    path.join(root, ".wakeflow-local/foreign.txt"),
    "preserved private corruption fixture",
    { mode: 0o600 },
  );
  chmodSync(path.join(root, ".wakeflow-local/foreign.txt"), 0o600);
  equal(
    (await collectDiagnosticBundle(repository, root, candidate, [], t.signal)).status,
    "passed",
  );
  chmodSync(path.join(root, ".wakeflow-local/foreign.txt"), 0o644);
  before = inventoryDigest(snapshotLabTree(lab));
  const failed = await collectDiagnosticBundle(
    repository,
    root,
    candidate,
    [".wakeflow-local/foreign.txt"],
    t.signal,
  );
  equal(failed.status, "failed", JSON.stringify(failed));
  equal(failed.bundleSealed, true);
  equal(inventoryDigest(snapshotLabTree(lab)), before);
  const failedExport = exportDiagnosticSummary(repository, failed.id);
  equal(read(path.join(repository, failedExport.file)).diagnosisStatus, "failed");
});
