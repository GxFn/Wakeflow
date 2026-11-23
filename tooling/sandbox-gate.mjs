#!/usr/bin/env node
// Wakeflow Tooling / Sandbox gate: `npm run gate:sandbox [-- <commit>]`.
//
// The full gate runs on a commit, in a throwaway checkout beside the development tree, so the
// development tree stays free for edits and quick checks while it runs (open-items D13). The
// checkout is a detached `git worktree` of that commit: only committed files, its own `.build/`
// and build lock. Dependencies are an APFS copy-on-write clone of this tree's `node_modules`
// (`cp -c`, about a second, no extra disk); macOS is the only supported platform (ADR-0021).
// The gate itself is the ordinary `wf verify gate`, started with `nice` so that work in the
// development tree wins when both want the CPU.
//
// The receipt belongs to the commit, not to a working tree. The run directory is copied to
// `.build/sandbox-gate/<commit>/` here. A passing run removes its checkout; a failing run keeps
// it for inspection and prints where it is. Start it in the background; nothing waits for it.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const tree = process.cwd();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error !== undefined) throw result.error;
  return result;
}

function git(args, cwd = tree) {
  const result = run("git", args, { cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function latestReceiptDirectory(sandbox) {
  const base = path.join(sandbox, ".build", "verification");
  if (!existsSync(base)) return null;
  const runs = readdirSync(base)
    .map((name) => path.join(base, name))
    .filter((directory) => existsSync(path.join(directory, "receipt.json")))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return runs[0] ?? null;
}

const commit = git(["rev-parse", "--short=12", `${process.argv[2] ?? "HEAD"}^{commit}`]);
const sandbox = path.join(path.dirname(tree), `gate-${commit}`);
if (existsSync(sandbox)) {
  throw new Error(`A sandbox for ${commit} already exists: remove it first (git worktree remove).`);
}
if (git(["status", "--porcelain", "--untracked-files=no"]) !== "") {
  process.stderr.write("sandbox gate: uncommitted changes here are not part of the gated commit\n");
}

git(["worktree", "add", "--detach", sandbox, commit]);
const cloned = run("cp", ["-c", "-R", path.join(tree, "node_modules"), sandbox]);
if (cloned.status !== 0) throw new Error(`Cannot clone node_modules: ${cloned.stderr.trim()}`);

// The sandbox takes its own build lock: do not hand it this tree's lock token.
const environment = { ...process.env };
delete environment.WAKEFLOW_BUILD_LOCK_TOKEN;
const gate = run("nice", ["-n", "10", "npm", "run", "--silent", "wf", "--", "verify", "gate"], {
  cwd: sandbox,
  env: environment,
  stdio: "inherit",
});

const receiptDirectory = latestReceiptDirectory(sandbox);
// The test counts are in the summary `wf verify` prints above; the receipt carries the status.
let summary = { status: "unavailable", receipt: null };
if (receiptDirectory !== null) {
  const kept = path.join(tree, ".build", "sandbox-gate", commit);
  mkdirSync(path.dirname(kept), { recursive: true });
  cpSync(receiptDirectory, kept, { recursive: true });
  const receipt = JSON.parse(readFileSync(path.join(kept, "receipt.json"), "utf8"));
  summary = {
    status: receipt.status ?? "unavailable",
    receipt: path.relative(tree, path.join(kept, "receipt.json")),
  };
}
const passed = gate.status === 0 && summary.status === "passed";
if (passed) git(["worktree", "remove", "--force", sandbox]);
process.stdout.write(
  `${JSON.stringify({ kind: "WakeflowSandboxGate", commit, ...summary, sandbox: passed ? null : path.relative(tree, sandbox) }, null, 2)}\n`,
);
process.exitCode = passed ? 0 : 1;
