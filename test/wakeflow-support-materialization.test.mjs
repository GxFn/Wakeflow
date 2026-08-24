import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fixtureFile = path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json");

function fixture() {
  return JSON.parse(readFileSync(fixtureFile, "utf8"));
}

function configureSurface(value, role, mode) {
  const window = value.topology.windows.find((entry) => entry.role === role);
  const surface = value.topology.supportSurfaces.find((entry) => entry.surfaceId === window.root.surfaceId);
  if (mode === "internal") {
    surface.ownership = "wakeflow-managed";
    delete surface.instructionManagement;
    surface.path = role === "design" ? "Design" : "Test";
    return;
  }
  surface.ownership = "external-owned";
  surface.instructionManagement = mode;
  surface.path = role === "design" ? "../ExternalDesign" : "../ExternalTest";
}

async function buildPlan({ profile, design = "internal", testMode = "internal" }) {
  const value = fixture();
  configureSurface(value, "design", design);
  configureSurface(value, "test", testMode);
  const { parseWakeflowConfigV3 } = await import("../core/scripts/lib/wakeflow-config-v3.mjs");
  const { createWakeflowLayoutDescriptor } = await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const { planWakeflowSupportMaterialization } = await import("../core/scripts/lib/wakeflow-support-materialization.mjs");
  const model = parseWakeflowConfigV3(value);
  const layoutDescriptor = createWakeflowLayoutDescriptor({ model, hostProfile: profile });
  return {
    model,
    layoutDescriptor,
    plan: planWakeflowSupportMaterialization({ model, layoutDescriptor, hostProfile: profile }),
  };
}

function expectedCount(mode, role) {
  if (mode === "internal") return role === "design" ? 2 : 3;
  return mode === "managed-block" ? 1 : 0;
}

function normalizedPresentation(content) {
  return content
    .replaceAll("Claude Code", "HOST")
    .replaceAll("Codex", "HOST")
    .replaceAll("claude-code", "HOST-ID")
    .replaceAll("codex", "HOST-ID")
    .replaceAll("CLAUDE.md", "MEMORY.md")
    .replaceAll("AGENTS.md", "MEMORY.md");
}

test("support planner covers both hosts and every independent ownership combination", async () => {
  const modes = ["internal", "owner-managed", "managed-block"];
  for (const profile of [codexProfile, claudeProfile]) {
    for (const design of modes) {
      for (const testMode of modes) {
        const { plan } = await buildPlan({ profile, design, testMode });
        assert.equal(plan.kind, "WakeflowSupportMaterializationPlan");
        assert.equal(plan.schemaVersion, 1);
        assert.match(plan.planDigest, /^sha256:[0-9a-f]{64}$/u);
        assert.equal(Object.isFrozen(plan), true);
        assert.equal(Object.isFrozen(plan.operations), true);
        assert.equal(plan.host.hostId, profile.hostId);
        assert.equal(plan.host.memoryFile, profile.memoryFile);

        const designSurface = plan.surfaces.find((entry) => entry.role === "design");
        const testSurface = plan.surfaces.find((entry) => entry.role === "test");
        assert.equal(designSurface.operationCount, expectedCount(design, "design"));
        assert.equal(testSurface.operationCount, expectedCount(testMode, "test"));
        assert.equal(plan.operations.length, designSurface.operationCount + testSurface.operationCount);

        for (const operation of plan.operations) {
          assert.equal(path.posix.isAbsolute(operation.path), false);
          assert.equal("absolutePath" in operation, false);
          assert.equal("cwd" in operation, false);
          assert.equal("handleId" in operation, false);
          if (operation.kind === "ensure-directory") {
            assert.equal(operation.preserveContents, true);
            assert.ok(["drafts", "harnesses", "fixtures"].includes(path.posix.basename(operation.path)));
          } else if (operation.kind === "write-managed-file") {
            assert.equal(operation.lifecycle, "managed-whole-file");
            assert.equal(operation.path.endsWith(`/${profile.memoryFile}`), true);
          } else {
            assert.equal(operation.kind, "provide-managed-component");
            assert.deepEqual(Object.keys(operation.marker), ["schemaVersion", "kind", "programId", "surfaceId"]);
            assert.deepEqual(operation.marker, {
              schemaVersion: 1,
              kind: "WakeflowSupportRoleMemoryBlock",
              programId: plan.programId,
              surfaceId: operation.surfaceId,
            });
          }
        }
      }
    }
  }
});

test("support plan is deterministic and has no filesystem effects", async () => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "wakeflow-support-plan-"));
  writeFileSync(path.join(scratch, "sentinel.txt"), "unchanged\n", "utf8");
  const before = readdirSync(scratch).map((name) => [name, readFileSync(path.join(scratch, name), "utf8")]);
  const first = await buildPlan({ profile: codexProfile, design: "managed-block", testMode: "internal" });
  const second = await buildPlan({ profile: codexProfile, design: "managed-block", testMode: "internal" });
  const after = readdirSync(scratch).map((name) => [name, readFileSync(path.join(scratch, name), "utf8")]);
  assert.deepEqual(first.plan, second.plan);
  assert.equal(first.plan.planDigest, second.plan.planDigest);
  assert.deepEqual(after, before);
});

test("candidate memories contain only stable role authority and host presentation differs at the seam", async () => {
  const codex = (await buildPlan({ profile: codexProfile })).plan;
  const claude = (await buildPlan({ profile: claudeProfile })).plan;
  const codexArtifacts = codex.operations.filter((entry) => entry.artifact).map((entry) => entry.artifact);
  const claudeArtifacts = claude.operations.filter((entry) => entry.artifact).map((entry) => entry.artifact);
  assert.equal(codexArtifacts.length, 2);
  assert.equal(claudeArtifacts.length, 2);
  for (let index = 0; index < codexArtifacts.length; index += 1) {
    const left = codexArtifacts[index];
    const right = claudeArtifacts[index];
    assert.equal(left.kind, "WakeflowSupportRoleMemory");
    assert.equal(left.schemaVersion, 1);
    assert.match(left.sha256, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(normalizedPresentation(left.content), normalizedPresentation(right.content));
    for (const forbidden of [
      "docs/current",
      "test-exchange",
      "window ledger",
      "skills/readme",
      "wakeflow-target-craft",
      "/users/",
      "thread id",
      "session id",
    ]) {
      assert.equal(left.content.toLowerCase().includes(forbidden), false, `memory must omit ${forbidden}`);
    }
  }
  const designMemory = codexArtifacts.find((entry) => entry.role === "design").content;
  assert.match(designMemory, /explicit user or controller confirmation/u);
  assert.match(designMemory, /wakeflow_view[\s\S]*wakeflow_next_work[\s\S]*wakeflow_deliver/u);
  assert.match(designMemory, /expectedBoardDigest/u);
  assert.match(designMemory, /does not promote a draft or freeze demand authority/u);
  assert.doesNotMatch(designMemory, /requirement-promotion capability/u);
  const testMemory = codexArtifacts.find((entry) => entry.role === "test").content;
  assert.match(testMemory, /controller-scoped Test-only reproduction or environment diagnostic/u);
  assert.match(testMemory, /Product source is always read-only/u);
  assert.match(testMemory, /strict `TargetResult`/u);
  assert.match(testMemory, /artifactKind: wakeflow-target-result/u);
  assert.doesNotMatch(testMemory, /TargetResultEnvelope/u);
  assert.match(testMemory, /allowedSkills/u);
});

test("owner-managed surfaces yield no hidden memory or scaffold operation", async () => {
  const { plan } = await buildPlan({
    profile: claudeProfile,
    design: "owner-managed",
    testMode: "owner-managed",
  });
  assert.deepEqual(plan.operations, []);
  assert.deepEqual(plan.surfaces.map((entry) => entry.operationCount), [0, 0]);
});

test("owner-managed surfaces still require a canonical single-line host presentation name", async () => {
  for (const hostName of [" Claude Code ", "Claude Code\nInjected"]) {
    await assert.rejects(
      () => buildPlan({
        profile: { ...claudeProfile, hostName },
        design: "owner-managed",
        testMode: "owner-managed",
      }),
      (error) => error.code === "wakeflow-support-materialization-host"
        && error.path === "$/hostProfile/hostName",
    );
  }
});

test("support planner rejects unknown options and mismatched descriptors", async () => {
  const { model, layoutDescriptor } = await buildPlan({ profile: codexProfile });
  const { planWakeflowSupportMaterialization, WakeflowSupportMaterializationError } = await import(
    "../core/scripts/lib/wakeflow-support-materialization.mjs"
  );
  assert.throws(
    () => planWakeflowSupportMaterialization({ model, layoutDescriptor, hostProfile: codexProfile, write: true }),
    (error) => error instanceof WakeflowSupportMaterializationError
      && error.code === "wakeflow-support-materialization-unknown",
  );
  assert.throws(
    () => planWakeflowSupportMaterialization({ model, layoutDescriptor, hostProfile: claudeProfile }),
    (error) => error instanceof WakeflowSupportMaterializationError
      && error.code === "wakeflow-support-materialization-layout",
  );

  let inputReads = 0;
  const behavioralInput = { model, layoutDescriptor, hostProfile: codexProfile };
  Object.defineProperty(behavioralInput, "model", {
    enumerable: true,
    get() {
      inputReads += 1;
      return model;
    },
  });
  assert.throws(() => planWakeflowSupportMaterialization(behavioralInput));
  assert.equal(inputReads, 0, "support planning input must reject accessors without invoking them");

  for (const extra of [
    Object.assign({ model, layoutDescriptor, hostProfile: codexProfile }, { [Symbol("hidden")]: true }),
    (() => {
      const value = { model, layoutDescriptor, hostProfile: codexProfile };
      Object.defineProperty(value, "hidden", { value: true });
      return value;
    })(),
  ]) {
    assert.throws(
      () => planWakeflowSupportMaterialization(extra),
      (error) => error instanceof WakeflowSupportMaterializationError
        && error.code === "wakeflow-support-materialization-unknown",
    );
  }

  const behavioralProfile = { ...codexProfile };
  let hostNameReads = 0;
  Object.defineProperty(behavioralProfile, "hostName", {
    enumerable: true,
    get() {
      hostNameReads += 1;
      return codexProfile.hostName;
    },
  });
  assert.throws(() => planWakeflowSupportMaterialization({
    model,
    layoutDescriptor,
    hostProfile: behavioralProfile,
  }));
  assert.equal(hostNameReads, 0, "host presentation admission must not invoke accessors");
});

test("strict memory renderer rejects missing, unknown, and contradictory inputs", async () => {
  const { renderSupportRoleMemoryCandidate } = await import("../core/scripts/lib/wakeflow-rule-model.mjs");
  const { plan } = await buildPlan({ profile: codexProfile });
  const operation = plan.operations.find((entry) => entry.kind === "write-managed-file" && entry.role === "design");
  const surface = plan.surfaces.find((entry) => entry.role === "design");
  const input = {
    programId: plan.programId,
    surfaceId: surface.surfaceId,
    windowId: surface.windowId,
    role: "design",
    surfaceOwnership: "wakeflow-managed",
    instructionManagement: null,
    host: { ...plan.host },
    paths: {
      supportRoot: "Design",
      memory: operation.path,
      programMemory: "AGENTS.md",
      activeIndex: ".wakeflow-active/index.md",
      activeStatus: ".wakeflow-active/current/workspace-current-status.md",
      activeCurrent: ".wakeflow-active/current",
      requirements: "../wakeflow-ledger/requirement-designs",
      drafts: "Design/drafts",
      harnesses: null,
      fixtures: null,
    },
  };
  assert.doesNotThrow(() => renderSupportRoleMemoryCandidate(input));
  assert.throws(() => renderSupportRoleMemoryCandidate({ ...input, extra: true }), /unknown field extra/u);
  const missing = structuredClone(input);
  delete missing.windowId;
  assert.throws(() => renderSupportRoleMemoryCandidate(missing), /missing required field windowId/u);
  assert.throws(
    () => renderSupportRoleMemoryCandidate({ ...input, surfaceOwnership: "external-owned" }),
    /external memory components require managed-block/u,
  );
  const traversingMemoryComponent = structuredClone(input);
  traversingMemoryComponent.host.memoryFile = "..";
  traversingMemoryComponent.paths.supportRoot = "Design/Sub";
  traversingMemoryComponent.paths.memory = "Design";
  traversingMemoryComponent.paths.drafts = "Design/Sub/drafts";
  assert.throws(
    () => renderSupportRoleMemoryCandidate(traversingMemoryComponent),
    (error) => error.code === "wakeflow-rule-model-path"
      && error.path === "$/host/memoryFile",
  );
});
