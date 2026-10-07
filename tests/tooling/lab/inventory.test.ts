import { deepEqual, equal, throws } from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertSameInventory,
  parseInventory,
  removeInventoriedTree,
  snapshotLabTree,
} from "../../../tooling/lab/inventory.js";

test("lab inventory refuses added content, same-bytes replacement, links and forged paths before deleting anything", (t) => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-lab-inventory-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "owned");
  mkdirSync(root);
  const file = path.join(root, "known.txt");
  writeFileSync(file, "known");
  const inventory = snapshotLabTree(root);
  deepEqual(parseInventory(inventory), inventory);
  assertSameInventory(parseInventory(JSON.parse(JSON.stringify(inventory))), inventory);
  writeFileSync(path.join(root, "user.txt"), "unowned");
  throws(() => removeInventoriedTree(root, inventory), /lab-resource-drift/u);
  equal(readFileSync(file, "utf8"), "known");
  rmSync(path.join(root, "user.txt"));
  renameSync(file, path.join(base, "saved.txt"));
  writeFileSync(file, "known");
  throws(() => assertSameInventory(inventory, snapshotLabTree(root)), /lab-resource-drift/u);
  rmSync(file);
  symlinkSync(path.join(base, "saved.txt"), file);
  throws(() => snapshotLabTree(root), /lab-unsafe-file/u);
  rmSync(file);
  linkSync(path.join(base, "saved.txt"), file);
  throws(() => snapshotLabTree(root), /lab-unsafe-file/u);
  for (const value of [
    [],
    [...inventory, inventory[0]],
    [{ ...inventory[0], path: "../outside" }],
    [{ ...inventory[0], path: "/outside" }],
  ])
    throws(() => parseInventory(value), /lab-invalid-inventory/u);
});

test("lab inventory rejects a replaced root and an extra empty directory; exact inventory can be disposed", (t) => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-lab-dispose-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "owned");
  mkdirSync(root);
  mkdirSync(path.join(root, "nested"));
  writeFileSync(path.join(root, "nested/file.txt"), "owned");
  const inventory = snapshotLabTree(root);
  renameSync(root, path.join(base, "original"));
  symlinkSync(path.join(base, "original"), root);
  throws(() => removeInventoriedTree(root, inventory), /lab-noncanonical-root/u);
  rmSync(root);
  renameSync(path.join(base, "original"), root);
  mkdirSync(path.join(root, "unowned"));
  throws(() => removeInventoriedTree(root, inventory), /lab-resource-drift/u);
  rmSync(path.join(root, "unowned"), { recursive: true });
  removeInventoriedTree(root, inventory);
  throws(() => snapshotLabTree(root), /ENOENT/u);
});
