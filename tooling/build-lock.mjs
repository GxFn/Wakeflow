#!/usr/bin/env node
// Wakeflow Tooling / Build lock: `npm run locked -- <command> [args...]`.
//
// Every command that compiles into `.build/` or rewrites `plugins/` must hold the one repository
// build lock: two `tsc -b` runs into the same output directory, or a focused test compile landing
// while a full gate still reads `.build/`, produce mixed bytes and flaky failures (gate-log
// §13.161). This file stays plain JavaScript so it needs no compile step of its own; the
// TypeScript side (`tooling/build-lock.ts`) implements the same directory protocol for `wf`.
//
// Protocol: `mkdir .build/locks/build.lock` is the atomic claim; `owner.json` inside names the
// owner (pid, token, command, start). A claim whose owner process is gone is stale and is
// removed; a live owner is waited for, with a progress line every 30 seconds, until
// WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS (default 3600) elapses, then exit 75 (EX_TEMPFAIL). A child
// inherits WAKEFLOW_BUILD_LOCK_TOKEN, so nested locked commands re-enter instead of deadlocking.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const LOCK_RELATIVE = ".build/locks/build.lock";
const TOKEN_VARIABLE = "WAKEFLOW_BUILD_LOCK_TOKEN";
const TIMEOUT_VARIABLE = "WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS";
const EXIT_TEMPFAIL = 75;
const POLL_MILLISECONDS = 500;
const REPORT_MILLISECONDS = 30_000;

function readOwner(lockDirectory) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(lockDirectory, "owner.json"), "utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function ownerAlive(owner) {
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return !(error !== null && typeof error === "object" && error.code === "ESRCH");
  }
}

function timeoutMilliseconds(environment) {
  const raw = environment[TIMEOUT_VARIABLE];
  if (raw === undefined) return 3600 * 1000;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    process.stderr.write(`build lock: ${TIMEOUT_VARIABLE} must be a non-negative number\n`);
    process.exit(2);
  }
  return seconds * 1000;
}

/** Returns a release function, or null when an ancestor already holds the lock. */
async function acquire(root, token, command) {
  const lockDirectory = path.join(root, ...LOCK_RELATIVE.split("/"));
  mkdirSync(path.dirname(lockDirectory), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMilliseconds(process.env);
  let lastReport = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDirectory, { mode: 0o700 });
    } catch (error) {
      if (!(error !== null && typeof error === "object" && error.code === "EEXIST")) throw error;
      const owner = readOwner(lockDirectory);
      const inherited = process.env[TOKEN_VARIABLE];
      if (owner !== null && inherited !== undefined && owner.token === inherited) return null;
      if (owner !== null && !ownerAlive(owner)) {
        process.stderr.write(`build lock: removing stale claim of exited pid ${owner.pid}\n`);
        rmSync(lockDirectory, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        process.stderr.write(
          `build lock: still held by pid ${owner?.pid ?? "?"} (${owner?.command ?? "?"}); giving up\n`,
        );
        process.exit(EXIT_TEMPFAIL);
      }
      if (Date.now() - lastReport >= REPORT_MILLISECONDS) {
        lastReport = Date.now();
        process.stderr.write(
          `build lock: waiting for pid ${owner?.pid ?? "?"} (${owner?.command ?? "claiming"})\n`,
        );
      }
      await delay(POLL_MILLISECONDS);
      continue;
    }
    writeFileSync(
      path.join(lockDirectory, "owner.json"),
      `${JSON.stringify({ pid: process.pid, token, command, startedAt: new Date().toISOString() })}\n`,
      { mode: 0o600 },
    );
    return () => rmSync(lockDirectory, { recursive: true, force: true });
  }
}

const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();
if (argv.length === 0) {
  process.stderr.write("usage: npm run locked -- <command> [args...]\n");
  process.exit(2);
}
// A fresh token per claim; a re-entered command keeps the ancestor's token it inherited.
const token = randomUUID();
const release = await acquire(process.cwd(), token, argv.join(" ").slice(0, 200));
const child = spawn(argv[0], argv.slice(1), {
  stdio: "inherit",
  shell: false,
  env: { ...process.env, [TOKEN_VARIABLE]: release === null ? process.env[TOKEN_VARIABLE] : token },
});
const forward = (signal) => {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
};
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
child.on("error", (error) => {
  process.stderr.write(`build lock: could not start ${argv[0]}: ${error.code ?? "error"}\n`);
  release?.();
  process.exit(2);
});
child.on("close", (code, signal) => {
  release?.();
  process.exit(code ?? (signal === null ? 1 : 128 + 15));
});
