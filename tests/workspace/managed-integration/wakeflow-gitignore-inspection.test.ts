import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  createWakeflowGitignoreBodyAuthority,
} from "../../../src/workspace/managed-integration/wakeflow-gitignore-body-authority.js";
import {
  inspectWakeflowManagedTextEnvelope,
  recomposeWakeflowManagedTextEnvelope,
} from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import {
  inspectWakeflowWorkspaceGitignore,
  WakeflowGitignoreInspectionError,
  type WakeflowGitignoreInspectionErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-gitignore-inspection.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);

async function fixture(
  t: TestContext,
  source?: string | Uint8Array,
  initializeGit = true,
): Promise<Readonly<{
  readonly absolutePath: string;
  readonly gitignorePath: string;
  readonly root: RootedDirectory;
}>> {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-gitignore-inspection-",
  ));
  if (initializeGit) {
    const initialized = spawnSync("git", ["init", "--quiet"], {
      cwd: absolutePath,
      encoding: "utf8",
    });
    if (initialized.status !== 0) {
      throw new Error("Disposable Git repository initialization failed.");
    }
  }
  const gitignorePath = path.join(absolutePath, ".gitignore");
  if (source !== undefined) {
    writeFileSync(gitignorePath, source, { mode: 0o644 });
  }
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, gitignorePath, root });
}

async function expectInspectionError(
  action: () => Promise<unknown>,
  reason: WakeflowGitignoreInspectionErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowGitignoreInspectionError, true);
  if (caught instanceof WakeflowGitignoreInspectionError) {
    equal(caught.code, "wakeflow-gitignore-inspection");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

function request() {
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    codexWorkspaceHostResourceProfile,
  );
  return Object.freeze({
    matrix,
    expectedMatrixDigest: matrix.matrixDigest,
    hostProfiles: PROFILES,
  });
}

test("Gitignore inspection is read-only across absent, user-owned, current, and planned states", async (t) => {
  const authority = createWakeflowGitignoreBodyAuthority(PROFILES);

  await t.test("absent", async (subtest) => {
    const current = await fixture(subtest);
    const inspected = await inspectWakeflowWorkspaceGitignore(
      current.root,
      request(),
    );
    equal(inspected.status, "recompose-required");
    equal(inspected.source, null);
    equal(inspected.envelope.kind, "unmanaged");
    equal(inspected.target?.disposition, "inserted");
    equal(inspected.gitRuleChecks.every((entry) => !entry.ignored), true);
    equal(
      inspected.targetGitRuleChecks?.every((entry) => entry.ignored),
      true,
    );
    equal(existsSync(current.gitignorePath), false);
  });

  await t.test("satisfied user-owned", async (subtest) => {
    const current = await fixture(subtest, authority.body);
    const before = readFileSync(current.gitignorePath);
    const inspected = await inspectWakeflowWorkspaceGitignore(
      current.root,
      request(),
    );
    equal(inspected.status, "satisfied-user-owned");
    equal(inspected.envelope.kind, "unmanaged");
    equal(inspected.target, null);
    equal(inspected.targetGitRuleChecks, null);
    equal(inspected.gitRuleChecks.every((entry) => entry.ignored), true);
    deepEqual(readFileSync(current.gitignorePath), before);
  });

  await t.test("managed current", async (subtest) => {
    const managed = recomposeWakeflowManagedTextEnvelope(
      new Uint8Array(),
      authority.envelopeTarget,
    );
    const current = await fixture(subtest, managed.bytes);
    const before = readFileSync(current.gitignorePath);
    const inspected = await inspectWakeflowWorkspaceGitignore(
      current.root,
      request(),
    );
    equal(inspected.status, "managed-current");
    equal(inspected.envelope.kind, "managed");
    equal(inspected.target, null);
    equal(inspected.targetGitRuleChecks, null);
    equal(inspected.gitRuleChecks.every((entry) => entry.ignored), true);
    deepEqual(readFileSync(current.gitignorePath), before);
  });

  await t.test("recompose user-owned", async (subtest) => {
    const source = "node_modules/\n";
    const current = await fixture(subtest, source);
    const inspected = await inspectWakeflowWorkspaceGitignore(
      current.root,
      request(),
    );
    equal(inspected.status, "recompose-required");
    equal(inspected.envelope.kind, "unmanaged");
    equal(inspected.target?.disposition, "inserted");
    equal(
      inspected.targetGitRuleChecks?.every((entry) => entry.ignored),
      true,
    );
    const targetEnvelope = inspected.target === null
      ? null
      : inspectWakeflowManagedTextEnvelope(inspected.target.bytes);
    equal(targetEnvelope?.kind, "managed");
    if (targetEnvelope?.kind === "managed") {
      equal(targetEnvelope.body, authority.body);
    }
    equal(readFileSync(current.gitignorePath, "utf8"), source);
  });
});

test("Gitignore inspection rejects unsafe or semantically conflicting sources", async (t) => {
  const authority = createWakeflowGitignoreBodyAuthority(PROFILES);

  await t.test("exact negation", async (subtest) => {
    const source = "!/.wakeflow-local/\n";
    const current = await fixture(subtest, source);
    await expectInspectionError(
      () => inspectWakeflowWorkspaceGitignore(current.root, request()),
      "outside-conflict",
      "$source",
    );
    equal(readFileSync(current.gitignorePath, "utf8"), source);
  });

  await t.test("unknown managed body", async (subtest) => {
    const managed = recomposeWakeflowManagedTextEnvelope(
      new Uint8Array(),
      {
        ...authority.envelopeTarget,
        body: "/unknown-private/\n",
      },
    );
    const current = await fixture(subtest, managed.bytes);
    await expectInspectionError(
      () => inspectWakeflowWorkspaceGitignore(current.root, request()),
      "unknown-managed-body",
      "$source",
    );
  });

  await t.test("tampered envelope", async (subtest) => {
    const managed = recomposeWakeflowManagedTextEnvelope(
      new Uint8Array(),
      authority.envelopeTarget,
    );
    const tampered = Buffer.from(managed.bytes).toString("utf8").replace(
      "/.wakeflow-local/",
      "/.wakeflow-other/",
    );
    const current = await fixture(subtest, tampered);
    await expectInspectionError(
      () => inspectWakeflowWorkspaceGitignore(current.root, request()),
      "envelope",
      "$source",
    );
  });

  await t.test("wrong mode", async (subtest) => {
    const current = await fixture(subtest, "node_modules/\n");
    chmodSync(current.gitignorePath, 0o600);
    await expectInspectionError(
      () => inspectWakeflowWorkspaceGitignore(current.root, request()),
      "source-policy",
      "$source",
    );
  });

  await t.test("symlink", async (subtest) => {
    const current = await fixture(subtest);
    const target = path.join(current.absolutePath, "owner-ignore");
    writeFileSync(target, "node_modules/\n", { mode: 0o644 });
    symlinkSync(target, current.gitignorePath);
    await expectInspectionError(
      () => inspectWakeflowWorkspaceGitignore(current.root, request()),
      "source-policy",
      "$source",
    );
  });

  await t.test("local exclude is not shared authority", async (subtest) => {
    const current = await fixture(subtest);
    const info = path.join(current.absolutePath, ".git", "info");
    mkdirSync(info, { recursive: true });
    writeFileSync(path.join(info, "exclude"), authority.body);
    const inspected = await inspectWakeflowWorkspaceGitignore(
      current.root,
      request(),
    );
    equal(inspected.status, "recompose-required");
    equal(inspected.gitRuleChecks.every((entry) => !entry.ignored), true);
    equal(existsSync(current.gitignorePath), false);
  });

  await t.test("non Git root", async (subtest) => {
    const current = await fixture(subtest, undefined, false);
    await expectInspectionError(
      () => inspectWakeflowWorkspaceGitignore(current.root, request()),
      "git",
      "$git",
    );
  });

  await t.test("pre-aborted", async (subtest) => {
    const current = await fixture(subtest);
    const controller = new AbortController();
    controller.abort();
    const base = request();
    await expectInspectionError(
      () => inspectWakeflowWorkspaceGitignore(current.root, {
        ...base,
        signal: controller.signal,
      }),
      "aborted",
      "$signal",
    );
  });

  await t.test("behavioral signal", async (subtest) => {
    const current = await fixture(subtest);
    let trapCalls = 0;
    const signal = new Proxy(new AbortController().signal, {
      getPrototypeOf: () => {
        trapCalls += 1;
        return AbortSignal.prototype;
      },
    });
    const base = request();
    await expectInspectionError(
      () => inspectWakeflowWorkspaceGitignore(current.root, {
        ...base,
        signal,
      }),
      "input",
      "$request",
    );
    equal(trapCalls, 0);
  });

  await t.test("broader negation after managed block", async (subtest) => {
    const managed = recomposeWakeflowManagedTextEnvelope(
      new Uint8Array(),
      authority.envelopeTarget,
    );
    const source = Buffer.concat([
      Buffer.from(managed.bytes),
      Buffer.from("!/.claude/*\n"),
    ]);
    const current = await fixture(subtest, source);
    await expectInspectionError(
      () => inspectWakeflowWorkspaceGitignore(current.root, request()),
      "outside-conflict",
      "$git",
    );
  });
});
