import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as todoService from "../core/scripts/lib/wakeflow-todo-service.mjs";

const todoServiceUrl = new URL(
  "../core/scripts/lib/wakeflow-todo-service.mjs",
  import.meta.url,
);

const HEADER = "| ID | Status | Type | Priority | Owner | Item / Goal | Affects Retest / Dispatch | Dependency / Trigger | Recommended Window | Current Mount | Auto Claim | Testing Decision | Documents |";
const DIVIDER = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
const EXPECTED_EMPTY_BOARD = [
  "# Global TODO Board",
  "",
  "This board is the sole pre-demand intake and claim authority. After claim, execution authority lives in the demand state root.",
  "",
  "## Global TODO",
  "",
  HEADER,
  DIVIDER,
  "",
].join("\n");

const DESIGN_WINDOW_ID = "window_11111111-1111-4111-8111-111111111111";
const CONTROLLER_WINDOW_ID = "window_22222222-2222-4222-8222-222222222222";
const DEMAND_ID = "demand_33333333-3333-4333-8333-333333333333";
const OTHER_DEMAND_ID = "demand_44444444-4444-4444-8444-444444444444";
const ARCHIVE_ID = "archive_55555555-5555-4555-8555-555555555555";
const IDENTITY_DIGEST = `sha256:${"a".repeat(64)}`;
const ARCHIVE_DIGEST = `sha256:${"c".repeat(64)}`;

function api() {
  return todoService;
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-todo-service-"));
  const boardPath = path.join(root, ".wakeflow-active", "current", "global-todo-board.md");
  mkdirSync(path.dirname(boardPath), { recursive: true });
  return { root, boardPath };
}

function todoRow(id, overrides = {}) {
  return {
    ID: id,
    Status: "pending-claim",
    Type: "requirement",
    Priority: "P1",
    Owner: DESIGN_WINDOW_ID,
    "Item / Goal": `Implement ${id}`,
    "Affects Retest / Dispatch": "no",
    "Dependency / Trigger": "none",
    "Recommended Window": CONTROLLER_WINDOW_ID,
    "Current Mount": "none",
    "Auto Claim": "yes",
    "Testing Decision": "controller-only: focused target tests",
    Documents: `[original-plan](ledger/requirements/${id}/requirement.json)`,
    ...overrides,
  };
}

function demandMount(demandId = DEMAND_ID) {
  return {
    demandId,
    stateRootRef: `.wakeflow-active/current/${demandId}`,
    identityDigest: IDENTITY_DIGEST,
  };
}

function archiveReceipt(snapshot, demandId = DEMAND_ID) {
  return {
    artifactKind: "wakeflow-business-archive-receipt",
    schemaVersion: 1,
    archiveId: ARCHIVE_ID,
    demandId,
    todoId: snapshot.todoId,
    claimedRowDigest: snapshot.rowDigest,
    manifestDigest: ARCHIVE_DIGEST,
  };
}

function writeBoard(boardPath, rows = []) {
  const content = api().renderTodoBoard(rows);
  writeFileSync(boardPath, content);
  return content;
}

function assertNoPrivateStages(boardPath) {
  const basename = path.basename(boardPath);
  assert.deepEqual(
    readdirSync(path.dirname(boardPath)).filter((entry) => entry.startsWith(`.${basename}.wakeflow-stage-`)),
    [],
  );
}

function atomicStagePath(boardPath, discriminator = 1) {
  return path.join(
    path.dirname(boardPath),
    `.${path.basename(boardPath)}.wakeflow-stage-999999-00000000-0000-4000-8000-${String(discriminator).padStart(12, "0")}`,
  );
}

function writeAtomicStage(boardPath, content, discriminator = 1, mode = 0o644) {
  const stage = atomicStagePath(boardPath, discriminator);
  writeFileSync(stage, content, { mode });
  chmodSync(stage, mode);
  return stage;
}

async function runChild(source) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, "exit");
  return { code, signal, stdout, stderr };
}

function childCall(exportName, args) {
  return [
    `import { ${exportName} } from ${JSON.stringify(todoServiceUrl.href)};`,
    `const args = ${JSON.stringify(args)};`,
    `${exportName}(args);`,
  ].join("\n");
}

test("candidate service owns one exact deterministic empty board", () => {
  const service = api();
  assert.equal(service.EMPTY_TODO_BOARD, EXPECTED_EMPTY_BOARD);
  assert.equal(service.renderTodoBoard([]), EXPECTED_EMPTY_BOARD);

  const { root, boardPath } = fixture();
  assert.throws(
    () => service.createTodoBoardIfAbsent({ root, boardPath }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-board-fresh-proof-required",
  );
  assert.equal(existsSync(boardPath), false);
  const first = service.createTodoBoardIfAbsent({ root, boardPath, freshWorkspace: true });
  assert.equal(first.created, true);
  assert.equal(readFileSync(boardPath, "utf8"), EXPECTED_EMPTY_BOARD);
  assert.equal(statSync(boardPath).mode & 0o777, 0o644);
  assert.match(first.boardDigest, /^sha256:[a-f0-9]{64}$/u);

  const second = service.createTodoBoardIfAbsent({ root, boardPath, freshWorkspace: true });
  assert.equal(second.created, false);
  assert.equal(second.boardDigest, first.boardDigest);
  assert.equal(readFileSync(boardPath, "utf8"), EXPECTED_EMPTY_BOARD);
  assert.equal(existsSync(`${boardPath}.lock`), false);
  assertNoPrivateStages(boardPath);
});

test("TODO authority admission rejects final-file mode, link, and size drift without mutation", async (t) => {
  const service = api();

  await t.test("wrong mode", () => {
    const { root, boardPath } = fixture();
    const content = writeBoard(boardPath, [todoRow("TODO-wrong-mode")]);
    chmodSync(boardPath, 0o600);

    assert.throws(
      () => service.inspectTodoBoard({ root, boardPath }),
      (error) => error instanceof service.WakeflowTodoServiceError
        && error.code === "todo-board-source-unsafe",
    );
    assert.equal(readFileSync(boardPath, "utf8"), content);
    assert.equal(statSync(boardPath).mode & 0o777, 0o600);
    assertNoPrivateStages(boardPath);
  });

  await t.test("hard link", () => {
    const { root, boardPath } = fixture();
    const external = path.join(root, "shared-board.md");
    writeFileSync(external, service.renderTodoBoard([todoRow("TODO-hard-link")]), { mode: 0o644 });
    chmodSync(external, 0o644);
    linkSync(external, boardPath);

    assert.throws(
      () => service.inspectTodoBoard({ root, boardPath }),
      (error) => error instanceof service.WakeflowTodoServiceError
        && error.code === "todo-board-source-unsafe",
    );
    assert.equal(statSync(boardPath).nlink, 2);
    assert.equal(statSync(external).nlink, 2);
    assertNoPrivateStages(boardPath);
  });

  await t.test("oversized bytes", () => {
    const { root, boardPath } = fixture();
    const oversized = Buffer.alloc(service.TODO_BOARD_MAX_BYTES + 1, 0x20);
    writeFileSync(boardPath, oversized, { mode: 0o644 });
    chmodSync(boardPath, 0o644);

    assert.throws(
      () => service.inspectTodoBoard({ root, boardPath }),
      (error) => error instanceof service.WakeflowTodoServiceError
        && error.code === "todo-board-too-large",
    );
    assert.throws(
      () => service.scanTodoBoard(oversized.toString("utf8")),
      (error) => error instanceof service.WakeflowTodoServiceError
        && error.code === "todo-board-too-large",
    );
    assert.equal(statSync(boardPath).size, service.TODO_BOARD_MAX_BYTES + 1);
    assertNoPrivateStages(boardPath);
  });
});

test("strict scanner returns stable board, row, snapshot, and lineage digests without I/O", () => {
  const service = api();
  const content = service.renderTodoBoard([
    todoRow("TODO-alpha"),
    todoRow("TODO-beta", { "Item / Goal": "left | right\nsecond line" }),
  ]);
  const first = service.scanTodoBoard(content);
  const second = service.scanTodoBoard(content);

  assert.deepEqual(second, first);
  assert.equal(first.boardDigest, second.boardDigest);
  assert.equal(first.rowCount, 2);
  assert.deepEqual(first.rows.map((entry) => entry.id), ["TODO-alpha", "TODO-beta"]);
  assert.match(first.rows[0].rowDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(first.rows[0].snapshot, {
    artifactKind: "wakeflow-todo-row-snapshot",
    schemaVersion: 1,
    todoId: "TODO-alpha",
    row: first.rows[0].row,
    rowDigest: first.rows[0].rowDigest,
  });
  assert.deepEqual(first.rows[0].lineageRef, {
    artifactKind: "wakeflow-todo-lineage-ref",
    schemaVersion: 1,
    boardRef: service.TODO_BOARD_REF,
    todoId: "TODO-alpha",
    intakeRowDigest: first.rows[0].rowDigest,
  });
  assert.equal(first.rows[1].value["Item / Goal"], "left | right\nsecond line");
});

test("pure claim planner returns exact pending and committed row and board plans", () => {
  const service = api();
  const content = service.renderTodoBoard([
    todoRow("TODO-plan"),
    todoRow("TODO-plan-unrelated", { Priority: "P2" }),
  ]);
  const sourceBoard = service.scanTodoBoard(content);
  const expectedRow = sourceBoard.rows[0].snapshot;

  const pending = service.planTodoClaim({
    content,
    todoId: "TODO-plan",
    expectedRow,
    mount: demandMount(),
  });
  assert.equal(pending.status, "pending");
  assert.deepEqual(pending.pending.snapshot, expectedRow);
  assert.equal(pending.committed.value.Status, "claimed");
  assert.equal(
    pending.committed.value["Current Mount"],
    `.wakeflow-active/current/${DEMAND_ID}`,
  );
  assert.deepEqual(pending.lineageRef, sourceBoard.rows[0].lineageRef);
  assert.deepEqual(pending.mount, demandMount());
  assert.equal(pending.source.content, content);
  assert.deepEqual(pending.source.board, sourceBoard);
  assert.deepEqual(
    pending.target.board.rows.find((entry) => entry.id === "TODO-plan-unrelated").value,
    sourceBoard.rows[1].value,
  );
  assert.deepEqual(
    pending.target.board.rows.find((entry) => entry.id === "TODO-plan").snapshot,
    pending.committed.snapshot,
  );
  assert.equal(pending.target.content, service.renderTodoBoard([
    pending.committed.value,
    sourceBoard.rows[1].value,
  ]));
  assert.equal(content, service.renderTodoBoard(sourceBoard.rows.map((entry) => entry.value)));
  assert.equal(Object.isFrozen(pending), true);
  assert.equal(Object.isFrozen(pending.source), true);
  assert.equal(Object.isFrozen(pending.target), true);

  const committed = service.planTodoClaim({
    content: pending.target.content,
    todoId: "TODO-plan",
    expectedRow,
    mount: demandMount(),
  });
  assert.equal(committed.status, "committed");
  assert.deepEqual(committed.pending.snapshot, expectedRow);
  assert.deepEqual(committed.committed.snapshot, pending.committed.snapshot);
  assert.equal(committed.source.content, pending.target.content);
  assert.equal(committed.target.content, pending.target.content);
  assert.deepEqual(committed.source.board, committed.target.board);

  const conflicting = service.renderTodoBoard([
    todoRow("TODO-plan", {
      Status: "claimed",
      "Current Mount": `.wakeflow-active/current/${OTHER_DEMAND_ID}`,
    }),
    sourceBoard.rows[1].value,
  ]);
  assert.throws(
    () => service.planTodoClaim({
      content: conflicting,
      todoId: "TODO-plan",
      expectedRow,
      mount: demandMount(),
    }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-row-cas-mismatch",
  );
});

test("strict scanner rejects unknown, corrupt, noncanonical, and duplicate rows", () => {
  const service = api();
  const canonical = service.renderTodoBoard([todoRow("TODO-strict")]);
  const rowLine = canonical.trimEnd().split("\n").at(-1);
  const cells = rowLine.slice(2, -2).split(" | ");
  const corruptions = [
    canonical.replace("## Global TODO", "## Intake"),
    canonical.replace(HEADER, HEADER.replace("| Status | Type |", "| Type | Status |")),
    canonical.replace(DIVIDER, DIVIDER.replace("| --- | --- |", "| --- |")),
    canonical.replace(rowLine, `| ${cells.slice(0, 12).join(" | ")} |`),
    canonical.replace("| pending-claim |", "| invented-status |"),
    canonical.replace("| requirement |", "| invented-type |"),
    canonical.replace(rowLine, rowLine.replace(/^\| /u, "|").replace(/ \|$/u, "|")),
    canonical.replaceAll("\n", "\r\n"),
    canonical.replace(`${rowLine}\n`, `${rowLine}\n${rowLine}\n`),
  ];

  for (const content of corruptions) {
    assert.throws(() => service.scanTodoBoard(content), service.WakeflowTodoServiceError);
  }
  const invalidRows = [
    todoRow("bad ID"),
    todoRow("TODO-semantic-owner", { Owner: "Design" }),
    todoRow("TODO-wrong-window", { "Recommended Window": "repository_22222222-2222-4222-8222-222222222222" }),
    todoRow("TODO-control", { "Item / Goal": "bad\u0000value" }),
    todoRow("TODO-c1-control", { "Item / Goal": "bad\u0085value" }),
    todoRow("TODO-test-mode", { "Testing Decision": "invented: guess" }),
    todoRow("TODO-absolute-doc", { Documents: "[plan](/private/authority.json)" }),
    todoRow("TODO-uri-doc", { Documents: "[plan](file:///private/authority.json)" }),
    todoRow("TODO-parent-doc", { Documents: "[plan](../outside.json)" }),
    todoRow("TODO-nested-parent-doc", { Documents: "[plan](a/../b.json)" }),
    todoRow("TODO-dot-doc", { Documents: "[plan](./x.json)" }),
    todoRow("TODO-empty-segment-doc", { Documents: "[plan](a//b.json)" }),
    todoRow("TODO-directory-doc", { Documents: "[plan](a/b/)" }),
    todoRow("TODO-bad-mount", {
      Status: "claimed",
      "Current Mount": ".wakeflow-active/current/../foreign",
    }),
  ];
  for (const row of invalidRows) {
    assert.throws(() => service.renderTodoBoard([row]), service.WakeflowTodoServiceError);
  }
  assert.throws(
    () => service.renderTodoBoard([todoRow("TODO-literal-break", { "Item / Goal": "literal <br> token" })]),
    service.WakeflowTodoServiceError,
  );
  assert.doesNotThrow(() => service.renderTodoBoard([
    todoRow("TODO-anchored-doc", {
      Documents: "[original-plan](ledger/requirements/requirement.json#original-plan)",
    }),
  ]));
});

test("all mutations fail closed on a corrupt existing board with zero writes", () => {
  const service = api();
  const { root, boardPath } = fixture();
  const corrupt = EXPECTED_EMPTY_BOARD.replace("| Status |", "| Unknown | ");
  writeFileSync(boardPath, corrupt);

  assert.throws(
    () => service.createTodoBoardIfAbsent({ root, boardPath, freshWorkspace: true }),
    service.WakeflowTodoServiceError,
  );
  assert.throws(
    () => service.appendTodoRow({ root, boardPath, row: todoRow("TODO-never-written") }),
    service.WakeflowTodoServiceError,
  );
  assert.equal(readFileSync(boardPath, "utf8"), corrupt);
  assertNoPrivateStages(boardPath);
});

test("append is lock-backed, board-CAS aware, duplicate-safe, and preserves unrelated rows", () => {
  const service = api();
  const { root, boardPath } = fixture();
  writeBoard(boardPath, [todoRow("TODO-existing")]);
  const before = service.scanTodoBoard(readFileSync(boardPath, "utf8"));

  const appended = service.appendTodoRow({
    root,
    boardPath,
    expectedBoardDigest: before.boardDigest,
    row: todoRow("TODO-appended", { Priority: "P2" }),
  });
  assert.equal(appended.appended.id, "TODO-appended");
  assert.deepEqual(appended.board.rows.map((entry) => entry.id), ["TODO-existing", "TODO-appended"]);

  const committed = readFileSync(boardPath, "utf8");
  assert.throws(
    () => service.appendTodoRow({
      root,
      boardPath,
      expectedBoardDigest: before.boardDigest,
      row: todoRow("TODO-stale"),
    }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-board-cas-mismatch",
  );
  assert.throws(
    () => service.appendTodoRow({ root, boardPath, row: todoRow("TODO-existing") }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-row-duplicate",
  );
  assert.equal(readFileSync(boardPath, "utf8"), committed);
  assertNoPrivateStages(boardPath);
});

test("claim requires an exact intake snapshot and a structured canonical demand mount", () => {
  const service = api();
  const { root, boardPath } = fixture();
  writeBoard(boardPath, [todoRow("TODO-claim"), todoRow("TODO-unrelated")]);
  const before = service.scanTodoBoard(readFileSync(boardPath, "utf8"));
  const claimSnapshot = before.rows.find((entry) => entry.id === "TODO-claim").snapshot;
  const unchanged = readFileSync(boardPath, "utf8");

  assert.throws(
    () => service.claimTodoRow({
      root,
      boardPath,
      todoId: "TODO-claim",
      expectedRow: claimSnapshot,
      mount: `.wakeflow-active/current/${DEMAND_ID}`,
    }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-demand-mount-invalid",
  );
  assert.equal(readFileSync(boardPath, "utf8"), unchanged);
  assert.throws(
    () => service.claimTodoRow({
      root,
      boardPath,
      todoId: "TODO-claim",
      expectedRow: claimSnapshot,
      mount: { ...demandMount(), identityDigest: "sha256:not-a-digest" },
    }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-demand-mount-invalid",
  );
  assert.throws(
    () => service.claimTodoRow({
      root,
      boardPath,
      todoId: "TODO-claim",
      expectedRow: claimSnapshot,
      mount: { ...demandMount(), stateRootRef: `.wakeflow-active/current/${OTHER_DEMAND_ID}` },
    }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-demand-mount-invalid",
  );
  assert.equal(readFileSync(boardPath, "utf8"), unchanged);

  const stale = { ...claimSnapshot, rowDigest: `sha256:${"b".repeat(64)}` };
  assert.throws(
    () => service.claimTodoRow({
      root,
      boardPath,
      todoId: "TODO-claim",
      expectedRow: stale,
      mount: demandMount(),
    }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-row-snapshot-invalid",
  );
  assert.equal(readFileSync(boardPath, "utf8"), unchanged);

  service.appendTodoRow({ root, boardPath, row: todoRow("TODO-late-unrelated") });
  const result = service.claimTodoRow({
    root,
    boardPath,
    todoId: "TODO-claim",
    expectedRow: claimSnapshot,
    mount: demandMount(),
  });
  assert.equal(result.previous.rowDigest, claimSnapshot.rowDigest);
  assert.equal(result.current.value.Status, "claimed");
  assert.equal(result.current.value["Current Mount"], `.wakeflow-active/current/${DEMAND_ID}`);
  assert.deepEqual(result.lineageRef, before.rows[0].lineageRef);
  assert.deepEqual(
    result.board.rows.find((entry) => entry.id === "TODO-unrelated").value,
    before.rows.find((entry) => entry.id === "TODO-unrelated").value,
  );
  assert.equal(result.board.rows.find((entry) => entry.id === "TODO-late-unrelated").value.Status, "pending-claim");

  const onceClaimed = readFileSync(boardPath, "utf8");
  assert.throws(
    () => service.claimTodoRow({
      root,
      boardPath,
      todoId: "TODO-claim",
      expectedRow: claimSnapshot,
      mount: demandMount(),
    }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-row-cas-mismatch",
  );
  assert.equal(readFileSync(boardPath, "utf8"), onceClaimed);
});

test("claim inspection is read-only and recovery commits pending or accepts exact committed under one lock", () => {
  const service = api();
  const { root, boardPath } = fixture();
  writeBoard(boardPath, [todoRow("TODO-recover"), todoRow("TODO-recover-unrelated")]);
  const expectedRow = service.scanTodoBoard(readFileSync(boardPath, "utf8")).rows[0].snapshot;
  const beforeBytes = readFileSync(boardPath, "utf8");
  const beforeInode = statSync(boardPath).ino;
  const args = {
    root,
    boardPath,
    todoId: "TODO-recover",
    expectedRow,
    mount: demandMount(),
  };

  const inspectedPending = service.inspectTodoClaim(args);
  assert.equal(inspectedPending.status, "pending");
  assert.equal(readFileSync(boardPath, "utf8"), beforeBytes);
  assert.equal(statSync(boardPath).ino, beforeInode);

  const recovered = service.recoverTodoRowClaim(args);
  assert.equal(recovered.status, "committed");
  assert.equal(recovered.wrote, true);
  assert.deepEqual(recovered.previous.snapshot, expectedRow);
  assert.deepEqual(recovered.current.snapshot, inspectedPending.committed.snapshot);
  assert.equal(recovered.board.rows[0].value.Status, "claimed");
  assert.equal(
    recovered.board.rows[0].value["Current Mount"],
    `.wakeflow-active/current/${DEMAND_ID}`,
  );
  assert.equal(recovered.board.rows[1].value.ID, "TODO-recover-unrelated");

  const committedBytes = readFileSync(boardPath, "utf8");
  const committedInode = statSync(boardPath).ino;
  const inspectedCommitted = service.inspectTodoClaim(args);
  assert.equal(inspectedCommitted.status, "committed");
  assert.equal(readFileSync(boardPath, "utf8"), committedBytes);
  assert.equal(statSync(boardPath).ino, committedInode);

  const alreadyCommitted = service.recoverTodoRowClaim(args);
  assert.equal(alreadyCommitted.status, "committed");
  assert.equal(alreadyCommitted.wrote, false);
  assert.deepEqual(alreadyCommitted.previous.snapshot, expectedRow);
  assert.deepEqual(alreadyCommitted.current.snapshot, recovered.current.snapshot);
  assert.equal(readFileSync(boardPath, "utf8"), committedBytes);
  assert.equal(statSync(boardPath).ino, committedInode);

  assert.throws(
    () => service.recoverTodoRowClaim({
      ...args,
      mount: demandMount(OTHER_DEMAND_ID),
    }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-row-cas-mismatch",
  );
  assert.equal(readFileSync(boardPath, "utf8"), committedBytes);
  assert.equal(statSync(boardPath).ino, committedInode);
  assert.equal(existsSync(`${boardPath}.lock`), false);
  assertNoPrivateStages(boardPath);
});

test("ordinary TODO inspection preserves an interrupted stage while exact claim recovery consumes it", () => {
  const service = api();
  const { root, boardPath } = fixture();
  writeBoard(boardPath, [todoRow("TODO-claim-stage"), todoRow("TODO-claim-stage-unrelated")]);
  const expectedRow = service.scanTodoBoard(readFileSync(boardPath, "utf8")).rows[0].snapshot;
  const stage = writeAtomicStage(boardPath, "partial interrupted claim bytes");
  const args = {
    root,
    boardPath,
    todoId: "TODO-claim-stage",
    expectedRow,
    mount: demandMount(),
  };

  assert.throws(
    () => service.inspectTodoClaim(args),
    (error) => error instanceof service.WakeflowTodoServiceError
      && error.code === "todo-board-stage-residue",
  );
  assert.equal(existsSync(stage), true);

  const recovered = service.recoverTodoRowClaim(args);
  assert.equal(recovered.status, "committed");
  assert.equal(recovered.wrote, true);
  assert.equal(existsSync(stage), false);
  assert.equal(recovered.board.rows[0].value.Status, "claimed");
  assert.equal(recovered.board.rows[1].value.ID, "TODO-claim-stage-unrelated");
  assertNoPrivateStages(boardPath);
});

test("archive removes one exact claimed lineage row only with a T09 business receipt", () => {
  const service = api();
  const { root, boardPath } = fixture();
  writeBoard(boardPath, [
    todoRow("TODO-claimed", {
      Status: "claimed",
      "Current Mount": `.wakeflow-active/current/${DEMAND_ID}`,
    }),
    todoRow("TODO-pending"),
    todoRow("TODO-unrelated-claimed", {
      Status: "claimed",
      "Current Mount": `.wakeflow-active/current/${OTHER_DEMAND_ID}`,
    }),
  ]);
  const before = service.scanTodoBoard(readFileSync(boardPath, "utf8"));
  const snapshot = before.rows.find((entry) => entry.id === "TODO-claimed").snapshot;
  const bytes = readFileSync(boardPath, "utf8");
  assert.throws(
    () => service.archiveTodoRow({ root, boardPath, expectedRow: snapshot }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-archive-receipt-invalid",
  );
  assert.equal(readFileSync(boardPath, "utf8"), bytes);

  const result = service.archiveTodoRow({
    root,
    boardPath,
    expectedRow: snapshot,
    archiveReceipt: archiveReceipt(snapshot),
  });

  assert.equal(result.archived.id, "TODO-claimed");
  assert.deepEqual(result.archiveReceipt, archiveReceipt(snapshot));
  assert.deepEqual(result.board.rows.map((entry) => entry.id), ["TODO-pending", "TODO-unrelated-claimed"]);
  assert.deepEqual(result.board.rows[0].value, before.rows[1].value);
  assert.deepEqual(result.board.rows[1].value, before.rows[2].value);
});

test("archive lineage inspection reconstructs the exact intake row from one claimed mount without writing", () => {
  const service = api();
  assert.equal(
    typeof service.inspectTodoArchiveLineage,
    "function",
    "M2-T09 requires the read-only TODO archive lineage seam",
  );
  const { root, boardPath } = fixture();
  writeBoard(boardPath, [todoRow("TODO-archive-lineage"), todoRow("TODO-lineage-unrelated")]);
  const intake = service.scanTodoBoard(readFileSync(boardPath, "utf8"));
  const expectedRow = intake.rows[0].snapshot;
  service.claimTodoRow({
    root,
    boardPath,
    todoId: expectedRow.todoId,
    expectedRow,
    mount: demandMount(),
  });
  const claimed = service.scanTodoBoard(readFileSync(boardPath, "utf8"));
  const claimedRow = claimed.rows.find((entry) => entry.id === expectedRow.todoId);
  const beforeBytes = readFileSync(boardPath);
  const beforeInode = statSync(boardPath).ino;

  const inspected = service.inspectTodoArchiveLineage({
    root,
    boardPath,
    todoId: expectedRow.todoId,
    intakeRowDigest: expectedRow.rowDigest,
    mount: demandMount(),
  });

  assert.equal(inspected.status, "claimed");
  assert.deepEqual(inspected.pending.snapshot, expectedRow);
  assert.deepEqual(inspected.claimed.snapshot, claimedRow.snapshot);
  assert.deepEqual(inspected.lineageRef, intake.rows[0].lineageRef);
  assert.deepEqual(inspected.mount, demandMount());
  assert.equal(inspected.board.rows[1].id, "TODO-lineage-unrelated");
  assert.deepEqual(readFileSync(boardPath), beforeBytes);
  assert.equal(statSync(boardPath).ino, beforeInode);

  for (const conflicting of [
    { intakeRowDigest: `sha256:${"b".repeat(64)}` },
    { mount: demandMount(OTHER_DEMAND_ID) },
  ]) {
    assert.throws(
      () => service.inspectTodoArchiveLineage({
        root,
        boardPath,
        todoId: expectedRow.todoId,
        intakeRowDigest: expectedRow.rowDigest,
        mount: demandMount(),
        ...conflicting,
      }),
      (error) => (
        error instanceof service.WakeflowTodoServiceError
        && error.code === "todo-row-cas-mismatch"
      ),
    );
  }
  assert.deepEqual(readFileSync(boardPath), beforeBytes);
  assert.equal(statSync(boardPath).ino, beforeInode);
  assertNoPrivateStages(boardPath);
});

test("TODO archive recovery deletes one exact claimed row once and accepts only its missing replay", () => {
  const service = api();
  assert.equal(
    typeof service.recoverTodoRowArchive,
    "function",
    "M2-T09 requires the idempotent TODO archive recovery seam",
  );
  const { root, boardPath } = fixture();
  writeBoard(boardPath, [
    todoRow("TODO-archive-recover", {
      Status: "claimed",
      "Current Mount": `.wakeflow-active/current/${DEMAND_ID}`,
    }),
    todoRow("TODO-archive-recover-unrelated"),
  ]);
  const before = service.scanTodoBoard(readFileSync(boardPath, "utf8"));
  const expectedRow = before.rows[0].snapshot;
  const receipt = archiveReceipt(expectedRow);

  const committed = service.recoverTodoRowArchive({
    root,
    boardPath,
    expectedRow,
    archiveReceipt: receipt,
  });
  assert.equal(committed.status, "committed");
  assert.equal(committed.wrote, true);
  assert.deepEqual(committed.archived.snapshot, expectedRow);
  assert.deepEqual(committed.archiveReceipt, receipt);
  assert.deepEqual(committed.board.rows.map((entry) => entry.id), ["TODO-archive-recover-unrelated"]);
  assertNoPrivateStages(boardPath);

  const committedBytes = readFileSync(boardPath);
  const committedInode = statSync(boardPath).ino;
  const replay = service.recoverTodoRowArchive({
    root,
    boardPath,
    expectedRow,
    archiveReceipt: receipt,
  });
  assert.equal(replay.status, "already-committed");
  assert.equal(replay.wrote, false);
  assert.deepEqual(replay.archived.snapshot, expectedRow);
  assert.deepEqual(replay.archiveReceipt, receipt);
  assert.deepEqual(readFileSync(boardPath), committedBytes);
  assert.equal(statSync(boardPath).ino, committedInode);
  assertNoPrivateStages(boardPath);

  const board = service.scanTodoBoard(readFileSync(boardPath, "utf8"));
  service.appendTodoRow({
    root,
    boardPath,
    expectedBoardDigest: board.boardDigest,
    row: todoRow(expectedRow.todoId, { "Item / Goal": "A different row reused this ID" }),
  });
  const conflictingBytes = readFileSync(boardPath);
  const conflictingStage = writeAtomicStage(boardPath, "uncommitted conflicting-row residue\n");
  assert.throws(
    () => service.recoverTodoRowArchive({
      root,
      boardPath,
      expectedRow,
      archiveReceipt: receipt,
    }),
    (error) => (
      error instanceof service.WakeflowTodoServiceError
      && error.code === "todo-row-cas-mismatch"
    ),
  );
  assert.deepEqual(readFileSync(boardPath), conflictingBytes);
  assert.equal(existsSync(conflictingStage), true);
  unlinkSync(conflictingStage);
  assertNoPrivateStages(boardPath);
});

test("TODO archive recovery consumes one safe interrupted board stage at every write boundary", async (t) => {
  for (const boundary of ["0-byte", "partial", "full"]) {
    await t.test(boundary, () => {
      const service = api();
      const { root, boardPath } = fixture();
      const claimed = todoRow(`TODO-archive-stage-${boundary}`, {
        Status: "claimed",
        "Current Mount": `.wakeflow-active/current/${DEMAND_ID}`,
      });
      const unrelated = todoRow(`TODO-archive-stage-${boundary}-unrelated`);
      writeBoard(boardPath, [claimed, unrelated]);
      const expectedRow = service.scanTodoBoard(readFileSync(boardPath, "utf8")).rows[0].snapshot;
      const committedBytes = Buffer.from(service.renderTodoBoard([unrelated]), "utf8");
      const residue = boundary === "0-byte"
        ? Buffer.alloc(0)
        : boundary === "partial"
          ? committedBytes.subarray(0, Math.max(1, Math.floor(committedBytes.length / 2)))
          : committedBytes;
      const stage = writeAtomicStage(boardPath, residue);

      const recovered = service.recoverTodoRowArchive({
        root,
        boardPath,
        expectedRow,
        archiveReceipt: archiveReceipt(expectedRow),
      });

      assert.equal(recovered.status, "committed");
      assert.equal(recovered.wrote, true);
      assert.equal(existsSync(stage), false);
      assert.deepEqual(recovered.board.rows.map((entry) => entry.id), [unrelated.ID]);
      assert.deepEqual(readFileSync(boardPath), committedBytes);
      assertNoPrivateStages(boardPath);
    });
  }

  await t.test("full stage beside an already-committed board is discarded without rewriting", () => {
    const service = api();
    const { root, boardPath } = fixture();
    const claimed = todoRow("TODO-archive-stage-replay", {
      Status: "claimed",
      "Current Mount": `.wakeflow-active/current/${DEMAND_ID}`,
    });
    const unrelated = todoRow("TODO-archive-stage-replay-unrelated");
    writeBoard(boardPath, [claimed, unrelated]);
    const expectedRow = service.scanTodoBoard(readFileSync(boardPath, "utf8")).rows[0].snapshot;
    const committedBytes = Buffer.from(writeBoard(boardPath, [unrelated]), "utf8");
    const committedInode = statSync(boardPath).ino;
    const stage = writeAtomicStage(boardPath, committedBytes);

    const replay = service.recoverTodoRowArchive({
      root,
      boardPath,
      expectedRow,
      archiveReceipt: archiveReceipt(expectedRow),
    });

    assert.equal(replay.status, "already-committed");
    assert.equal(replay.wrote, false);
    assert.equal(existsSync(stage), false);
    assert.deepEqual(readFileSync(boardPath), committedBytes);
    assert.equal(statSync(boardPath).ino, committedInode);
    assertNoPrivateStages(boardPath);
  });
});

test("TODO archive recovery preserves ambiguous, unsafe, and unauthorized board stages", async (t) => {
  for (const scenario of ["symlink", "hardlink", "wrong-mode", "oversized", "unknown-name"]) {
    await t.test(scenario, () => {
      const service = api();
      const { root, boardPath } = fixture();
      writeBoard(boardPath, [todoRow(`TODO-archive-unsafe-${scenario}`, {
        Status: "claimed",
        "Current Mount": `.wakeflow-active/current/${DEMAND_ID}`,
      })]);
      const expectedRow = service.scanTodoBoard(readFileSync(boardPath, "utf8")).rows[0].snapshot;
      const boardBytes = readFileSync(boardPath);
      const boardInode = statSync(boardPath).ino;
      const stage = atomicStagePath(boardPath);
      const external = path.join(root, `unsafe-${scenario}.txt`);
      if (scenario === "symlink") {
        writeFileSync(external, "external symlink target\n", { mode: 0o644 });
        symlinkSync(external, stage);
      } else if (scenario === "hardlink") {
        writeFileSync(external, "external hardlink target\n", { mode: 0o644 });
        chmodSync(external, 0o644);
        linkSync(external, stage);
      } else if (scenario === "oversized") {
        writeAtomicStage(boardPath, Buffer.alloc(service.TODO_BOARD_MAX_BYTES + 1, 0x20));
      } else if (scenario === "unknown-name") {
        writeFileSync(
          path.join(
            path.dirname(boardPath),
            `.${path.basename(boardPath)}.wakeflow-stage-unrecognized`,
          ),
          "unknown stage namespace\n",
          { mode: 0o644 },
        );
      } else {
        writeAtomicStage(boardPath, "wrong mode residue\n", 1, 0o600);
      }
      const residue = scenario === "unknown-name"
        ? path.join(
            path.dirname(boardPath),
            `.${path.basename(boardPath)}.wakeflow-stage-unrecognized`,
          )
        : stage;

      assert.throws(
        () => service.recoverTodoRowArchive({
          root,
          boardPath,
          expectedRow,
          archiveReceipt: archiveReceipt(expectedRow),
        }),
        (error) => (
          error instanceof service.WakeflowTodoServiceError
          && error.code === "todo-board-stage-residue"
        ),
      );
      assert.equal(existsSync(residue), true);
      assert.deepEqual(readFileSync(boardPath), boardBytes);
      assert.equal(statSync(boardPath).ino, boardInode);
      if (scenario === "symlink" || scenario === "hardlink") {
        assert.match(readFileSync(external, "utf8"), /target/u);
      }
    });
  }

  await t.test("multiple exact stages remain for explicit inspection", () => {
    const service = api();
    const { root, boardPath } = fixture();
    writeBoard(boardPath, [todoRow("TODO-archive-multiple-stages", {
      Status: "claimed",
      "Current Mount": `.wakeflow-active/current/${DEMAND_ID}`,
    })]);
    const expectedRow = service.scanTodoBoard(readFileSync(boardPath, "utf8")).rows[0].snapshot;
    const boardBytes = readFileSync(boardPath);
    const stages = [
      writeAtomicStage(boardPath, "first residue\n", 1),
      writeAtomicStage(boardPath, "second residue\n", 2),
    ];

    assert.throws(
      () => service.recoverTodoRowArchive({
        root,
        boardPath,
        expectedRow,
        archiveReceipt: archiveReceipt(expectedRow),
      }),
      (error) => (
        error instanceof service.WakeflowTodoServiceError
        && error.code === "todo-board-stage-residue"
      ),
    );
    assert.deepEqual(stages.map((stage) => existsSync(stage)), [true, true]);
    assert.deepEqual(readFileSync(boardPath), boardBytes);
  });

  await t.test("receipt conflict cannot authorize stage cleanup", () => {
    const service = api();
    const { root, boardPath } = fixture();
    writeBoard(boardPath, [todoRow("TODO-archive-stage-receipt-conflict", {
      Status: "claimed",
      "Current Mount": `.wakeflow-active/current/${DEMAND_ID}`,
    })]);
    const expectedRow = service.scanTodoBoard(readFileSync(boardPath, "utf8")).rows[0].snapshot;
    const boardBytes = readFileSync(boardPath);
    const stage = writeAtomicStage(boardPath, "unauthorized residue\n");

    assert.throws(
      () => service.recoverTodoRowArchive({
        root,
        boardPath,
        expectedRow,
        archiveReceipt: archiveReceipt(expectedRow, OTHER_DEMAND_ID),
      }),
      (error) => (
        error instanceof service.WakeflowTodoServiceError
        && error.code === "todo-archive-receipt-invalid"
      ),
    );
    assert.equal(existsSync(stage), true);
    assert.deepEqual(readFileSync(boardPath), boardBytes);
  });
});

test("archive rejects a stale row or mismatched receipt with zero writes", () => {
  const service = api();
  const { root, boardPath } = fixture();
  writeBoard(boardPath, [
    todoRow("TODO-a", {
      Status: "claimed",
      "Current Mount": `.wakeflow-active/current/${DEMAND_ID}`,
    }),
    todoRow("TODO-b"),
  ]);
  const before = service.scanTodoBoard(readFileSync(boardPath, "utf8"));
  const stale = {
    ...before.rows[0].snapshot,
    row: before.rows[0].snapshot.row.replace("TODO-a", "TODO-tampered"),
  };
  const bytes = readFileSync(boardPath, "utf8");

  assert.throws(
    () => service.archiveTodoRow({
      root,
      boardPath,
      expectedRow: stale,
      archiveReceipt: archiveReceipt(before.rows[0].snapshot),
    }),
    service.WakeflowTodoServiceError,
  );
  assert.throws(
    () => service.archiveTodoRow({
      root,
      boardPath,
      expectedRow: before.rows[0].snapshot,
      archiveReceipt: archiveReceipt(before.rows[0].snapshot, OTHER_DEMAND_ID),
    }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-archive-receipt-invalid",
  );
  assert.equal(readFileSync(boardPath, "utf8"), bytes);
  assertNoPrivateStages(boardPath);
});

test("concurrent appenders serialize without dropping either row", async () => {
  const service = api();
  const { root, boardPath } = fixture();
  service.createTodoBoardIfAbsent({ root, boardPath, freshWorkspace: true });
  const results = await Promise.all([
    runChild(childCall("appendTodoRow", { root, boardPath, row: todoRow("TODO-concurrent-a") })),
    runChild(childCall("appendTodoRow", { root, boardPath, row: todoRow("TODO-concurrent-b") })),
  ]);
  assert.deepEqual(results.map((entry) => entry.code), [0, 0], JSON.stringify(results));
  const board = service.scanTodoBoard(readFileSync(boardPath, "utf8"));
  assert.deepEqual(new Set(board.rows.map((entry) => entry.id)), new Set(["TODO-concurrent-a", "TODO-concurrent-b"]));
  assert.equal(existsSync(`${boardPath}.lock`), false);
  assertNoPrivateStages(boardPath);
});

test("concurrent claim attempts against one exact snapshot allow exactly one commit", async () => {
  const service = api();
  const { root, boardPath } = fixture();
  writeBoard(boardPath, [todoRow("TODO-concurrent-claim")]);
  const expectedRow = service.scanTodoBoard(readFileSync(boardPath, "utf8")).rows[0].snapshot;
  const args = {
    root,
    boardPath,
    todoId: "TODO-concurrent-claim",
    expectedRow,
    mount: demandMount(),
  };
  const results = await Promise.all([
    runChild(childCall("claimTodoRow", args)),
    runChild(childCall("claimTodoRow", args)),
  ]);
  assert.deepEqual(results.map((entry) => entry.code).sort(), [0, 1], JSON.stringify(results));
  const board = service.scanTodoBoard(readFileSync(boardPath, "utf8"));
  assert.equal(board.rows[0].value.Status, "claimed");
  assert.equal(board.rows[0].value["Current Mount"], `.wakeflow-active/current/${DEMAND_ID}`);
  assert.equal(existsSync(`${boardPath}.lock`), false);
  assertNoPrivateStages(boardPath);
});

test("concurrent recovery attempts share the claim lock and both close on one exact commit", async () => {
  const service = api();
  const { root, boardPath } = fixture();
  writeBoard(boardPath, [todoRow("TODO-concurrent-recovery")]);
  const expectedRow = service.scanTodoBoard(readFileSync(boardPath, "utf8")).rows[0].snapshot;
  const args = {
    root,
    boardPath,
    todoId: "TODO-concurrent-recovery",
    expectedRow,
    mount: demandMount(),
  };
  const results = await Promise.all([
    runChild(childCall("recoverTodoRowClaim", args)),
    runChild(childCall("recoverTodoRowClaim", args)),
  ]);
  assert.deepEqual(results.map((entry) => entry.code), [0, 0], JSON.stringify(results));
  const board = service.scanTodoBoard(readFileSync(boardPath, "utf8"));
  assert.equal(board.rows[0].value.Status, "claimed");
  assert.equal(board.rows[0].value["Current Mount"], `.wakeflow-active/current/${DEMAND_ID}`);
  assert.equal(existsSync(`${boardPath}.lock`), false);
  assertNoPrivateStages(boardPath);
});

test("filesystem entrypoints require the fixed path, an existing parent, and a non-symlink board", () => {
  const service = api();
  const missingParentRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-todo-service-parent-"));
  const missingParentBoard = path.join(missingParentRoot, ".wakeflow-active", "current", "global-todo-board.md");
  assert.throws(
    () => service.createTodoBoardIfAbsent({
      root: missingParentRoot,
      boardPath: missingParentBoard,
      freshWorkspace: true,
    }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-board-parent-missing",
  );
  assert.equal(existsSync(path.join(missingParentRoot, ".wakeflow-active")), false);

  const { root, boardPath } = fixture();
  const arbitraryBoard = path.join(root, "other-board.md");
  assert.throws(
    () => service.createTodoBoardIfAbsent({
      root,
      boardPath: arbitraryBoard,
      freshWorkspace: true,
    }),
    (error) => error instanceof service.WakeflowTodoServiceError && error.code === "todo-board-path-invalid",
  );
  assert.equal(existsSync(arbitraryBoard), false);

  const outside = path.join(root, "outside.md");
  writeFileSync(outside, EXPECTED_EMPTY_BOARD);
  symlinkSync(outside, boardPath);

  assert.throws(
    () => service.appendTodoRow({ root, boardPath, row: todoRow("TODO-symlink") }),
  );
  assert.equal(readFileSync(outside, "utf8"), EXPECTED_EMPTY_BOARD);
});
