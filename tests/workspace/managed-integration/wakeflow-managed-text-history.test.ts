import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { createWakeflowExternalInstructionBodyAuthority } from "../../../src/workspace/managed-integration/wakeflow-external-instruction-body-authority.js";
import { createWakeflowGitignoreBodyAuthority } from "../../../src/workspace/managed-integration/wakeflow-gitignore-body-authority.js";
import {
  historicalWakeflowManagedTextBodies,
  historicalWakeflowManagedTextTargets,
  WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_HISTORY,
  WAKEFLOW_GITIGNORE_BODY_HISTORY,
  WAKEFLOW_MANAGED_TEXT_HISTORY_MAXIMUM,
  WAKEFLOW_PROGRAM_INSTRUCTION_BODY_HISTORY,
  WAKEFLOW_SUPPORT_GITIGNORE_BODY_HISTORY,
  WAKEFLOW_SUPPORT_MEMORY_BODY_HISTORY,
  type WakeflowManagedTextHistoricalRender,
} from "../../../src/workspace/managed-integration/wakeflow-managed-text-history.js";
import { createWakeflowProgramInstructionBodyAuthority } from "../../../src/workspace/managed-integration/wakeflow-program-instruction-body-authority.js";
import { createWakeflowSupportGitignoreBodyAuthority } from "../../../src/workspace/managed-integration/wakeflow-support-gitignore-body-authority.js";
import { createWakeflowSupportMemoryAuthority } from "../../../src/workspace/support/wakeflow-support-memory-authority.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import {
  createManagedBlockWakeflowConfig,
  EXTERNAL_DESIGN_SURFACE_TARGET,
  MANAGED_BLOCK_REPOSITORY_TARGET,
} from "./wakeflow-external-instruction.fixture.js";

/**
 * 托管正文的历史准入（open-items C5，§13.167）。
 *
 * 黄金摘要钉住五种托管正文的当前渲染在固定夹具下的 sha256：改任何一个渲染器这里就红。修法只有一种——
 * 把被替换的渲染登记进 `wakeflow-managed-text-history.ts` 对应组件的表（退役版本加一个用相同输入重算
 * 旧正文的函数），再把这里的摘要换成新渲染的。不登记旧渲染就改摘要，等于让每个已有工作区的 reconcile
 * 以 unknown-managed-body 阻塞。
 */

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);
const DESIGN_SURFACE_ID = "surface_33333333-3333-4333-8333-333333333333";
const TEST_SURFACE_ID = "surface_44444444-4444-4444-8444-444444444444";
const LANGUAGES = ["en", "zh-Hans"] as const;

const PINNED_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  "program-instruction/en/codex":
    "sha256:bf09492bee0e45ab07d14f41f363ca7e6f62ff8ac981b8c92acc68b15d77be3c",
  "program-instruction/en/claude-code":
    "sha256:59edc7220893c68dcf19f82e0768850402fa43482a4994a6d85549b3372ef406",
  "program-instruction/zh-Hans/codex":
    "sha256:ea0b53c39aed4323c673bc3426bb66f5938bb2428716e41d4a05d8481428de14",
  "program-instruction/zh-Hans/claude-code":
    "sha256:4e5f1cd263d0632c1f0a6718541856de6f1230972393b44c362c67ac38d592c5",
  "external-instruction/repository/en/codex":
    "sha256:62b93a50b444e8b40c7bab24d6b4ea3eae7fb90d858f60a8157f3fcbb76129e7",
  "external-instruction/repository/en/claude-code":
    "sha256:01e617f4aa79abf4508a1e08b68f09f1fec69050ec6acbb702c3ea1c4264bb01",
  "external-instruction/repository/zh-Hans/codex":
    "sha256:91a414d6f4393497f01ab2dfe5f5826377c2ee872e9af3d0c968d300df2c7a54",
  "external-instruction/repository/zh-Hans/claude-code":
    "sha256:01e46801be21a76f5bb700edebff00e190111c69b22002d704ef8e32225f2dc1",
  "external-instruction/support-surface/en/codex":
    "sha256:c7c5e81455757c034d568b667a305a07743fc50f19cadab843f8f56c8e5f7136",
  "external-instruction/support-surface/en/claude-code":
    "sha256:293c57bd5c1538b6889e4a722e2e624b8c010c34aff3e1413a9d060b3668293e",
  "external-instruction/support-surface/zh-Hans/codex":
    "sha256:46f5440e25b022501ec79a1fadb413c3d4d1d39e5aebf312bc51ed34dd94cc99",
  "external-instruction/support-surface/zh-Hans/claude-code":
    "sha256:e17af637feef227a4b28240631b409379816131943007df4485b1ff31dbfd289",
  "support-memory/design/en/codex":
    "sha256:65a413dad3a24c3817babadaae517ba7a53707b3a7013be9e2fffc9266fa82b0",
  "support-memory/design/en/claude-code":
    "sha256:dad3e3e08f141d34bb3884e6076b221c8212bf8b4980f2326a113ce621f7e8b7",
  "support-memory/design/zh-Hans/codex":
    "sha256:15f7cf35848c31c4d844256e2f841df8df925152e0494fc38da5e7820a4f7b9a",
  "support-memory/design/zh-Hans/claude-code":
    "sha256:f8b43937b21ad18c14e3d46a2b8e6ad203f2547dba1a3775585dc117c8b1148a",
  "support-memory/test/en/codex":
    "sha256:43d187eaf83d0b55ec5757b2c4af439debb7d5dcb96715770a3dca12a9ff2fe1",
  "support-memory/test/en/claude-code":
    "sha256:2c566fc91fc533fb7d9b0fcb3f33bb43ea606d88284b1a7b951a12cc6cf0b99d",
  "support-memory/test/zh-Hans/codex":
    "sha256:d153191f9c93ff2cc3a3d2e8c197f9784e83d7ff760d47754df210286a447428",
  "support-memory/test/zh-Hans/claude-code":
    "sha256:1257d13a11275e4af5226fc02b2221af54cd9301c365f7e33ad910295f87761b",
  gitignore: "sha256:cf9f0c3223e9f7bec4fe13192859c7188d564ba3cbfde4dcdfa31527283773a0",
  "support-gitignore": "sha256:760b753ea63415fb9e286c097644f32682c0543f7178c03c27381577baf255e9",
});

function digest(body: string): string {
  return computeSha256Digest(encodeUtf8(body, "$body"), "$body");
}

function minimalConfig(language: (typeof LANGUAGES)[number]): Record<string, unknown> {
  const config = createMinimalWakeflowConfig();
  (config.presentation as Record<string, unknown>).language = language;
  return config;
}

/** 当前渲染：每种托管正文按宿主画像（与语言）各算一份。 */
function currentRenders(): Readonly<Record<string, string>> {
  const renders: Record<string, string> = {};
  for (const language of LANGUAGES) {
    const minimal = minimalConfig(language);
    const managed = createManagedBlockWakeflowConfig(language);
    for (const profile of PROFILES) {
      const key = `${language}/${profile.hostId}`;
      renders[`program-instruction/${key}`] = createWakeflowProgramInstructionBodyAuthority(
        minimal,
        profile,
      ).body;
      renders[`external-instruction/repository/${key}`] =
        createWakeflowExternalInstructionBodyAuthority(
          managed,
          profile,
          MANAGED_BLOCK_REPOSITORY_TARGET,
        ).body;
      renders[`external-instruction/support-surface/${key}`] =
        createWakeflowExternalInstructionBodyAuthority(
          managed,
          profile,
          EXTERNAL_DESIGN_SURFACE_TARGET,
        ).body;
      renders[`support-memory/design/${key}`] = createWakeflowSupportMemoryAuthority(
        minimal,
        profile,
        DESIGN_SURFACE_ID,
      ).body;
      renders[`support-memory/test/${key}`] = createWakeflowSupportMemoryAuthority(
        minimal,
        profile,
        TEST_SURFACE_ID,
      ).body;
    }
  }
  renders.gitignore = createWakeflowGitignoreBodyAuthority(PROFILES).body;
  const supportGitignore = createWakeflowSupportGitignoreBodyAuthority(PROFILES);
  if (supportGitignore === null)
    throw new Error("the support gitignore authority is expected for both hosts");
  renders["support-gitignore"] = supportGitignore.body;
  return Object.freeze(renders);
}

test("黄金摘要：五种托管正文的当前渲染与钉住的摘要逐项相同；改渲染器必须先登记旧渲染再换摘要（C5，§13.167）", () => {
  const actual = Object.fromEntries(
    Object.entries(currentRenders()).map(([key, body]) => [key, digest(body)]),
  );
  deepEqual(
    actual,
    PINNED_DIGESTS,
    `a managed-text render changed: register the previous render in wakeflow-managed-text-history.ts (retiredIn + render), then update PINNED_DIGESTS to:\n${JSON.stringify(actual, null, 2)}`,
  );
});

test("历史表今天为空、冻结且每张不超过 7 项，退役版本是 semver；生产者用夹具输入算历史正文得到空集", () => {
  const tables: readonly (readonly WakeflowManagedTextHistoricalRender<readonly unknown[]>[])[] = [
    WAKEFLOW_PROGRAM_INSTRUCTION_BODY_HISTORY,
    WAKEFLOW_EXTERNAL_INSTRUCTION_BODY_HISTORY,
    WAKEFLOW_GITIGNORE_BODY_HISTORY,
    WAKEFLOW_SUPPORT_GITIGNORE_BODY_HISTORY,
    WAKEFLOW_SUPPORT_MEMORY_BODY_HISTORY,
  ];
  for (const table of tables) {
    equal(Object.isFrozen(table), true);
    equal(table.length <= WAKEFLOW_MANAGED_TEXT_HISTORY_MAXIMUM, true);
    for (const entry of table) {
      equal(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(entry.retiredIn),
        true,
      );
    }
  }
  const minimal = minimalConfig("en");
  const program = createWakeflowProgramInstructionBodyAuthority(
    minimal,
    codexWorkspaceHostResourceProfile,
  );
  deepEqual(
    historicalWakeflowManagedTextTargets(
      WAKEFLOW_PROGRAM_INSTRUCTION_BODY_HISTORY,
      program.envelopeTarget,
      minimal,
      codexWorkspaceHostResourceProfile,
    ),
    [],
  );
  const memory = createWakeflowSupportMemoryAuthority(
    minimal,
    codexWorkspaceHostResourceProfile,
    DESIGN_SURFACE_ID,
  );
  deepEqual(
    historicalWakeflowManagedTextBodies(
      WAKEFLOW_SUPPORT_MEMORY_BODY_HISTORY,
      memory.body,
      minimal,
      codexWorkspaceHostResourceProfile,
      DESIGN_SURFACE_ID,
    ),
    [],
  );
});

test("历史正文重算：算不出的跳过、与当前渲染相同的与重复的去掉、保持表序，并套上当前目标的 component 与 owner", () => {
  const history: readonly WakeflowManagedTextHistoricalRender<readonly [prefix: string]>[] = [
    { retiredIn: "1.0.0", render: (prefix) => `${prefix} first\n` },
    { retiredIn: "1.0.1", render: () => null },
    {
      retiredIn: "1.0.2",
      render: () => {
        throw new TypeError("input shape changed");
      },
    },
    { retiredIn: "1.0.3", render: (prefix) => `${prefix} current\n` },
    { retiredIn: "1.0.4", render: (prefix) => `${prefix} first\n` },
    { retiredIn: "1.0.5", render: (prefix) => `${prefix} second\n` },
  ];
  deepEqual(historicalWakeflowManagedTextBodies(history, "# current\n", "#"), [
    "# first\n",
    "# second\n",
  ]);
  const targets = historicalWakeflowManagedTextTargets(
    history,
    { component: "wakeflow-test", owner: "wakeflow", body: "# current\n" },
    "#",
  );
  deepEqual(targets, [
    { component: "wakeflow-test", owner: "wakeflow", body: "# first\n" },
    { component: "wakeflow-test", owner: "wakeflow", body: "# second\n" },
  ]);
  equal(Object.isFrozen(targets), true);
  equal(
    targets.every((target) => Object.isFrozen(target)),
    true,
  );
});
