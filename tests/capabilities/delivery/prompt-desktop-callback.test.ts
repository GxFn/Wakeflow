import { equal, ok, throws } from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  deliveryPromptRequirementPackage,
  type RenderDeliveryPromptInput,
  renderDeliveryPortablePrompt,
} from "../../../src/capabilities/delivery/prompt.js";
import {
  createWindowLocatorRecord,
  readWindowDesktopSessionId,
  type WindowLocatorTarget,
  writeWindowLocator,
} from "../../../src/capabilities/endpoint/locator-store.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createTaskPackage } from "../../../src/governance/tasking/task-package.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import {
  TASKING_CREATED_AT,
  taskPackageDraft,
} from "../../governance/tasking/task-package.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 1 级（组件）：投递回传段里 Controller 的桌面会话（open-items X15）。Controller 窗口的定位器记录在一次性根上写入，
 * `readWindowDesktopSessionId` 只在记录是桌面 provider 且绑定代际相同时给出 `local_<uuid>`；prompt 渲染器只在拿到
 * 这个值时于回传段加一行 `- controller desktop session: …`，tmux 记录、缺席与旧绑定都不出这一行，所以 tmux
 * 投递的 prompt 字节不变；这一行在渲染文本里，prompt 摘要随之不同；形状不对的值不进 prompt。
 */

const CONTROLLER_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";
const CONTROLLER_BINDING_ID = "window_binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DESKTOP_SESSION_ID = "local_0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

const TASK_PACKAGE = createTaskPackage(
  { ...taskPackageDraft(), sectionAnchors: [] },
  { clock: () => TASKING_CREATED_AT },
);

function renderInput(
  controllerDesktopSessionId?: string | null,
): Readonly<RenderDeliveryPromptInput> {
  return {
    language: "en",
    displayTitle: "ProductA",
    taskPackage: TASK_PACKAGE,
    authored: { goal: "goal", focus: ["focus"], boundary: "boundary" },
    identity: {
      demandId: TASK_PACKAGE.demandId,
      podId: "main (pod-1)",
      windowId: "window-1",
      repositoryId: "repository-1",
      bindingId: "binding-1",
    },
    readingOrder: {
      executionRootFromWorkspace: "Product",
      workspaceRootFromWindow: "..",
      attachedWorktrees: [],
      taskPackageRef: parsePortableResourcePath(
        ".wakeflow-active/current/demand_22222222-2222-4222-8222-222222222222/task-packages/task-package_33333333-3333-4333-8333-333333333333.json",
      ),
      requirementSections: [],
      requirementPackage: deliveryPromptRequirementPackage("../wakeflow-ledger", []),
      workspaceInstructionFile: "CLAUDE.md",
      repositoryInstructionFile: "CLAUDE.md",
      stateRootRef: parsePortableResourcePath(
        ".wakeflow-active/current/demand_22222222-2222-4222-8222-222222222222",
      ),
    },
    returnPointer: {
      deliveryId: "delivery-1",
      claimDigest: `sha256:${"1".repeat(64)}`,
      generation: 1,
    },
    rework: null,
    productDefectRemediation: null,
    testContract: null,
    ...(controllerDesktopSessionId === undefined ? {} : { controllerDesktopSessionId }),
  };
}

/** 回传段：从段头到下一个空行。 */
function returnSection(prompt: string): readonly string[] {
  const lines = prompt.split("\n");
  const start = lines.indexOf("Return:");
  ok(start >= 0, "prompt lacks the return section");
  const end = lines.indexOf("", start);
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

async function rootedFixture(t: TestContext): Promise<RootedDirectory> {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-callback-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = await RootedDirectory.open(directory);
  t.after(() => root.close());
  return root;
}

async function writeControllerLocator(
  root: RootedDirectory,
  bindingId: string,
  target: WindowLocatorTarget,
): Promise<void> {
  await writeWindowLocator(
    root,
    createWindowLocatorRecord({
      programId: "program-1",
      hostId: "claude-code",
      windowId: CONTROLLER_WINDOW_ID,
      bindingId,
      registeredAt: parseUtcInstant("2026-11-01T10:00:00.000Z"),
      ...target,
    }),
    undefined,
  );
}

const read = (root: RootedDirectory) =>
  readWindowDesktopSessionId(
    root,
    "claude-code",
    CONTROLLER_WINDOW_ID,
    CONTROLLER_BINDING_ID,
    undefined,
  );

test("readWindowDesktopSessionId gives the Controller's desktop session only for a desktop locator of the same binding generation", async (t) => {
  const root = await rootedFixture(t);
  equal(await read(root), null, "no locator: nothing to render");
  await writeControllerLocator(root, CONTROLLER_BINDING_ID, {
    provider: "tmux",
    tmux: { socketName: null, sessionName: "wakeflow", windowId: "@1", paneId: "%1" },
  });
  equal(await read(root), null, "a tmux locator has no desktop session");
  await writeControllerLocator(root, "window_binding_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
    provider: "desktop",
    desktop: { sessionId: DESKTOP_SESSION_ID },
  });
  equal(await read(root), null, "an older binding generation is not the Controller now");
  await writeControllerLocator(root, CONTROLLER_BINDING_ID, {
    provider: "desktop",
    desktop: { sessionId: DESKTOP_SESSION_ID },
  });
  equal(await read(root), DESKTOP_SESSION_ID);
});

test("the return section names the Controller's desktop session only when one is given; tmux prompts keep their bytes", () => {
  const tmux = renderDeliveryPortablePrompt(renderInput());
  equal(renderDeliveryPortablePrompt(renderInput(null)), tmux);
  equal(tmux.includes("controller desktop session"), false);
  const desktop = renderDeliveryPortablePrompt(renderInput(DESKTOP_SESSION_ID));
  const section = returnSection(desktop);
  equal(section.at(-2), `- controller desktop session: ${DESKTOP_SESSION_ID}`);
  equal(section.at(-1), "Never send this prompt onward to another window.");
  // 这一行是渲染文本的一部分：去掉它即是 tmux 的字节，所以 prompt 摘要（permit）覆盖它。
  equal(desktop.replace(`\n- controller desktop session: ${DESKTOP_SESSION_ID}`, ""), tmux);
  throws(
    () => renderDeliveryPortablePrompt(renderInput("local_not-a-session")),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "unexpected" &&
      error.reason === "controller-desktop-session",
  );
});
