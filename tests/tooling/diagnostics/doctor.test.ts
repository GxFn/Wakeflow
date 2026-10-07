import { deepEqual, equal } from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import {
  inspectArtifactInstallation,
  inspectDevelopmentEnvironment,
} from "../../../tooling/diagnostics/doctor.js";

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-doctor-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function artifact(root: string, version: string, text: string) {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "content"), text, { mode: 0o644 });
  writeFileSync(
    path.join(root, "artifact-manifest.json"),
    JSON.stringify({
      kind: "WakeflowPluginArtifactManifest",
      version,
      hostId: "codex",
      files: [
        {
          path: "content",
          bytes: Buffer.byteLength(text),
          mode: "0644",
          sha256: `sha256:${createHash("sha256").update(text).digest("hex")}`,
        },
      ],
    }),
  );
}

function snapshot(root: string): unknown {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => [
      path.relative(root, path.join(entry.parentPath, entry.name)),
      createHash("sha256")
        .update(readFileSync(path.join(entry.parentPath, entry.name)))
        .digest("hex"),
    ]);
}

test("artifact diagnosis distinguishes missing, corrupt, older and same-version divergent installs without writing", (t) => {
  const root = fixture(t);
  const candidate = path.join(root, "candidate");
  const installed = path.join(root, "installed");
  artifact(candidate, "1.1.0-rc.5", "candidate");
  equal(
    inspectArtifactInstallation({ candidate, installed }).installed?.reason,
    "artifact-not-found",
  );
  artifact(installed, "1.1.0-rc.4", "previous");
  equal(inspectArtifactInstallation({ candidate, installed }).comparison, "different-version");
  artifact(installed, "1.1.0-rc.5", "different");
  equal(
    inspectArtifactInstallation({ candidate, installed }).comparison,
    "same-version-different-bytes",
  );
  artifact(installed, "1.1.0-rc.5", "candidate");
  const before = snapshot(root);
  const result = inspectArtifactInstallation({ candidate, installed });
  equal(result.status, "passed");
  equal(result.comparison, "same-artifact");
  equal(result.activation, "unverified");
  equal(result.hostSelection, "not-observed");
  equal(result.changesApplied, false);
  deepEqual(snapshot(root), before);
  writeFileSync(path.join(installed, "content"), "corrupted");
  const corrupt = inspectArtifactInstallation({ candidate, installed });
  equal(corrupt.status, "failed");
  equal(corrupt.installed?.reason, "wakeflow-artifact-check-drift");
  equal(JSON.stringify(corrupt).includes(root), false);
});

test("an imported native-looking report remains unverified even when it claims verification or matches the artifact", (t) => {
  const root = fixture(t);
  const candidate = path.join(root, "candidate");
  const report = path.join(root, "report.json");
  artifact(candidate, "1.1.0-rc.5", "candidate");
  const digest = inspectArtifactInstallation({ candidate }).candidate.manifestDigest;
  for (const [value, comparison] of [
    [digest, "same-manifest"],
    [`sha256:${"0".repeat(64)}`, "different-manifest"],
  ]) {
    writeFileSync(
      report,
      JSON.stringify({
        structuredContent: {
          kind: "WakeflowStatus",
          verified: true,
          observedAt: "2026-10-03T12:00:00.000Z",
          handle: "private-value-not-for-export",
          runtime: { artifactManifestDigest: value, artifactOnDisk: "same" },
        },
      }),
    );
    const result = inspectArtifactInstallation({ candidate, runtimeReport: report });
    equal(result.runtime?.comparison, comparison);
    equal(result.runtime?.verified, false);
    equal(result.status, "unavailable");
    equal(result.activation, "unverified");
    equal(JSON.stringify(result).includes("private-value-not-for-export"), false);
  }
  writeFileSync(report, "{");
  equal(
    inspectArtifactInstallation({ candidate, runtimeReport: report }).runtime?.comparison,
    "not-comparable",
  );
});

test("environment diagnosis identifies unsupported engine declarations and remains read-only", (t) => {
  const root = fixture(t);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ engines: { node: ">=999.0.0 <1000" } }),
  );
  const before = snapshot(root);
  const result = inspectDevelopmentEnvironment(root);
  equal(result.checks[0]?.reason, "node-engine-mismatch");
  equal(result.scope, "current-cli-environment");
  equal(result.changesApplied, false);
  deepEqual(snapshot(root), before);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ engines: { node: "*" } }));
  equal(inspectDevelopmentEnvironment(root).checks[0]?.status, "unavailable");
});
