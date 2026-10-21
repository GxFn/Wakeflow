import { deepEqual, equal, notEqual } from "node:assert/strict";
import { test } from "node:test";

import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { compileWakeflowHostCapabilityLayoutAuthority } from "../../../src/workspace/host-runtime/wakeflow-host-capability-layout-authority.js";

test("Host capability authority selects only applicable empty directory surfaces", () => {
  const codex = compileWakeflowHostCapabilityLayoutAuthority(codexWorkspaceHostResourceProfile);
  deepEqual(
    codex.declarations.map((entry) => entry.declarationId),
    ["host-runtime.codex.pod-receipts-root"],
  );
  equal(
    codex.declarations.every(
      (entry) =>
        entry.nodePolicy.kind === "directory" &&
        entry.nodePolicy.mode === "0700" &&
        entry.processing.kind === "directory-container",
    ),
    true,
  );

  const claude = compileWakeflowHostCapabilityLayoutAuthority(
    claudeCodeWorkspaceHostResourceProfile,
  );
  deepEqual(
    claude.declarations.map((entry) => entry.declarationId),
    [
      "host-runtime.claude-code.pod-receipts-root",
      "host-runtime.claude-code.operations-root",
      "host-runtime.claude-code.statusline-assets-root",
    ],
  );
  equal(
    claude.declarations.some(
      (entry) =>
        entry.declarationId.includes("settings") ||
        entry.declarationId.endsWith("statusline-asset"),
    ),
    false,
  );
  notEqual(claude.authorityDigest, codex.authorityDigest);
});
