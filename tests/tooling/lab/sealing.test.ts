import { equal, ok, rejects, throws } from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { createLab, disposeLab, inspectLab } from "../../../tooling/lab/lab.js";

test("an inventory written before final receipt failure cannot authorize later lab operations", {
  timeout: 90_000,
}, async (t) => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-lab-sealing-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repository = path.join(base, "Reports");
  const root = path.join(base, "Lab");
  mkdirSync(repository);
  const original = Client.prototype.callTool;
  t.mock.method(
    Client.prototype,
    "callTool",
    async function (this: Client, ...args: Parameters<Client["callTool"]>) {
      const result = await Reflect.apply(original, this, args);
      if (args[0].name === "wakeflow_maintain_workspace" && args[0].arguments?.mode === "apply") {
        const reports = path.join(repository, ".build/labs");
        const id = readdirSync(reports)[0];
        ok(id);
        // The final atomic publication must not overwrite an unknown staging file.
        writeFileSync(path.join(reports, id, "creation.json.next"), "unrecognized staged report", {
          flag: "wx",
        });
      }
      return result;
    },
  );
  await rejects(
    createLab(repository, root, path.join(process.cwd(), "plugins/codex-wakeflow")),
    /EEXIST/,
  );
  const reports = path.join(repository, ".build/labs");
  const id = readdirSync(reports)[0];
  ok(id);
  equal(existsSync(path.join(reports, id, "resources.json")), true);
  equal(
    JSON.parse(readFileSync(path.join(reports, id, "creation.json"), "utf8")).status,
    "running",
  );
  throws(() => inspectLab(repository, id), /lab-creation-not-completed/);
  await rejects(disposeLab(repository, id), /lab-creation-not-completed/);
  equal(
    readFileSync(path.join(reports, id, "creation.json.next"), "utf8"),
    "unrecognized staged report",
  );
  equal(existsSync(root), true);
});

test("worktree disposal preserves a same-byte replacement of an owned output", {
  timeout: 240_000,
}, async (t) => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-worktree-identity-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repository = path.join(base, "Reports");
  const root = path.join(base, "Lab");
  mkdirSync(repository);
  const original = Client.prototype.callTool;
  let replacement: Buffer | undefined;
  t.mock.method(
    Client.prototype,
    "callTool",
    async function (this: Client, ...args: Parameters<Client["callTool"]>) {
      const result = await Reflect.apply(original, this, args);
      const request = args[0];
      const intent = request.arguments?.intent as { kind?: string } | undefined;
      if (
        replacement === undefined &&
        request.name === "wakeflow_pod" &&
        request.arguments?.mode === "apply" &&
        intent?.kind === "close"
      ) {
        const file = path.join(root, "Worktree-Alpha/verification.json");
        replacement = readFileSync(file);
        writeFileSync(`${file}.replacement`, replacement, { flag: "wx", mode: 0o600 });
        renameSync(`${file}.replacement`, file);
      }
      return result;
    },
  );
  const result = await createLab(
    repository,
    root,
    path.join(process.cwd(), "plugins/codex-wakeflow"),
    undefined,
    "worktree",
  );
  equal(result.status, "failed");
  equal(result.reason, "lab-resource-drift");
  ok(replacement);
  equal(
    readFileSync(path.join(root, "Worktree-Alpha/verification.json")).equals(replacement),
    true,
  );
  ok(existsSync(path.join(root, "Worktree-Alpha/summarize.mjs")));
  ok(existsSync(path.join(root, "Worktree-Alpha/.git")));
  await rejects(disposeLab(repository, result.id));
});
