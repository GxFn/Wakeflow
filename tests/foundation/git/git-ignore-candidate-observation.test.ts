import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  GitIgnoreCandidateObservationError,
  observeGitIgnoreCandidate,
  type GitIgnoreCandidateObservationErrorReason,
} from "../../../src/foundation/git/git-ignore-candidate-observation.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";

const GIT_IGNORE_CANDIDATE_MAXIMUM_BYTES = 2 * 1024 * 1024;

interface GitFixture {
  readonly absolutePath: string;
  readonly gitignorePath: string;
  readonly root: RootedDirectory;
}

async function fixture(
  t: TestContext,
  gitignore?: string,
  initializeGit = true,
): Promise<Readonly<GitFixture>> {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-git-ignore-candidate-test-",
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
  const gitignorePath = path.join(absolutePath, ".gitignore");
  if (gitignore !== undefined) {
    writeFileSync(gitignorePath, gitignore, { mode: 0o644 });
  }
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, gitignorePath, root });
}

function probes(...values: string[]): readonly PortableResourcePath[] {
  return Object.freeze(values.map((value) => parsePortableResourcePath(value)));
}

async function expectCandidateError(
  action: () => Promise<unknown>,
  reason: GitIgnoreCandidateObservationErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof GitIgnoreCandidateObservationError, true);
  if (caught instanceof GitIgnoreCandidateObservationError) {
    equal(caught.code, "wakeflow-git-ignore-candidate-observation");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("Git ignore candidate is observed in an isolated worktree without changing the repository", async (t) => {
  const current = await fixture(t, "/actual-only/\n");
  const original = readFileSync(current.gitignorePath);
  const candidate = Buffer.from(
    "/*.log\n!/keep.log\n/candidate-only/\n",
  );
  const observed = await observeGitIgnoreCandidate(
    current.root,
    candidate,
    probes(
      "actual-only/probe",
      "candidate-only/probe",
      "error.log",
      "keep.log",
    ),
  );

  equal(observed.candidateByteCount, candidate.byteLength);
  equal(observed.candidateDigest, computeSha256Digest(candidate));
  deepEqual(observed.paths.map((entry) => entry.ignored), [
    false,
    true,
    true,
    false,
  ]);
  deepEqual(observed.paths.map((entry) => entry.decision?.source ?? null), [
    null,
    ".gitignore",
    ".gitignore",
    ".gitignore",
  ]);
  equal(observed.paths[3]?.decision?.pattern, "!/keep.log");
  deepEqual(readFileSync(current.gitignorePath), original);
});

test("Git ignore candidate preserves non-candidate source facts for its caller", async (t) => {
  const current = await fixture(t);
  const infoDirectory = path.join(current.absolutePath, ".git", "info");
  mkdirSync(infoDirectory, { recursive: true });
  writeFileSync(
    path.join(infoDirectory, "exclude"),
    "/local-only/\n",
    { mode: 0o644 },
  );

  const observed = await observeGitIgnoreCandidate(
    current.root,
    Buffer.from("/candidate-only/\n"),
    probes("local-only/probe", "candidate-only/probe"),
  );
  equal(observed.paths[0]?.ignored, true);
  const localSource = observed.paths[0]?.decision?.source;
  equal(
    localSource === ".git/info/exclude"
      || localSource?.endsWith("/.git/info/exclude") === true,
    true,
  );
  equal(observed.paths[1]?.ignored, true);
  equal(observed.paths[1]?.decision?.source, ".gitignore");
});

test("Git ignore candidate snapshots caller bytes before asynchronous isolation", async (t) => {
  const current = await fixture(t);
  const candidate = Buffer.from("/stable/\n");
  const expectedDigest = computeSha256Digest(candidate);
  const pending = observeGitIgnoreCandidate(
    current.root,
    candidate,
    probes("stable/probe", "changed/probe"),
  );
  candidate.fill(0x78);
  const observed = await pending;

  equal(observed.candidateDigest, expectedDigest);
  equal(observed.paths[0]?.ignored, true);
  equal(observed.paths[1]?.ignored, false);
});

test("Git ignore candidate rejects capacity, cancellation, and invalid repositories", async (t) => {
  await t.test("capacity", async (subtest) => {
    const current = await fixture(subtest);
    const oversized = Buffer.alloc(
      GIT_IGNORE_CANDIDATE_MAXIMUM_BYTES + 1,
    );
    await expectCandidateError(
      () => observeGitIgnoreCandidate(
        current.root,
        oversized,
        probes("safe/path"),
      ),
      "capacity",
      "$candidateBytes",
    );
  });

  await t.test("behavioral bytes", async (subtest) => {
    const current = await fixture(subtest);
    let trapCalls = 0;
    const candidate = new Proxy(Buffer.from("/safe/\n"), {
      getPrototypeOf: () => {
        trapCalls += 1;
        return Buffer.prototype;
      },
    });
    await expectCandidateError(
      () => observeGitIgnoreCandidate(
        current.root,
        candidate,
        probes("safe/path"),
      ),
      "input",
      "$candidateBytes",
    );
    equal(trapCalls, 0);
  });

  await t.test("pre-aborted", async (subtest) => {
    const current = await fixture(subtest);
    const controller = new AbortController();
    controller.abort();
    await expectCandidateError(
      () => observeGitIgnoreCandidate(
        current.root,
        Buffer.from("/safe/\n"),
        probes("safe/path"),
        { signal: controller.signal },
      ),
      "aborted",
      "$options.signal",
    );
  });

  await t.test("non Git repository", async (subtest) => {
    const current = await fixture(subtest, undefined, false);
    await expectCandidateError(
      () => observeGitIgnoreCandidate(
        current.root,
        Buffer.from("/safe/\n"),
        probes("safe/path"),
      ),
      "observation-failure",
      "$git",
    );
  });

  await t.test("closed repository root", async (subtest) => {
    const current = await fixture(subtest);
    await current.root.close();
    await expectCandidateError(
      () => observeGitIgnoreCandidate(
        current.root,
        Buffer.from("/safe/\n"),
        probes("safe/path"),
      ),
      "root-scope",
      "$repositoryRoot",
    );
  });
});
