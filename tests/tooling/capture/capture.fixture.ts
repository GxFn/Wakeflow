import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableIdKind,
} from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createDeliveryEnvelope,
  deliveryTaskPackageRef,
} from "../../../src/governance/delivery/delivery-envelope.js";
import { createImplementationTargetResultReport } from "../../../src/governance/result/implementation-target-result-report.js";
import { parseTargetResult } from "../../../src/governance/result/target-result.js";
import { createTestTargetResult } from "../../../src/governance/result/test-target-result.js";
import { createTestTargetResultReport } from "../../../src/governance/result/test-target-result-report.js";
import {
  computeTaskPackageDigest,
  parseTaskPackage,
} from "../../../src/governance/tasking/task-package.js";
import {
  createInitialTestExecutionAttempt,
  createRerunTestExecutionAttempt,
} from "../../../src/governance/testing/test-execution-attempt.js";
import { createDeliveryEnvelopeFixture } from "../../governance/delivery/delivery-records.fixture.js";
import {
  createImplementationTargetResultReportContentFixture,
  TARGET_RESULT_EVIDENCE_REF,
} from "../../governance/result/implementation-target-result-report.fixture.js";
import { createTargetResultFixture } from "../../governance/result/target-result.fixture.js";
import {
  createTaskPackageFixture,
  SELECTED_AUTHORITY_REF,
} from "../../governance/tasking/task-package.fixture.js";

function id<K extends WakeflowDurableIdKind>(kind: K, value: number) {
  return parseWakeflowDurableIdOfKind(
    `${kind}_${value.toString(16).padStart(8, "0")}-1234-4123-8123-123456789abc`,
    kind,
  );
}

export function fixtureGit(root: string, args: readonly string[]) {
  return execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", ...args],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    },
  ).trim();
}

export function writeJson(file: string, value: unknown) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function captureFixture(t: TestContext, worktree = false) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-capture-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repository = path.join(base, "Repository");
  const root = path.join(base, "Workspace");
  mkdirSync(repository);
  mkdirSync(root);
  cpSync(
    path.join(process.cwd(), "src/contracts/schemas"),
    path.join(repository, "src/contracts/schemas"),
    { recursive: true },
  );
  const primary = path.join(root, "Product");
  const execution = path.join(root, "Test");
  mkdirSync(primary);
  mkdirSync(execution);
  mkdirSync(path.join(root, "Design"));
  fixtureGit(primary, ["init", "-b", "main"]);
  writeFileSync(path.join(primary, "value.mjs"), "export const value = 7;\n");
  fixtureGit(primary, ["add", "value.mjs"]);
  fixtureGit(primary, ["commit", "-m", "Create capture fixture"]);
  let checkout = primary;
  if (worktree) {
    checkout = path.join(root, "Linked");
    fixtureGit(primary, ["worktree", "add", "-b", "codex/capture-fixture", checkout]);
  }
  const commit = fixtureGit(checkout, ["rev-parse", "HEAD"]);
  const branch = fixtureGit(checkout, ["branch", "--show-current"]);
  const implPackage = parseTaskPackage({
    ...createTaskPackageFixture(),
    commitExpectation: "commit",
  });
  if (implPackage.workType !== "implementation") throw new Error("Expected implementation fixture");
  const report = createImplementationTargetResultReport(
    {
      ...createImplementationTargetResultReportContentFixture(),
      repositoryChange: {
        repositoryId: implPackage.assignment.repositoryId,
        disposition: "committed",
        branch,
        commits: [{ algorithm: "sha1", value: commit }],
      },
    },
    { clock: () => parseUtcInstant("2026-08-29T10:10:00.000Z") },
  );
  const { resultDigest: _oldResultDigest, ...oldResult } = createTargetResultFixture();
  const resultBody = {
    ...oldResult,
    report,
    taskPackage: { ...oldResult.taskPackage, digest: computeTaskPackageDigest(implPackage) },
  };
  const result = parseTargetResult({
    ...resultBody,
    resultDigest: computeCanonicalJsonSha256Digest(resultBody),
  });
  const {
    assignment: _assignment,
    commitExpectation: _commit,
    acceptanceAnchors,
    planReview: _review,
    sectionAnchors: _sections,
    ...common
  } = createTaskPackageFixture() as Extract<
    ReturnType<typeof createTaskPackageFixture>,
    { workType: "implementation" }
  >;
  const testWindow = id("window", 10);
  const pkg = parseTaskPackage({
    ...common,
    workType: "test",
    assignment: { windowId: testWindow },
    targetTaskId: id("target-task", 11),
    taskPackageId: id("task-package", 12),
    acceptanceAnchors: [],
    lineage: null,
    testContract: {
      question: "Does the captured fixture return its committed value?",
      objectBoundary: "Declared checkout only",
      steps: ["ts-1", "ts-2"].map((stepId, index) => ({
        stepId,
        given: "A clean committed fixture",
        when: "Run the explicit assertion command",
        // biome-ignore lint/suspicious/noThenProperty: Existing Given/When/Then wire contract.
        then: "The assertion records the expected value",
        requirementRef: { ...acceptanceAnchors[0]?.requirementRef, itemId: `ac-${index + 1}` },
      })),
      environment: SELECTED_AUTHORITY_REF,
      allowedSkills: [],
      setupPolicy: "reuse-existing",
      maxAttempts: 2,
      stopConditions: ["Stop and report any failed command; do not overwrite or rerun."],
    },
    implementationBaselines: [
      {
        targetTaskId: result.targetTaskId,
        taskPackageId: result.taskPackage.taskPackageId,
        taskPackageDigest: result.taskPackage.digest,
        repositoryId: implPackage.assignment.repositoryId,
        windowId: implPackage.assignment.windowId,
        targetResultId: result.targetResultId,
        resultDigest: result.resultDigest,
        targetReviewDecisionId: id("target-review-decision", 13),
        decisionDigest: `sha256:${"d".repeat(64)}`,
      },
    ],
  });
  if (pkg.workType !== "test" || implPackage.workType !== "implementation")
    throw new Error("Expected fixture variants");
  const initial = createInitialTestExecutionAttempt({
    testAttemptId: id("test-attempt", 14),
    taskPackage: pkg,
  });
  const {
    envelopeDigest: _digest,
    rework: _rework,
    productDefectRemediation: _remediation,
    ...oldEnvelope
  } = createDeliveryEnvelopeFixture();
  const envelope = createDeliveryEnvelope({
    ...oldEnvelope,
    workType: "test",
    deliveryId: id("target-delivery", 15),
    target: {
      targetTaskId: pkg.targetTaskId,
      taskPackageId: pkg.taskPackageId,
      taskPackageRef: deliveryTaskPackageRef(pkg.demandId, pkg.taskPackageId),
      taskPackageDigest: computeTaskPackageDigest(pkg),
    },
    route: { ...oldEnvelope.route, windowId: testWindow },
    attempt: initial,
  });
  if (envelope.workType !== "test") throw new Error("Expected Test envelope");
  const mainPod = id("pod", 20),
    pod = worktree ? id("pod", 21) : mainPod;
  const designSurface = id("surface", 22),
    testSurface = id("surface", 23);
  const windows = [
    { windowId: id("window", 24), role: "controller", root: { kind: "program" } },
    {
      windowId: id("window", 25),
      role: "design",
      root: { kind: "support-surface", surfaceId: designSurface },
    },
    {
      windowId: testWindow,
      role: "test",
      root: { kind: "support-surface", surfaceId: testSurface },
    },
    {
      windowId: implPackage.assignment.windowId,
      role: "product",
      root: { kind: "repository", repositoryId: implPackage.assignment.repositoryId },
    },
  ].map((w) => ({ ...w, podId: pod, displayName: w.role }));
  const config = {
    $schema: "urn:wakeflow:config:v2",
    kind: "WakeflowConfig",
    schemaVersion: 2,
    program: {
      programId: pkg.programId,
      displayName: "Capture fixture",
      description: "Disposable test fixture",
    },
    presentation: { language: "en" },
    topology: {
      repositories: [
        {
          repositoryId: implPackage.assignment.repositoryId,
          path: "Product",
          displayName: "Product",
          instructionManagement: "owner-managed",
        },
      ],
      supportSurfaces: [
        {
          surfaceId: designSurface,
          capability: "design",
          path: "Design",
          displayName: "Design",
          ownership: "wakeflow-managed",
        },
        {
          surfaceId: testSurface,
          capability: "test",
          path: "Test",
          displayName: "Test",
          ownership: "wakeflow-managed",
        },
      ],
      windows: worktree
        ? [
            ...windows.map((row, index) => ({
              ...row,
              windowId: id("window", 50 + index),
              podId: mainPod,
            })),
            ...windows,
          ]
        : windows,
    },
    pods: [
      ...(worktree
        ? [
            {
              podId: mainPod,
              name: "main",
              placement: "primary",
              lifecycle: "open",
              worktrees: [],
              closing: null,
            },
          ]
        : []),
      {
        podId: pod,
        name: worktree ? "fixture" : "main",
        placement: worktree ? "worktree" : "primary",
        lifecycle: "open",
        worktrees: worktree
          ? [
              {
                repositoryId: implPackage.assignment.repositoryId,
                windowId: implPackage.assignment.windowId,
                suggestedName: "capture-fixture",
              },
            ]
          : [],
        closing: null,
      },
    ],
    storage: { ledgerRoot: "ledger" },
    governance: {},
    hosts: {},
  };
  writeJson(path.join(root, "wakeflow.config.json"), config);
  const packageFile = path.join(root, "package.json");
  const envelopeFile = path.join(root, "envelope.json");
  const resultFile = path.join(root, "implementation.json");
  writeJson(packageFile, pkg);
  writeJson(envelopeFile, envelope);
  writeJson(resultFile, result);
  const script = path.join(execution, "assert.mjs");
  writeFileSync(
    script,
    `import assert from 'node:assert/strict';\nimport {value} from '../${worktree ? "Linked" : "Product"}/value.mjs';\nassert.equal(value,7);\nprocess.stdout.write(Buffer.from([65,0,255,10]));process.stderr.write('diagnostic\\n');\n`,
  );
  const selection = {
    kind: "WakeflowTestCaptureSelection",
    schemaVersion: 1,
    root,
    taskPackageFile: "package.json",
    envelopeFile: "envelope.json",
    envelopeDigest: envelope.envelopeDigest,
    outputDirectory: "fixtures/capture",
    implementations: [
      {
        repositoryId: implPackage.assignment.repositoryId,
        checkout: path.relative(root, checkout),
        resultFile: "implementation.json",
        commit,
        files: ["value.mjs"],
      },
    ],
    commands: ["ts-1", "ts-2"].map((stepId) => ({
      stepId,
      executable: process.execPath,
      args: ["assert.mjs"],
      inputFiles: ["assert.mjs"],
    })),
  };
  const selectionFile = path.join(root, "selection.json");
  writeJson(selectionFile, selection);
  return {
    base,
    repository,
    root,
    primary,
    checkout,
    execution,
    commit,
    branch,
    pkg,
    envelope,
    result,
    script,
    selection,
    selectionFile,
    packageFile,
    envelopeFile,
    resultFile,
    config,
    initial,
  };
}

export function rerunFixture(f: ReturnType<typeof captureFixture>) {
  const evidence = { ...TARGET_RESULT_EVIDENCE_REF };
  const report = createTestTargetResultReport(
    {
      outcome: "completed",
      summary: "One passed step and one harness failure",
      evidenceLocators: [{ kind: "test-output", ...evidence }],
      verification: [],
      risks: [],
      steps: [
        { stepId: "ts-1", observed: "Passed first step", evidence, verdict: "pass" },
        {
          stepId: "ts-2",
          observed: "Harness could not complete",
          evidence,
          verdict: "cannot-conclude",
          failure: {
            classification: "harness-defect",
            likelyOwner: "test",
            recommendedAction: "Repair the harness and ask Controller for another attempt",
          },
        },
      ],
    },
    { clock: () => parseUtcInstant("2026-08-29T11:00:00.000Z") },
  );
  const previous = createTestTargetResult({
    taskPackage: f.pkg,
    envelope: f.envelope,
    report,
    delivery: {
      generation: 1,
      fence: f.envelope.fence,
      outcomeDigest: parseSha256Digest(`sha256:${"c".repeat(64)}`),
      disposition: "accepted",
      readbackStatus: "pending",
      observedAt: parseUtcInstant("2026-08-29T10:30:00.000Z"),
    },
  });
  const attempt = createRerunTestExecutionAttempt({
    testAttemptId: id("test-attempt", 30),
    taskPackage: f.pkg,
    previousAttempt: f.initial,
    previousResult: {
      targetResultId: previous.targetResultId,
      resultDigest: previous.resultDigest,
    },
    reviewDecision: {
      targetReviewDecisionId: id("target-review-decision", 31),
      decisionDigest: parseSha256Digest(`sha256:${"e".repeat(64)}`),
    },
    stepIds: ["ts-2"],
  });
  const { envelopeDigest: _digest, ...body } = f.envelope;
  const envelope = createDeliveryEnvelope({
    ...body,
    workType: "test",
    deliveryId: id("target-delivery", 32),
    attempt,
  });
  writeJson(path.join(f.root, "previous.json"), previous);
  writeJson(f.envelopeFile, envelope);
  const selection = {
    ...f.selection,
    envelopeDigest: envelope.envelopeDigest,
    previousResultFile: "previous.json",
    commands: f.selection.commands.filter((entry) => entry.stepId === "ts-2"),
  };
  writeJson(f.selectionFile, selection);
  return { previous, envelope, selection };
}
