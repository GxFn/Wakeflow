import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  GitIgnoreObservationError,
  observeGitIgnorePaths,
  type GitIgnoreObservationErrorReason,
} from "../../../src/foundation/git/git-ignore-observation.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";

interface GitFixture {
  readonly absolutePath: string;
  readonly root: RootedDirectory;
}

async function fixture(
  t: TestContext,
  gitignore?: string,
  initializeGit = true,
): Promise<Readonly<GitFixture>> {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-git-ignore-observation-",
  ));
  if (initializeGit) {
    const initialized = spawnSync("git", ["init", "--quiet"], {
      cwd: absolutePath,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    if (initialized.status !== 0) {
      throw new Error("Disposable Git repository initialization failed.");
    }
  }
  if (gitignore !== undefined) {
    writeFileSync(path.join(absolutePath, ".gitignore"), gitignore, {
      mode: 0o644,
    });
  }
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function probes(...values: string[]): readonly PortableResourcePath[] {
  return Object.freeze(values.map((value) => parsePortableResourcePath(value)));
}

async function expectObservationError(
  action: () => Promise<unknown>,
  reason: GitIgnoreObservationErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof GitIgnoreObservationError, true);
  if (caught instanceof GitIgnoreObservationError) {
    equal(caught.code, "wakeflow-git-ignore-observation");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("Git ignore observation returns one ordered decision for every probe", async (t) => {
  const current = await fixture(
    t,
    "/*.log\n!/keep.log\n/.cache/\n",
  );
  const observed = await observeGitIgnorePaths(
    current.root,
    probes("ignored.log", "keep.log", ".cache/probe", "other.txt"),
  );

  deepEqual(observed.paths.map((entry) => entry.path), [
    "ignored.log",
    "keep.log",
    ".cache/probe",
    "other.txt",
  ]);
  deepEqual(observed.paths.map((entry) => entry.ignored), [
    true,
    false,
    true,
    false,
  ]);
  deepEqual(observed.paths.map((entry) => entry.decision), [
    {
      source: ".gitignore",
      lineNumber: 1,
      pattern: "/*.log",
      negated: false,
    },
    {
      source: ".gitignore",
      lineNumber: 2,
      pattern: "!/keep.log",
      negated: true,
    },
    {
      source: ".gitignore",
      lineNumber: 3,
      pattern: "/.cache/",
      negated: false,
    },
    null,
  ]);
  equal(Object.isFrozen(observed), true);
  equal(Object.isFrozen(observed.paths), true);
  equal(Object.isFrozen(observed.paths[0]?.decision), true);
});

test("Git ignore observation exposes source facts without assigning business authority", async (t) => {
  const current = await fixture(t);
  const infoDirectory = path.join(current.absolutePath, ".git", "info");
  mkdirSync(infoDirectory, { recursive: true });
  writeFileSync(
    path.join(infoDirectory, "exclude"),
    "/local-only/\n",
    { mode: 0o644 },
  );

  const observed = await observeGitIgnorePaths(
    current.root,
    probes("local-only/probe"),
  );
  equal(observed.paths[0]?.ignored, true);
  equal(observed.paths[0]?.decision?.source, ".git/info/exclude");
  equal(observed.paths[0]?.decision?.pattern, "/local-only/");
});

test("Git ignore observation neutralizes inherited Git repository and config redirection", async (t) => {
  const current = await fixture(t, "/current-only/\n");
  const redirected = await fixture(t, "/redirected-only/\n");
  const environmentKeys = [
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
    "GIT_DIR",
    "GIT_WORK_TREE",
  ] as const;
  const previous = new Map(environmentKeys.map((key) => [
    key,
    process.env[key],
  ]));
  t.after(() => {
    for (const key of environmentKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.GIT_DIR = path.join(redirected.absolutePath, ".git");
  process.env.GIT_WORK_TREE = redirected.absolutePath;
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "core.excludesFile";
  process.env.GIT_CONFIG_VALUE_0 = path.join(
    redirected.absolutePath,
    ".gitignore",
  );

  const observed = await observeGitIgnorePaths(
    current.root,
    probes("current-only/probe", "redirected-only/probe"),
  );
  equal(observed.paths[0]?.ignored, true);
  equal(observed.paths[0]?.decision?.source, ".gitignore");
  equal(observed.paths[1]?.ignored, false);
  equal(observed.paths[1]?.decision, null);
});

test("Git ignore observation rejects invalid inputs, cancellation, and non-repositories", async (t) => {
  await t.test("duplicate probes", async (subtest) => {
    const current = await fixture(subtest);
    await expectObservationError(
      () => observeGitIgnorePaths(
        current.root,
        probes("same/path", "same/path"),
      ),
      "input",
      "$probePaths/1",
    );
  });

  await t.test("behavioral probe array", async (subtest) => {
    const current = await fixture(subtest);
    let trapCalls = 0;
    const values = new Proxy(probes("safe/path"), {
      getPrototypeOf: () => {
        trapCalls += 1;
        return Array.prototype;
      },
    });
    await expectObservationError(
      () => observeGitIgnorePaths(current.root, values),
      "input",
      "$probePaths",
    );
    equal(trapCalls, 0);
  });

  await t.test("pre-aborted", async (subtest) => {
    const current = await fixture(subtest);
    const controller = new AbortController();
    controller.abort();
    await expectObservationError(
      () => observeGitIgnorePaths(
        current.root,
        probes("safe/path"),
        { signal: controller.signal },
      ),
      "aborted",
      "$options.signal",
    );
  });

  await t.test("non Git root", async (subtest) => {
    const current = await fixture(subtest, undefined, false);
    await expectObservationError(
      () => observeGitIgnorePaths(current.root, probes("safe/path")),
      "query-failure",
      "$git",
    );
  });

  await t.test("closed root", async (subtest) => {
    const current = await fixture(subtest);
    await current.root.close();
    await expectObservationError(
      () => observeGitIgnorePaths(current.root, probes("safe/path")),
      "root-scope",
      "$root",
    );
  });
});
