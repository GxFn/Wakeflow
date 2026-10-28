import { deepEqual, equal } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  executeStatusRequest,
  executeVerifyRequest,
} from "../../../src/capabilities/observation/service.js";
import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
} from "../../../src/configuration/wakeflow-config.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { createDetachFixture } from "../workspace/detach-workspace.fixture.js";
import { CODEX_OBSERVATION_FACADE } from "./observation-facade.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：终态之后的观察（ADR-0024）。`wakeflow.config.json` 不在而 `wakeflow.detached.json` 在，
 * `wakeflow_status` 以退役文件为只读来源报 `overall: detached`、next 无 owner、没有下一步动作；
 * `wakeflow_verify` 不失败：只报 config-authority 一门且通过（code `detached`），next 同样无 owner。
 */

const CLOCK = { clock: () => parseUtcInstant("2026-10-26T12:00:00.000Z") };

test("status 与 verify 在分离后的工作区报 detached 而不是配置缺失", async (t: TestContext) => {
  const fixture = await createDetachFixture(t);
  const configDigest = computeWakeflowConfigDigest(
    parseWakeflowConfig(
      JSON.parse(readFileSync(path.join(fixture.root, "wakeflow.config.json"), "utf8")),
    ),
  );
  const previewed = await executeCodexWakeflowMaintenance({
    root: fixture.root,
    action: "detach-workspace",
    mode: "preview",
    request: {},
  });
  if (previewed.mode !== "preview" || previewed.planDigest === null) {
    throw new Error(
      `Expected a ready detach plan: ${previewed.mode === "preview" ? previewed.blockerCodes.join(",") : previewed.mode}`,
    );
  }
  await executeCodexWakeflowMaintenance({
    root: fixture.root,
    action: "detach-workspace",
    mode: "apply",
    request: {},
    planDigest: previewed.planDigest,
  });
  equal(existsSync(path.join(fixture.root, "wakeflow.config.json")), false);

  const status = await executeStatusRequest(
    CODEX_OBSERVATION_FACADE,
    { root: fixture.root },
    CLOCK,
  );
  equal(status.overall, "detached");
  equal(status.config.configDigest, configDigest);
  equal(status.config.repositories, 2);
  deepEqual(
    { ...status.next },
    { frontier: "workspace-detached", owner: "none", suggestedTool: null, blockers: [] },
  );
  deepEqual([...status.nextActions], []);
  equal(JSON.stringify(status).includes(fixture.base), false);

  const verify = await executeVerifyRequest(
    CODEX_OBSERVATION_FACADE,
    { root: fixture.root },
    CLOCK,
  );
  equal(verify.ok, true);
  deepEqual({ ...verify.summary }, { pass: 1, fail: 0, unavailable: 0 });
  equal(verify.gates.length, 1);
  equal(verify.gates[0]?.name, "config-authority");
  equal(verify.gates[0]?.status, "pass");
  equal(verify.gates[0]?.code, "detached");
  equal(verify.gates[0]?.evidence[0]?.ref, "wakeflow.detached.json");
  equal(verify.configDigest, configDigest);
  deepEqual(
    { ...verify.next },
    { frontier: "workspace-detached", owner: "none", suggestedTool: null, blockers: [] },
  );
  equal(JSON.stringify(verify).includes("detached"), true);
  equal(JSON.stringify(verify).includes(fixture.base), false);
});
