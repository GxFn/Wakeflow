import { deepEqual, equal, notEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
  findWakeflowWorkspaceStaticResourceByDeclarationId,
} from "../../src/workspace/wakeflow-workspace-static-resource-matrix.js";
import {
  createWakeflowWorkspaceStaticResourceOperationContext,
  WakeflowWorkspaceStaticResourceOperationContextError,
  type WakeflowWorkspaceStaticResourceOperationContextErrorReason,
} from "../../src/workspace/wakeflow-workspace-static-resource-operation-context.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function expectContextError(
  action: () => unknown,
  reason: WakeflowWorkspaceStaticResourceOperationContextErrorReason,
  path: string,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(
    caught instanceof WakeflowWorkspaceStaticResourceOperationContextError,
    true,
  );
  if (caught instanceof WakeflowWorkspaceStaticResourceOperationContextError) {
    equal(
      caught.code,
      "wakeflow-workspace-static-resource-operation-context",
    );
    equal(caught.reason, reason);
    equal(caught.path, path);
  }
}

test("Static Resource Operation Context binds one real Host Instruction recipe", () => {
  for (const [profile, hostId] of [
    [codexWorkspaceHostResourceProfile, "codex"],
    [claudeCodeWorkspaceHostResourceProfile, "claude-code"],
  ] as const) {
    const matrix = createWakeflowWorkspaceStaticResourceMatrix(profile);
    const declarationId = `host-runtime.${hostId}.instruction`;
    const declaration = findWakeflowWorkspaceStaticResourceByDeclarationId(
      matrix,
      declarationId,
    );
    if (declaration === null) {
      throw new Error("Host instruction declaration is unavailable.");
    }
    const context = createWakeflowWorkspaceStaticResourceOperationContext(
      matrix,
      {
        expectedMatrixDigest: matrix.matrixDigest,
        declarationId,
        recipe: "exact-source-recompose",
      },
    );
    deepEqual(context, {
      kind: "WakeflowWorkspaceStaticResourceOperationContext",
      hostId,
      matrixDigest: matrix.matrixDigest,
      declaration,
      operation: {
        kind: "resource-mutation",
        role: "managed-integration-text",
        recipe: "exact-source-recompose",
      },
    });
    notEqual(context.declaration, declaration);
    assertDeepFrozen(context);
    deepEqual(
      createWakeflowWorkspaceStaticResourceOperationContext(
        matrix,
        {
          expectedMatrixDigest: matrix.matrixDigest,
          declarationId,
          recipe: "exact-source-recompose",
        },
      ),
      context,
    );
    deepEqual(Object.keys(context).sort(), [
      "declaration",
      "hostId",
      "kind",
      "matrixDigest",
      "operation",
    ]);
  }
});

test("Static Resource Operation Context rejects stale, forged, or illegal admission", () => {
  const codex = createWakeflowWorkspaceStaticResourceMatrix(
    codexWorkspaceHostResourceProfile,
  );
  const claude = createWakeflowWorkspaceStaticResourceMatrix(
    claudeCodeWorkspaceHostResourceProfile,
  );
  const instructionRequest = {
    expectedMatrixDigest: codex.matrixDigest,
    declarationId: "host-runtime.codex.instruction",
    recipe: "exact-source-recompose",
  } as const;

  expectContextError(
    () => createWakeflowWorkspaceStaticResourceOperationContext(codex, {
      ...instructionRequest,
      expectedMatrixDigest: claude.matrixDigest,
    }),
    "matrix-changed",
    "$request.expectedMatrixDigest",
  );
  expectContextError(
    () => createWakeflowWorkspaceStaticResourceOperationContext(codex, {
      ...instructionRequest,
      declarationId: "host-runtime.claude-code.instruction",
    }),
    "declaration-not-found",
    "$request.declarationId",
  );
  for (const recipe of [
    "exact-source-replace",
    ["exact-source-recompose", "exact-source-replace"],
  ]) {
    expectContextError(
      () => createWakeflowWorkspaceStaticResourceOperationContext(codex, {
        ...instructionRequest,
        recipe,
      }),
      "operation",
      "$request.recipe",
    );
  }
  expectContextError(
    () => createWakeflowWorkspaceStaticResourceOperationContext(claude, {
      expectedMatrixDigest: claude.matrixDigest,
      declarationId: "host-runtime.claude-code.statusline-asset",
      recipe: "exact-source-recompose",
    }),
    "operation",
    "$request.recipe",
  );

  const forgedMatrix = Object.freeze({
    ...codex,
    declarations: Object.freeze(codex.declarations.filter((entry) => (
      entry.declarationId !== "workspace.config-authority"
    ))),
  });
  expectContextError(
    () => createWakeflowWorkspaceStaticResourceOperationContext(
      forgedMatrix,
      instructionRequest,
    ),
    "matrix",
    "$matrix",
  );

  let trapCalls = 0;
  const matrixProxy = new Proxy(codex, {
    get: () => {
      trapCalls += 1;
      return undefined;
    },
  });
  expectContextError(
    () => createWakeflowWorkspaceStaticResourceOperationContext(
      matrixProxy,
      instructionRequest,
    ),
    "matrix",
    "$matrix",
  );
  const requestProxy = new Proxy({ ...instructionRequest }, {
    ownKeys: () => {
      trapCalls += 1;
      return [];
    },
  });
  expectContextError(
    () => createWakeflowWorkspaceStaticResourceOperationContext(
      codex,
      requestProxy,
    ),
    "input",
    "$request",
  );
  equal(trapCalls, 0);
});

test("Static Resource Operation Context binds the shared .gitignore consumer", () => {
  for (const profile of [
    codexWorkspaceHostResourceProfile,
    claudeCodeWorkspaceHostResourceProfile,
  ]) {
    const matrix = createWakeflowWorkspaceStaticResourceMatrix(profile);
    const context = createWakeflowWorkspaceStaticResourceOperationContext(
      matrix,
      {
        expectedMatrixDigest: matrix.matrixDigest,
        declarationId: "workspace.ignore-integration",
        recipe: "exact-source-recompose",
      },
    );
    equal(context.declaration.family, "workspace");
    equal(context.declaration.ownerId, "workspace-ignore-integration");
    equal(context.declaration.scope, "host-neutral");
    equal(context.declaration.placement.root.kind, "workspace");
    equal(context.declaration.placement.relativePath, ".gitignore");
    deepEqual(context.operation, {
      kind: "resource-mutation",
      role: "managed-integration-text",
      recipe: "exact-source-recompose",
    });
  }
});
