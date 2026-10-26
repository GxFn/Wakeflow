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
// owner (pid, token, command, start). A claim whose owner process is gone is stale and is reclaimed
// by a waiter: it creates the `reclaim` marker inside the claim exclusively (`wx`), re-reads the
// directory identity and the owner text, and only when both still equal what it observed renames
// the directory away and removes it - so two waiters that read the same dead owner never delete
// each other's fresh claim (open-items W24); an existing marker means another waiter is reclaiming.
// A claim without `owner.json` is a claimant still writing it until OWNERLESS_STALE_MILLISECONDS
// pass, then it is reclaimed the same way; a claimant whose owner write fails removes its own claim
// at once (W25). A live owner is waited for, with a progress line every 30 seconds, until
// WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS (default 3600) elapses, then exit 75 (EX_TEMPFAIL). A child
// inherits WAKEFLOW_BUILD_LOCK_TOKEN, so nested locked commands re-enter instead of deadlocking.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const LOCK_RELATIVE = ".build/locks/build.lock";
const TOKEN_VARIABLE = "WAKEFLOW_BUILD_LOCK_TOKEN";
const TIMEOUT_VARIABLE = "WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS";
const EXIT_TEMPFAIL = 75;
const POLL_MILLISECONDS = 500;
const REPORT_MILLISECONDS = 30_000;
// A claim without owner.json is stale once it is this old (its claimant died between mkdir and the
// owner write); a younger one is "the owner is being written". Same value as in build-lock.ts.
const OWNERLESS_STALE_MILLISECONDS = 10_000;
const OWNER_FILE = "owner.json";
const RECLAIM_MARKER = "reclaim";

function errorCode(error) {
  return error !== null && typeof error === "object" && typeof error.code === "string"
    ? error.code
    : undefined;
}

function parseOwner(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Null when the directory is gone or its owner.json cannot be read (someone else's claim: wait). */
function observeClaim(lockDirectory) {
  let stat;
  try {
    stat = statSync(lockDirectory, { bigint: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  let ownerText = null;
  try {
    ownerText = readFileSync(path.join(lockDirectory, OWNER_FILE), "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") return null;
  }
  return {
    ino: stat.ino,
    ageMs: Date.now() - Number(stat.mtimeMs),
    ownerText,
    owner: ownerText === null ? null : parseOwner(ownerText),
  };
}

function ownerAlive(owner) {
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

function claimStale(claim) {
  return claim.owner === null
    ? claim.ageMs > OWNERLESS_STALE_MILLISECONDS
    : !ownerAlive(claim.owner);
}

/**
 * Reclaims a claim observed as stale. Returns true when the claim path is free again (retry the
 * claim at once) and false when the caller should keep waiting: the marker already exists (another
 * waiter is reclaiming) or the re-read no longer matches the observation (someone reclaimed and
 * claimed anew; the own marker is withdrawn). Removal renames the directory to a unique sibling
 * first, so the recursive delete never crosses into a freshly re-claimed directory and is never
 * interrupted by a waiter's marker.
 */
function reclaimStaleClaim(lockDirectory, observed, description) {
  const marker = path.join(lockDirectory, RECLAIM_MARKER);
  const reclaimToken = randomUUID();
  try {
    writeFileSync(
      marker,
      `${JSON.stringify({ pid: process.pid, token: reclaimToken, startedAt: new Date().toISOString() })}\n`,
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    const code = errorCode(error);
    if (code === "EEXIST") return false;
    if (code === "ENOENT") return true;
    throw error;
  }
  const current = observeClaim(lockDirectory);
  if (
    current !== null &&
    current.ino === observed.ino &&
    current.ownerText === observed.ownerText
  ) {
    process.stderr.write(`build lock: removing ${description}\n`);
    const retired = `${lockDirectory}.stale-${reclaimToken}`;
    try {
      renameSync(lockDirectory, retired);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return true;
      throw error;
    }
    rmSync(retired, { recursive: true, force: true });
    return true;
  }
  try {
    if (parseOwner(readFileSync(marker, "utf8"))?.token === reclaimToken) {
      rmSync(marker, { force: true });
    }
  } catch {
    // The marker vanished together with the directory.
  }
  return false;
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

function describeStaleClaim(claim) {
  return claim.owner === null
    ? `claim without owner (older than ${OWNERLESS_STALE_MILLISECONDS / 1000} s)`
    : `stale claim of exited pid ${claim.owner.pid}`;
}

function ownerLabel(owner, fallbackCommand) {
  return `pid ${owner?.pid ?? "?"} (${owner?.command ?? fallbackCommand})`;
}

/** Writes owner.json into the claim just made; a failed write removes the claim before rethrowing. */
function recordOwner(lockDirectory, token, command) {
  try {
    writeFileSync(
      path.join(lockDirectory, OWNER_FILE),
      `${JSON.stringify({ pid: process.pid, token, command, startedAt: new Date().toISOString() })}\n`,
      { mode: 0o600 },
    );
  } catch (error) {
    // The claim never got its owner: remove it at once so waiters do not sit on an ownerless claim.
    try {
      rmSync(lockDirectory, { recursive: true, force: true });
    } catch {
      // The write error is the one to report.
    }
    throw error;
  }
}

/** Returns a release function, or null when an ancestor already holds the lock. */
async function acquire(root, token, command) {
  const lockDirectory = path.join(root, ...LOCK_RELATIVE.split("/"));
  mkdirSync(path.dirname(lockDirectory), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMilliseconds(process.env);
  const inherited = process.env[TOKEN_VARIABLE];
  let lastReport = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDirectory, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const claim = observeClaim(lockDirectory);
      const owner = claim?.owner ?? null;
      if (owner !== null && inherited !== undefined && owner.token === inherited) return null;
      if (claim !== null && claimStale(claim)) {
        if (reclaimStaleClaim(lockDirectory, claim, describeStaleClaim(claim))) continue;
      }
      if (Date.now() >= deadline) {
        process.stderr.write(`build lock: still held by ${ownerLabel(owner, "?")}; giving up\n`);
        process.exit(EXIT_TEMPFAIL);
      }
      if (Date.now() - lastReport >= REPORT_MILLISECONDS) {
        lastReport = Date.now();
        process.stderr.write(`build lock: waiting for ${ownerLabel(owner, "claiming")}\n`);
      }
      await delay(POLL_MILLISECONDS);
      continue;
    }
    recordOwner(lockDirectory, token, command);
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
