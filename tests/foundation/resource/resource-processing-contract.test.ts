import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  admitWakeflowResourceOperation,
  parseWakeflowResourceProcessingContract,
  WAKEFLOW_DIRECTORY_CONTAINER_RECIPES,
  WAKEFLOW_RESOURCE_ROLES,
  WakeflowResourceProcessingContractError,
  type WakeflowMutableSnapshotProcessingContract,
  type WakeflowResourceProcessingContractErrorReason,
} from "../../../src/foundation/resource/resource-processing-contract.js";

function expectResourceProcessingError(
  action: () => unknown,
  reason: WakeflowResourceProcessingContractErrorReason,
  path: string,
): WakeflowResourceProcessingContractError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof WakeflowResourceProcessingContractError)) {
    throw new Error("Expected WakeflowResourceProcessingContractError.");
  }
  equal(caught.code, "wakeflow-resource-processing-contract");
  equal(caught.reason, reason);
  equal(caught.path, path);
  return caught;
}

test("resource processing contract closes all roles and directory containers", () => {
  deepEqual(WAKEFLOW_DIRECTORY_CONTAINER_RECIPES, [
    "materialize-directory",
    "exact-directory-publish",
  ]);
  deepEqual(WAKEFLOW_RESOURCE_ROLES, [
    "external-reference",
    "immutable-fact",
    "mutable-snapshot",
    "derived-projection",
    "managed-integration-text",
    "manifested-tree",
    "transaction-artifact",
  ]);

  const inputs: Record<string, unknown>[] = [
    {
      kind: "resource",
      role: "external-reference",
      allowedMutationRecipes: ["no-write"],
      recoveryStrategy: "report-only",
    },
    {
      kind: "resource",
      role: "immutable-fact",
      allowedMutationRecipes: ["exclusive-create"],
      recoveryStrategy: "exact-idempotent-retry",
    },
    {
      kind: "resource",
      role: "mutable-snapshot",
      allowedMutationRecipes: [
        "exclusive-create",
        "exact-source-replace",
      ],
      recoveryStrategy: "owner-forward-recovery",
    },
    {
      kind: "resource",
      role: "derived-projection",
      allowedMutationRecipes: ["deterministic-rewrite"],
      recoveryStrategy: "rebuild-from-authority",
    },
    {
      kind: "resource",
      role: "managed-integration-text",
      allowedMutationRecipes: ["exact-source-recompose"],
      recoveryStrategy: "recompose-owned-content",
    },
    {
      kind: "resource",
      role: "manifested-tree",
      allowedMutationRecipes: ["tree-publish-or-move"],
      recoveryStrategy: "manifest-closure",
    },
    {
      kind: "resource",
      role: "transaction-artifact",
      allowedMutationRecipes: [
        "exclusive-create",
        "exact-source-replace",
        "tree-publish-or-move",
        "exact-retire",
      ],
      recoveryStrategy: "owner-transaction-recovery",
    },
  ];

  for (const input of inputs) {
    const parsed = parseWakeflowResourceProcessingContract(input);
    deepEqual(parsed, input);
    equal(Object.isFrozen(parsed), true);
    if (parsed.kind === "resource") {
      equal(Object.isFrozen(parsed.allowedMutationRecipes), true);
    }
  }

  const mutableInput = inputs[2];
  if (mutableInput === undefined) {
    throw new Error("Mutable snapshot fixture is unavailable.");
  }
  const parsedMutable = parseWakeflowResourceProcessingContract(mutableInput);
  mutableInput.role = "external-reference";
  const recipes = mutableInput.allowedMutationRecipes;
  if (Array.isArray(recipes)) recipes[0] = "no-write";
  equal(parsedMutable.kind, "resource");
  if (parsedMutable.kind === "resource") {
    equal(parsedMutable.role, "mutable-snapshot");
    deepEqual(parsedMutable.allowedMutationRecipes, [
      "exclusive-create",
      "exact-source-replace",
    ]);
  }

  const container = parseWakeflowResourceProcessingContract({
    kind: "directory-container",
    materializationRecipe: "materialize-directory",
    existingDirectoryPolicy: "observe-without-mode-change",
    collisionPolicy: "reject-non-directory",
    descendantAuthority: "separate-declaration-required",
    recoveryStrategy: "report-only",
  });
  deepEqual(container, {
    kind: "directory-container",
    materializationRecipe: "materialize-directory",
    existingDirectoryPolicy: "observe-without-mode-change",
    collisionPolicy: "reject-non-directory",
    descendantAuthority: "separate-declaration-required",
    recoveryStrategy: "report-only",
  });
  equal(Object.isFrozen(container), true);
});

test("resource processing contract rejects behavioral, open, and contradictory input", () => {
  expectResourceProcessingError(
    () => parseWakeflowResourceProcessingContract({
      kind: "resource",
      role: "immutable-fact",
      allowedMutationRecipes: ["exclusive-create"],
      recoveryStrategy: "exact-idempotent-retry",
      unexpected: true,
    }),
    "shape",
    "$/unexpected",
  );

  expectResourceProcessingError(
    () => parseWakeflowResourceProcessingContract({
      kind: "directory-container",
      materializationRecipe: "materialize-directory",
      existingDirectoryPolicy: "observe-without-mode-change",
      collisionPolicy: "reject-non-directory",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "report-only",
      role: "immutable-fact",
    }),
    "shape",
    "$/role",
  );

  for (const [recipes, path] of [
    [["exclusive-create", "exclusive-create"], "$/allowedMutationRecipes/1"],
    [["exact-source-replace", "exclusive-create"], "$/allowedMutationRecipes/1"],
  ] as const) {
    expectResourceProcessingError(
      () => parseWakeflowResourceProcessingContract({
        kind: "resource",
        role: "mutable-snapshot",
        allowedMutationRecipes: recipes,
        recoveryStrategy: "owner-forward-recovery",
      }),
      "recipe",
      path,
    );
  }

  expectResourceProcessingError(
    () => parseWakeflowResourceProcessingContract({
      kind: "resource",
      role: "mutable-snapshot",
      allowedMutationRecipes: ["no-write"],
      recoveryStrategy: "owner-forward-recovery",
    }),
    "recipe",
    "$/allowedMutationRecipes/0",
  );
  expectResourceProcessingError(
    () => parseWakeflowResourceProcessingContract({
      kind: "resource",
      role: "immutable-fact",
      allowedMutationRecipes: ["exclusive-create"],
      recoveryStrategy: "owner-forward-recovery",
    }),
    "recovery",
    "$/recoveryStrategy",
  );

  let trapCalls = 0;
  const proxy = new Proxy({ kind: "resource" }, {
    get: () => {
      trapCalls += 1;
      return undefined;
    },
    getOwnPropertyDescriptor: () => {
      trapCalls += 1;
      return undefined;
    },
    getPrototypeOf: () => {
      trapCalls += 1;
      return Object.prototype;
    },
    ownKeys: () => {
      trapCalls += 1;
      return ["kind"];
    },
  });
  expectResourceProcessingError(
    () => parseWakeflowResourceProcessingContract(proxy),
    "input",
    "$",
  );
  equal(trapCalls, 0);
});

test("one operation admits exactly one recipe from the resource contract", () => {
  const mutableSnapshot = {
    kind: "resource",
    role: "mutable-snapshot",
    allowedMutationRecipes: [
      "exclusive-create",
      "exact-source-replace",
    ],
    recoveryStrategy: "owner-forward-recovery",
  } as const satisfies WakeflowMutableSnapshotProcessingContract;

  const creation = admitWakeflowResourceOperation(
    mutableSnapshot,
    "exclusive-create",
  );
  const replacement = admitWakeflowResourceOperation(
    mutableSnapshot,
    "exact-source-replace",
  );
  deepEqual(creation, {
    kind: "resource-mutation",
    role: "mutable-snapshot",
    recipe: "exclusive-create",
  });
  deepEqual(replacement, {
    kind: "resource-mutation",
    role: "mutable-snapshot",
    recipe: "exact-source-replace",
  });
  equal(Object.isFrozen(creation), true);
  equal(Object.isFrozen(replacement), true);

  expectResourceProcessingError(
    () => admitWakeflowResourceOperation(mutableSnapshot, "exact-retire"),
    "operation",
    "$/recipe",
  );
  expectResourceProcessingError(
    () => admitWakeflowResourceOperation(
      mutableSnapshot,
      ["exclusive-create", "exact-source-replace"],
    ),
    "operation",
    "$/recipe",
  );

  const container = {
    kind: "directory-container",
    materializationRecipe: "materialize-directory",
    existingDirectoryPolicy: "observe-without-mode-change",
    collisionPolicy: "reject-non-directory",
    descendantAuthority: "separate-declaration-required",
    recoveryStrategy: "report-only",
  };
  deepEqual(
    admitWakeflowResourceOperation(container, "materialize-directory"),
    {
      kind: "directory-materialization",
      recipe: "materialize-directory",
    },
  );
  expectResourceProcessingError(
    () => admitWakeflowResourceOperation(container, "exclusive-create"),
    "operation",
    "$/recipe",
  );
});

test("directory processing separates static materialization from exact publication", () => {
  const publication = parseWakeflowResourceProcessingContract({
    kind: "directory-container",
    materializationRecipe: "exact-directory-publish",
    existingDirectoryPolicy: "owner-validate-existing-target",
    collisionPolicy: "reject-unowned-target",
    descendantAuthority: "separate-declaration-required",
    recoveryStrategy: "owner-forward-recovery",
  });
  deepEqual(publication, {
    kind: "directory-container",
    materializationRecipe: "exact-directory-publish",
    existingDirectoryPolicy: "owner-validate-existing-target",
    collisionPolicy: "reject-unowned-target",
    descendantAuthority: "separate-declaration-required",
    recoveryStrategy: "owner-forward-recovery",
  });
  equal(Object.isFrozen(publication), true);
  deepEqual(
    admitWakeflowResourceOperation(publication, "exact-directory-publish"),
    {
      kind: "directory-publication",
      recipe: "exact-directory-publish",
    },
  );
  expectResourceProcessingError(
    () => admitWakeflowResourceOperation(publication, "materialize-directory"),
    "operation",
    "$/recipe",
  );

  for (const [input, path] of [
    [{
      kind: "directory-container",
      materializationRecipe: "materialize-directory",
      existingDirectoryPolicy: "owner-validate-existing-target",
      collisionPolicy: "reject-non-directory",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "report-only",
    }, "$/existingDirectoryPolicy"],
    [{
      kind: "directory-container",
      materializationRecipe: "exact-directory-publish",
      existingDirectoryPolicy: "owner-validate-existing-target",
      collisionPolicy: "reject-non-directory",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "owner-forward-recovery",
    }, "$/collisionPolicy"],
    [{
      kind: "directory-container",
      materializationRecipe: "exact-directory-publish",
      existingDirectoryPolicy: "owner-validate-existing-target",
      collisionPolicy: "reject-unowned-target",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "report-only",
    }, "$/recoveryStrategy"],
  ] as const) {
    expectResourceProcessingError(
      () => parseWakeflowResourceProcessingContract(input),
      "shape",
      path,
    );
  }
});
