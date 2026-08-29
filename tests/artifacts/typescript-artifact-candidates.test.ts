import { createHash } from "node:crypto";
import { deepEqual, equal } from "node:assert/strict";
import {
  lstatSync,
  opendirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import {
  buildTypescriptArtifactCandidates,
} from "../../tooling/artifacts/build-typescript-artifact-candidates.js";
import {
  WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
} from "../../src/workspace/maintenance/wakeflow-maintenance-public-contract.js";
import {
  WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
} from "../../src/workspace/window-runtime/wakeflow-window-host-binding-public-contract.js";

const OUTPUT_RELATIVE = ".build/test-artifacts/typescript-candidates";

interface ManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly mode: "0644" | "0755";
  readonly scope: string;
}

interface CandidateManifest {
  readonly kind: "WakeflowTypescriptArtifactCandidateManifest";
  readonly releaseEligible: false;
  readonly hostId: "codex" | "claude-code";
  readonly externalPackages: readonly string[];
  readonly files: readonly ManifestFile[];
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseJsonFile<Value>(file: string): Value {
  return JSON.parse(readFileSync(file, "utf8")) as Value;
}

function collectFiles(root: string): readonly string[] {
  const result: string[] = [];
  function visit(directory: string): void {
    const entries: Dirent[] = [];
    const handle = opendirSync(directory);
    try {
      while (true) {
        const entry = handle.readSync();
        if (entry === null) break;
        entries.push(entry);
      }
    } finally {
      handle.closeSync();
    }
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Candidate artifact cannot contain symbolic links.");
      }
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        result.push(path.relative(root, absolute).split(path.sep).join("/"));
      }
    }
  }
  visit(root);
  return Object.freeze(result.sort());
}

function digest(file: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
}

function outputFixture(t: TestContext): string {
  const repositoryRoot = process.cwd();
  const output = path.join(repositoryRoot, OUTPUT_RELATIVE);
  t.after(() => {
    const stat = lstatSync(output, { throwIfNoEntry: false });
    if (stat !== undefined && !stat.isSymbolicLink() && stat.isDirectory()) {
      rmSync(output, { recursive: true, force: false });
    }
  });
  return output;
}

test("双宿主候选制品由确定性的闭合可达文件清单生成", (t) => {
  const output = outputFixture(t);
  const first = buildTypescriptArtifactCandidates(
    process.cwd(),
    OUTPUT_RELATIVE,
  );
  const second = buildTypescriptArtifactCandidates(
    process.cwd(),
    OUTPUT_RELATIVE,
  );
  deepEqual(second, first);
  equal(first.releaseEligible, false);
  equal(first.artifacts.length, 2);

  for (const artifact of first.artifacts) {
    const artifactRoot = path.join(output, artifact.outputDirectory);
    const manifestPath = path.join(artifactRoot, "artifact-manifest.json");
    const manifest = parseJsonFile<CandidateManifest>(manifestPath);
    equal(manifest.kind, "WakeflowTypescriptArtifactCandidateManifest");
    equal(manifest.releaseEligible, false);
    equal(manifest.hostId, artifact.hostId);
    equal(digest(manifestPath), artifact.manifestDigest);
    deepEqual(manifest.externalPackages, artifact.externalPackages);

    const expectedFiles = [
      ...manifest.files.map((file) => file.path),
      "artifact-manifest.json",
    ].sort();
    deepEqual(collectFiles(artifactRoot), expectedFiles);
    for (const file of manifest.files) {
      const absolute = path.join(artifactRoot, file.path);
      equal(readFileSync(absolute).byteLength, file.bytes);
      equal(digest(absolute), file.sha256);
      equal(
        lstatSync(absolute).mode & 0o777,
        file.mode === "0755" ? 0o755 : 0o644,
      );
      equal(/\.(?:ts|cts|mts|map)$/u.test(file.path), false);
    }

    const packageDocument = parseJsonFile<{
      readonly private: boolean;
      readonly version: string;
      readonly dependencies: Readonly<Record<string, string>>;
    }>(path.join(artifactRoot, "package.json"));
    equal(packageDocument.private, true);
    equal(packageDocument.version, "0.0.0-technical-skeleton");
    deepEqual(
      Object.keys(packageDocument.dependencies).sort(),
      [...manifest.externalPackages].sort(),
    );
    equal(
      packageDocument.dependencies["@modelcontextprotocol/server"],
      "2.0.0",
    );

    const peerDirectory = artifact.hostId === "codex"
      ? "lib/hosts/claude-code/"
      : "lib/hosts/codex/";
    const admittedPeerProfile = `${peerDirectory}wakeflow-workspace-host-resource-profile.js`;
    deepEqual(
      manifest.files
        .map((file) => file.path)
        .filter((file) => file.startsWith(peerDirectory)),
      [admittedPeerProfile],
    );
  }
});

test("两个候选入口都通过官方 stdio Client 发布相同技术骨干工具", {
  timeout: 20_000,
}, async (t) => {
  const output = outputFixture(t);
  const built = buildTypescriptArtifactCandidates(
    process.cwd(),
    OUTPUT_RELATIVE,
  );

  for (const artifact of built.artifacts) {
    const artifactRoot = path.join(output, artifact.outputDirectory);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(artifactRoot, "mcp/server.mjs")],
      cwd: artifactRoot,
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const client = new Client({
      name: `wakeflow-${artifact.hostId}-artifact-test`,
      version: "1.0.0-test",
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      deepEqual(
        listed.tools.map((tool) => tool.name).sort(),
        [
          WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
          WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
        ].sort(),
      );
    } finally {
      await Promise.allSettled([client.close(), transport.close()]);
    }
    equal(stderr, "");
  }
});
