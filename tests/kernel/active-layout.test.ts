import { deepEqual, equal, notEqual, rejects } from "node:assert/strict";
import { chmodSync, mkdtempSync, realpathSync, rmdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import type { PortableResourcePath } from "../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { inspectActiveLayout, materializeActiveLayout } from "../../src/kernel/active-layout.js";
import { WakeflowError } from "../../src/kernel/error.js";
import {
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
  WAKEFLOW_ACTIVE_ROOT_REF,
} from "../../src/kernel/layout.js";
import { useDisposableDurability } from "../support/disposable-durability.js";

useDisposableDurability();

/**
 * 1 级组件测试：`src/kernel/active-layout.ts` 在一次性根上检查与物化 `.wakeflow-active` 的两级容器
 * （能力卡 9 §9.4，gate-log §13.94 D5）。
 */

async function fixture(t: TestContext): Promise<RootedDirectory> {
  const absolutePath = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-projection-")));
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return root;
}

function absolute(root: RootedDirectory, ref: PortableResourcePath): string {
  return path.join(root.absolutePath, ...ref.split("/"));
}

test("两级容器：absent → 独占创建 → current；重复创建被拒而 recovering 幂等；缺 current 为 incomplete；模式不对为 conflict", async (t) => {
  const root = await fixture(t);
  const absent = await inspectActiveLayout(root);
  equal(absent.status, "absent");
  deepEqual(
    absent.entries.map((entry) => [entry.resourcePath, entry.status, entry.nodeDigest]),
    [
      [WAKEFLOW_ACTIVE_ROOT_REF, "absent", null],
      [WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, "absent", null],
    ],
  );

  const created = await materializeActiveLayout(root, { recovering: false });
  equal(created.disposition, "created");
  deepEqual(
    created.entries.map((entry) => [entry.disposition, entry.node.permissionBits]),
    [
      ["created", 0o700],
      ["created", 0o700],
    ],
  );
  const current = await inspectActiveLayout(root);
  equal(current.status, "current");
  equal(
    current.entries.every((entry) => entry.nodeDigest !== null),
    true,
  );
  notEqual(current.observationDigest, absent.observationDigest);

  await rejects(
    materializeActiveLayout(root, { recovering: false }),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "precondition-failed" &&
      error.reason === "active-layout-exists",
  );
  const recovered = await materializeActiveLayout(root, { recovering: true });
  equal(recovered.disposition, "current");
  equal((await inspectActiveLayout(root)).status, "current");

  rmdirSync(absolute(root, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF));
  equal((await inspectActiveLayout(root)).status, "incomplete");
  const repaired = await materializeActiveLayout(root, { recovering: true });
  deepEqual(
    repaired.entries.map((entry) => entry.disposition),
    ["current", "created"],
  );

  chmodSync(absolute(root, WAKEFLOW_ACTIVE_ROOT_REF), 0o755);
  equal((await inspectActiveLayout(root)).status, "conflict");
  chmodSync(absolute(root, WAKEFLOW_ACTIVE_ROOT_REF), 0o700);
  equal((await inspectActiveLayout(root)).status, "current");
});
