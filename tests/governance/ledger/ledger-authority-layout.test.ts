import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  LEDGER_AUTHORITY_LAYOUT_DIGEST,
  inspectLedgerAuthorityLayout,
} from "../../../src/governance/ledger/ledger-authority-layout.js";
import {
  LedgerAuthorityStore,
} from "../../../src/governance/ledger/ledger-authority-store.js";

test("Ledger layout inspection observes only the three fixed containers", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-ledger-layout-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const absent = await inspectLedgerAuthorityLayout(root);
    equal(absent.status, "incomplete");
    equal(absent.authorityDigest, LEDGER_AUTHORITY_LAYOUT_DIGEST);
    deepEqual(absent.entries.map((entry) => entry.status), [
      "absent",
      "absent",
      "absent",
    ]);

    const store = new LedgerAuthorityStore(root);
    await store.initialize({ freshLedger: true });
    const current = await store.inspectLayout();
    equal(current.status, "current");
    deepEqual(current.entries.map((entry) => entry.observedMode), [
      0o755,
      0o755,
      0o700,
    ]);

    chmodSync(path.join(rootPath, "transactions"), 0o755);
    const conflict = await store.inspectLayout();
    equal(conflict.status, "conflict");
    equal(conflict.entries[2]?.status, "conflict");
    equal(conflict.observationDigest === current.observationDigest, false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
