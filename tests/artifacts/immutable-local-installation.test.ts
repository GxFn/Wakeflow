import { deepEqual, equal, throws } from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inspectLocalInstallation } from "../../tooling/artifacts/inspect-local-installation.js";

function artifact(root: string, version: string, content: string) {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "payload.txt"), content, { mode: 0o644 });
  writeFileSync(
    path.join(root, "artifact-manifest.json"),
    JSON.stringify({
      kind: "WakeflowPluginArtifactManifest",
      version,
      hostId: "codex",
      files: [
        {
          path: "payload.txt",
          bytes: Buffer.byteLength(content),
          mode: "0644",
          sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        },
      ],
    }),
  );
}

test("local installation preserves published version directories and never selects a host target", (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-immutable-install-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const source = path.join(base, "artifact");
  const installed = path.join(base, "1.0.0");
  artifact(source, "1.0.0", "original");
  const planned = inspectLocalInstallation(source, installed);
  equal(planned.disposition, "new-version");
  cpSync(source, installed, { recursive: true });
  equal(inspectLocalInstallation(source, installed).disposition, "already-current");
  const before = readFileSync(path.join(installed, "artifact-manifest.json"));
  artifact(source, "1.0.0", "modified");
  throws(() => inspectLocalInstallation(source, installed), /Same-version replacement refused/u);
  deepEqual(readFileSync(path.join(installed, "artifact-manifest.json")), before);
  artifact(source, "2.0.0-rc.1", "modified");
  const next = inspectLocalInstallation(source, path.join(base, "2.0.0-rc.1"));
  equal(next.disposition, "new-version");
  equal(next.activation, "not-performed");
  throws(() => inspectLocalInstallation(source, installed), /directory must equal/u);
});
