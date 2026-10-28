import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";

import type { PodHostFacade } from "../../../src/capabilities/pod/service.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { runGit } from "../../support/git-fixture.js";
import { createPreparedWorkspaceStore } from "../../support/prepared-workspace.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";

/**
 * 退出路径（ADR-0024）的预备工作区：Workspace 旁边有两个产品仓库——ProductA 是 owner-managed，
 * ProductB 是 managed-block（fresh 在它的 `AGENTS.md` 里写了 Codex 的外部指令块）；两个仓库在 primary
 * pod 各有一个产品窗口。链在基线里跑一次，每个测试复制一份隔离副本。
 */

export const DETACH_POD_FACADE: PodHostFacade = {
  hostId: "codex",
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
  hosts: CODEX_OBSERVATION_FACADE.hosts,
};

export interface DetachConfigDocument {
  readonly topology: {
    readonly repositories: readonly { readonly repositoryId: string; readonly path: string }[];
    readonly windows: readonly {
      readonly windowId: string;
      readonly podId: string;
      readonly root: { readonly kind: string; readonly repositoryId?: string };
    }[];
  };
  readonly pods: readonly { readonly podId: string; readonly placement: string }[];
}

export interface DetachFixture {
  readonly base: string;
  readonly root: string;
  readonly productA: string;
  readonly productB: string;
  /** owner-managed 的仓库。 */
  readonly repositoryA: string;
  /** managed-block 的仓库：`AGENTS.md` 里有托管块。 */
  readonly repositoryB: string;
  readonly config: DetachConfigDocument;
}

const detachWorkspaceStore = createPreparedWorkspaceStore<undefined, null>({
  prefix: "wakeflow-detach-slice-",
  keyOf: () => "two-repositories",
  build: async (base) => {
    const root = path.join(base, "Workspace");
    mkdirSync(root);
    runGit(root, "init", "--quiet");
    for (const name of ["ProductA", "ProductB"]) {
      const product = path.join(base, name);
      mkdirSync(product);
      runGit(product, "init", "--quiet");
      runGit(product, "commit", "--quiet", "--allow-empty", "-m", "init");
    }
    const selection = createMinimalWakeflowFreshConfigSelection();
    (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
    (selection.topology.repositories as Record<string, unknown>[]).push({
      selectionKey: "repository-2",
      path: "../ProductB",
      displayName: "Product B",
      instructionManagement: "managed-block",
    });
    (selection.topology.windows as Record<string, unknown>[]).push({
      selectionKey: "window-5",
      role: "product",
      displayName: "Product B",
      root: { kind: "repository", selectionKey: "repository-2" },
    });
    const preview = await executeCodexWakeflowMaintenance({
      root,
      action: "fresh-initialize",
      mode: "preview",
      request: { selection },
    });
    if (preview.mode !== "preview" || preview.planDigest === null) {
      throw new Error("Expected a ready Fresh plan.");
    }
    await executeCodexWakeflowMaintenance({
      root,
      action: "fresh-initialize",
      mode: "apply",
      request: { selection },
      planDigest: preview.planDigest,
    });
    return null;
  },
});

export function readDetachConfig(root: string): DetachConfigDocument {
  return JSON.parse(
    readFileSync(path.join(root, "wakeflow.config.json"), "utf8"),
  ) as DetachConfigDocument;
}

function repositoryIdByPath(config: DetachConfigDocument, relativePath: string): string {
  const repository = config.topology.repositories.find((entry) => entry.path === relativePath);
  if (repository === undefined) throw new Error(`config lacks the repository at ${relativePath}`);
  return repository.repositoryId;
}

/** 复制一份两仓库工作区；测试结束整棵删除。 */
export async function createDetachFixture(t: TestContext): Promise<DetachFixture> {
  const prepared = await detachWorkspaceStore.materialize(undefined);
  t.after(() => rmSync(prepared.fixtureRoot, { recursive: true, force: true }));
  const base = prepared.fixtureRoot;
  const root = path.join(base, "Workspace");
  const config = readDetachConfig(root);
  return Object.freeze({
    base,
    root,
    productA: path.join(base, "ProductA"),
    productB: path.join(base, "ProductB"),
    repositoryA: repositoryIdByPath(config, "../ProductA"),
    repositoryB: repositoryIdByPath(config, "../ProductB"),
    config,
  });
}
