import { equal, ok } from "node:assert/strict";
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
  readBoundWindowLocator,
  writeWindowLocator,
} from "../../../src/capabilities/endpoint/locator-store.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createTaskPackage } from "../../../src/governance/tasking/task-package.js";
import {
  claudeCodeDesktopSessionIdOf,
  claudeCodeDesktopWindowTransportPort,
} from "../../../src/hosts/claude-code/claude-code-window-transport-ports.js";
import type { WakeflowWindowLocatorTarget } from "../../../src/workspace/host-runtime/wakeflow-window-transport-port.js";
import {
  TASKING_CREATED_AT,
  taskPackageDraft,
} from "../../governance/tasking/task-package.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 1 级（组件）：Controller 的桌面会话与投递 prompt（open-items X15）。Controller 窗口的定位器记录在一次性根上写入，
 * 组合根的读法（按当前绑定读定位器，再由宿主取出桌面会话 id）只在记录是桌面 provider 且绑定代际相同时给出
 * `local_<uuid>`——回调许可的 `hostAction.desktopSessionId` 用的就是这个读法。投递 prompt 随 Demand 归档，
 * 所以渲染器不接收、也不渲染任何会话 id（1.4 第 3 段）：回传段在两种传输下是同样的字节。
 */

const CONTROLLER_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";
const CONTROLLER_BINDING_ID = "window_binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DESKTOP_SESSION_ID = "local_0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

const TASK_PACKAGE = createTaskPackage(
  { ...taskPackageDraft(), sectionAnchors: [] },
  { clock: () => TASKING_CREATED_AT },
);

function renderInput(): Readonly<RenderDeliveryPromptInput> {
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
      deliveryId: "target-delivery_00000000-0000-4000-8000-0000000000d1",
      claimDigest: `sha256:${"1".repeat(64)}`,
      generation: 1,
    },
    rework: null,
    productDefectRemediation: null,
    testContract: null,
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
  target: WakeflowWindowLocatorTarget,
): Promise<void> {
  await writeWindowLocator(
    root,
    createWindowLocatorRecord(
      {
        programId: "program-1",
        hostId: "claude-code",
        windowId: CONTROLLER_WINDOW_ID,
        bindingId,
        registeredAt: parseUtcInstant("2026-11-01T10:00:00.000Z"),
        target,
      },
      CODECS,
    ),
    CODECS,
    undefined,
  );
}

/** Claude Code 认得的两种定位载荷（两份端口带的是同一组）。 */
const CODECS = claudeCodeDesktopWindowTransportPort.locatorCodecs;

/** 与 Claude Code 组合根同一个读法：按当前绑定读定位器，再由宿主取出桌面会话 id。 */
const read = async (root: RootedDirectory) =>
  claudeCodeDesktopSessionIdOf(
    await readBoundWindowLocator(
      root,
      "claude-code",
      CONTROLLER_WINDOW_ID,
      CONTROLLER_BINDING_ID,
      CODECS,
      undefined,
    ),
  );

test("the Controller's desktop session is read only from a desktop locator of the same binding generation", async (t) => {
  const root = await rootedFixture(t);
  equal(await read(root), null, "no locator: nothing to render");
  await writeControllerLocator(root, CONTROLLER_BINDING_ID, {
    provider: "tmux",
    payload: { socketName: null, sessionName: "wakeflow", windowId: "@1", paneId: "%1" },
  });
  equal(await read(root), null, "a tmux locator has no desktop session");
  await writeControllerLocator(root, "window_binding_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
    provider: "desktop",
    payload: { sessionId: DESKTOP_SESSION_ID },
  });
  equal(await read(root), null, "an older binding generation is not the Controller now");
  await writeControllerLocator(root, CONTROLLER_BINDING_ID, {
    provider: "desktop",
    payload: { sessionId: DESKTOP_SESSION_ID },
  });
  equal(await read(root), DESKTOP_SESSION_ID);
});

test("the delivery prompt carries no desktop session id: the return section ends with the tool pointer and the no-forward line", () => {
  const prompt = renderDeliveryPortablePrompt(renderInput());
  equal(prompt.includes("controller desktop session"), false);
  equal(/local_[0-9a-f]{8}-/u.test(prompt), false, "no desktop session id in an archived prompt");
  const section = returnSection(prompt);
  equal(section.at(-2), `- claimDigest: sha256:${"1".repeat(64)}`);
  equal(section.at(-1), "Never send this prompt onward to another window.");
  // 渲染器的输入里没有这个成员：多给的值在类型上就过不去，运行时也不会被读到。
  const withStray = { ...renderInput(), controllerDesktopSessionId: DESKTOP_SESSION_ID };
  equal(renderDeliveryPortablePrompt(withStray), prompt);
});
