import { equal, rejects } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  createWindowWorkClaimInStore,
  inspectWindowWorkClaim,
  releaseWindowWorkClaimInStore,
  WindowWorkClaimStoreError,
} from "../../../src/governance/delivery/window-work-claim-store.js";
import { WINDOW_WORK_CLAIMS_ROOT_REF } from "../../../src/governance/delivery/window-work-claim-resource-catalog.js";
import {
  createWindowWorkClaimFixture,
  OTHER_WINDOW_WORK_CLAIM_ID,
} from "./window-work-claim.fixture.js";

async function fixture(t: TestContext): Promise<
  Readonly<{
    readonly path: string;
    readonly root: RootedDirectory;
  }>
> {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-work-claim-"));
  let current = rootPath;
  for (const segment of WINDOW_WORK_CLAIMS_ROOT_REF.split("/")) {
    current = path.join(current, segment);
    mkdirSync(current, { mode: 0o700 });
  }
  const root = await RootedDirectory.open(rootPath);
  t.after(async () => {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  });
  return Object.freeze({ path: rootPath, root });
}

test("Claim Store执行零写inspect、exclusive create、幂等重放和exact release", async (t) => {
  const value = await fixture(t);
  const claim = createWindowWorkClaimFixture();
  equal(
    (await inspectWindowWorkClaim(value.root, claim.route.windowId)).status,
    "absent",
  );
  equal(
    readdirSync(
      path.join(value.path, ...WINDOW_WORK_CLAIMS_ROOT_REF.split("/")),
    ).length,
    0,
  );

  const created = await createWindowWorkClaimInStore(value.root, claim);
  equal(created.disposition, "created");
  equal(created.claim.claimDigest, claim.claimDigest);
  equal(created.source.node.permissionBits, 0o600);
  equal(
    statSync(path.join(value.path, ...created.source.resourcePath.split("/")))
      .mode & 0o777,
    0o600,
  );
  const replayed = await createWindowWorkClaimInStore(value.root, claim);
  equal(replayed.disposition, "current");

  const occupied = createWindowWorkClaimFixture(OTHER_WINDOW_WORK_CLAIM_ID);
  await rejects(
    createWindowWorkClaimInStore(value.root, occupied),
    (error: unknown) =>
      error instanceof WindowWorkClaimStoreError &&
      error.reason === "occupied" &&
      error.claimAuthority === "current",
  );
  await rejects(
    releaseWindowWorkClaimInStore(value.root, occupied),
    (error: unknown) =>
      error instanceof WindowWorkClaimStoreError &&
      error.reason === "expectation-mismatch" &&
      error.claimAuthority === "current",
  );

  const released = await releaseWindowWorkClaimInStore(value.root, claim);
  equal(released.disposition, "released");
  equal(released.replacementObserved, false);
  equal(
    (await inspectWindowWorkClaim(value.root, claim.route.windowId)).status,
    "absent",
  );
  await rejects(
    releaseWindowWorkClaimInStore(value.root, claim),
    (error: unknown) =>
      error instanceof WindowWorkClaimStoreError &&
      error.reason === "not-found" &&
      error.claimAuthority === "unknown",
  );
});

test("不同Claim并发竞争同一window时只有一个取得当前路径", async (t) => {
  const value = await fixture(t);
  const first = createWindowWorkClaimFixture();
  const second = createWindowWorkClaimFixture(OTHER_WINDOW_WORK_CLAIM_ID);
  const settled = await Promise.allSettled([
    createWindowWorkClaimInStore(value.root, first),
    createWindowWorkClaimInStore(value.root, second),
  ]);
  equal(settled.filter((entry) => entry.status === "fulfilled").length, 1);
  equal(
    settled.filter(
      (entry) =>
        entry.status === "rejected" &&
        entry.reason instanceof WindowWorkClaimStoreError &&
        entry.reason.reason === "occupied",
    ).length,
    1,
  );
  const current = await inspectWindowWorkClaim(
    value.root,
    first.route.windowId,
  );
  equal(current.status, "claimed");
  equal(
    current.claim?.claimId === first.claimId ||
      current.claim?.claimId === second.claimId,
    true,
  );
});
