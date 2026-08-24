#!/usr/bin/env node

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  prepareWakeflowCommand,
  runSync,
} from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const allowedGitTails = [
  ["rev-parse", "--is-inside-work-tree"],
  ["rev-parse", "--show-toplevel"],
  ["rev-parse", "--verify", "HEAD"],
  ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=none"],
  ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
  ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
];

test("wakeflow process boundary allows exactly the six current read-only Git observations", () => {
  for (const tail of allowedGitTails) {
    const args = ["-C", repositoryRoot, ...tail];
    assert.deepEqual(prepareWakeflowCommand("git", args), {
      kind: "git",
      command: "git",
      args,
    });
  }

  const result = runSync("git", ["-C", repositoryRoot, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "true");
});

test("wakeflow Git observations ignore inherited repository and config redirection", () => {
  const result = runSync("git", ["-C", repositoryRoot, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_GLOBAL: path.join(repositoryRoot, "missing-global-git-config"),
      GIT_CONFIG_KEY_0: "alias.rev-parse",
      GIT_CONFIG_VALUE_0: "!exit 23",
      GIT_DIR: path.join(repositoryRoot, "missing-git-dir"),
      GIT_INDEX_FILE: path.join(repositoryRoot, "missing-git-index"),
      GIT_OPTIONAL_LOCKS: "1",
      GIT_TRACE: "1",
      GIT_WORK_TREE: path.join(repositoryRoot, "missing-git-work-tree"),
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "true");
  assert.doesNotMatch(result.stderr, /trace:/iu);
});

test("wakeflow process request admission does not execute command, argument, option, or environment accessors", () => {
  let getterCalls = 0;
  const command = {
    toString() {
      getterCalls += 1;
      return "git";
    },
  };
  assert.throws(
    () => prepareWakeflowCommand(command, []),
    /command must be a string/,
  );

  const accessorArgs = ["-C", repositoryRoot, "rev-parse", "--is-inside-work-tree"];
  Object.defineProperty(accessorArgs, "2", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "rev-parse";
    },
  });
  assert.throws(
    () => prepareWakeflowCommand("git", accessorArgs),
    /standard dense array of strings/,
  );

  const accessorOptions = {};
  Object.defineProperty(accessorOptions, "shell", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return true;
    },
  });
  assert.throws(
    () => prepareWakeflowCommand("git", ["-C", repositoryRoot, "rev-parse", "--is-inside-work-tree"], accessorOptions),
    /enumerable data property/,
  );

  const accessorEnvironment = {};
  Object.defineProperty(accessorEnvironment, "PATH", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return process.env.PATH;
    },
  });
  assert.throws(
    () => prepareWakeflowCommand("git", ["-C", repositoryRoot, "rev-parse", "--is-inside-work-tree"], {
      env: accessorEnvironment,
    }),
    /environment must contain only enumerable string data properties/,
  );
  assert.equal(getterCalls, 0);
});

test("wakeflow process boundary admits only fixed Darwin process-identity ps queries", () => {
  if (process.platform !== "darwin") return;
  for (const field of ["command", "comm", "lstart", "ppid"]) {
    const prepared = prepareWakeflowCommand("/bin/ps", [
      "-o",
      `${field}=`,
      "-p",
      String(process.pid),
    ]);
    assert.equal(prepared.kind, "ps-process-identity");
    assert.equal(prepared.command, "/bin/ps");
  }
  for (const args of [
    ["-o", "env=", "-p", String(process.pid)],
    ["-o", "command=", "-p", "0"],
    ["-o", "command=", "-p", `${process.pid};whoami`],
    ["-axo", "pid,command"],
  ]) {
    assert.throws(
      () => prepareWakeflowCommand("/bin/ps", args),
      /Unsupported Wakeflow Darwin process-identity ps arguments/,
    );
  }
});

test("wakeflow process boundary rejects Git mutation, broad reads, and argument drift", () => {
  for (const args of [
    ["--version"],
    ["status", "--short"],
    ["-C", repositoryRoot, "status", "--short"],
    ["-C", repositoryRoot, "add", "."],
    ["-C", repositoryRoot, "commit", "-m", "unexpected"],
    ["-C", repositoryRoot, "worktree", "list"],
    ["-C", "", "rev-parse", "--show-toplevel"],
    ["-C", ".", "rev-parse", "--show-toplevel"],
    ["-C", `${repositoryRoot}${path.sep}.`, "rev-parse", "--show-toplevel"],
    ["-C", repositoryRoot, "rev-parse", "--verify", "HEAD", "extra"],
  ]) {
    assert.throws(
      () => prepareWakeflowCommand("git", args),
      /Unsupported Wakeflow Git observation query/,
    );
  }
});

test("wakeflow process boundary rejects every retired command family and shell mode", () => {
  assert.throws(
    () => runSync("sh", ["-c", "echo no"], { shell: true }),
    /shell mode|Unsupported Wakeflow process command/,
  );
  assert.throws(
    () => runSync("curl", ["https://example.invalid"], { encoding: "utf8" }),
    /Unsupported Wakeflow process command/,
  );
  assert.throws(
    () => runSync(process.execPath, ["-e", "console.log('no')"], { encoding: "utf8" }),
    /Unsupported Wakeflow process command/,
  );
  for (const command of [
    "node",
    "ps",
    "caffeinate",
    path.join(repositoryRoot, "plugins/codex-wakeflow/bin/wakeflow-mcp"),
  ]) {
    assert.throws(
      () => prepareWakeflowCommand(command, []),
      /Unsupported Wakeflow process command/,
    );
  }
  assert.throws(
    () => prepareWakeflowCommand("git", ["-C", repositoryRoot, 42]),
    /standard dense array of strings/,
  );
  assert.throws(
    () => prepareWakeflowCommand("git", ["-C", repositoryRoot, "rev-parse", "--show-toplevel"], { shell: "" }),
    /forbids shell mode/,
  );
  assert.throws(
    () => prepareWakeflowCommand("git", ["-C", repositoryRoot, "rev-parse", "--show-toplevel"], {
      maxBuffer: 64 * 1024 * 1024 + 1,
    }),
    /maxBuffer/,
  );
  assert.throws(
    () => prepareWakeflowCommand("git", ["-C", repositoryRoot, "rev-parse", "--show-toplevel"], {
      stdio: ["inherit", "pipe", "pipe"],
    }),
    /stdio must be exactly/,
  );
});
