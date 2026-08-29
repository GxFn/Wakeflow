import { equal } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  initializeFreshTodoCollection,
  FreshTodoCollectionInitializationError,
} from "../../../src/governance/todo/todo-collection-initialization.js";
import {
  TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST,
} from "../../../src/governance/todo/todo-collection-initialization-authority.js";
import {
  materializeWakeflowActiveLayout,
} from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";

async function fixture(t: TestContext) {
  const absolutePath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-todo-init-"));
  const root = await RootedDirectory.open(absolutePath);
  await materializeWakeflowActiveLayout(root, {
    recoveringFreshLayout: false,
  });
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

test("Fresh TODO initialization publishes one exact empty authority", async (t) => {
  const value = await fixture(t);
  const created = await initializeFreshTodoCollection(value.root, {
    recoveringFreshCollection: false,
  });
  equal(created.disposition, "created");
  equal(created.authorityDigest, TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST);
  equal(created.snapshot.collection.itemCount, 0);
  equal(created.snapshot.projection.status, "current");

  let normalError: unknown;
  try {
    await initializeFreshTodoCollection(value.root, {
      recoveringFreshCollection: false,
    });
  } catch (error: unknown) {
    normalError = error;
  }
  equal(normalError instanceof FreshTodoCollectionInitializationError, true);
  if (normalError instanceof FreshTodoCollectionInitializationError) {
    equal(normalError.reason, "strict-absent");
  }
  const recovered = await initializeFreshTodoCollection(value.root, {
    recoveringFreshCollection: true,
  });
  equal(recovered.disposition, "current");
});

test("Fresh TODO recovery completes an empty prefix and rejects injected items", async (t) => {
  const partial = await fixture(t);
  const todoRoot = path.join(
    partial.absolutePath,
    ".wakeflow-active",
    "current",
    "todo",
  );
  mkdirSync(path.join(todoRoot, "items"), {
    mode: 0o700,
    recursive: true,
  });
  const recovered = await initializeFreshTodoCollection(partial.root, {
    recoveringFreshCollection: true,
  });
  equal(recovered.snapshot.collection.itemCount, 0);

  writeFileSync(path.join(todoRoot, "items", "foreign"), "foreign", {
    mode: 0o600,
  });
  let conflict: unknown;
  try {
    await initializeFreshTodoCollection(partial.root, {
      recoveringFreshCollection: true,
    });
  } catch (error: unknown) {
    conflict = error;
  }
  equal(conflict instanceof FreshTodoCollectionInitializationError, true);
  if (conflict instanceof FreshTodoCollectionInitializationError) {
    equal(conflict.reason, "prefix-conflict");
  }
});
