import { deepEqual, equal, match, ok } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { fail } from "../../src/kernel/error.js";
import {
  countIncidents,
  createIncidentId,
  describeIncidentChain,
  isIncidentId,
  recordIncident,
  WAKEFLOW_INCIDENT_RETENTION,
} from "../../src/kernel/incident.js";

async function fixture(
  t: TestContext,
  initialized = true,
): Promise<{ root: RootedDirectory; directory: string }> {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-incident-")));
  if (initialized)
    mkdirSync(path.join(directory, ".wakeflow-local", "runtime"), { recursive: true, mode: 0o700 });
  const root = await RootedDirectory.open(directory, "$root", { durability: "none" });
  t.after(async () => {
    await root.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { root, directory };
}

function incidentFiles(directory: string): string[] {
  return readdirSync(path.join(directory, ".wakeflow-local", "runtime", "incidents"))
    .filter((name) => name.endsWith(".json"))
    .sort();
}

test("事故记录：0600 的 JSON，带公开错误细节、cause 链的结构事实与请求键名，从不带消息（§13.166 G1）", async (t) => {
  const { root, directory } = await fixture(t);
  const incidentId = createIncidentId();
  ok(isIncidentId(incidentId));
  const errno = Object.assign(new Error("EACCES: permission denied, rm '/Users/someone/private'"), {
    code: "EACCES",
  });
  let failure: unknown;
  try {
    fail("io-failure", "demand-root-remove", "$demandRoot", { cause: errno });
  } catch (error: unknown) {
    failure = error;
  }
  equal(
    await recordIncident(
      root,
      {
        incidentId,
        source: "mcp-tool",
        tool: "wakeflow_complete_demand",
        error: failure,
        requestKeys: ["root", "demandId", "mode"],
      },
      { clock: () => new Date("2026-10-10T01:02:03.456Z") },
    ),
    true,
  );
  const files = incidentFiles(directory);
  equal(files.length, 1);
  equal(files[0], `20261010010203456-${incidentId}.json`);
  const file = path.join(directory, ".wakeflow-local", "runtime", "incidents", files[0] ?? "");
  equal(statSync(file).mode & 0o777, 0o600);
  equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
  const record = JSON.parse(readFileSync(file, "utf8"));
  deepEqual(record, {
    chain: [
      { name: "WakeflowError", code: "io-failure", reason: "demand-root-remove" },
      { name: "Error", code: "EACCES", errno: "EACCES" },
    ],
    error: {
      causeCode: "EACCES",
      code: "io-failure",
      path: "$demandRoot",
      reason: "demand-root-remove",
      retryable: false,
    },
    event: null,
    hostId: null,
    incidentId,
    kind: "WakeflowIncident",
    recordedAt: "2026-10-10T01:02:03.456Z",
    requestKeys: ["demandId", "mode", "root"],
    resource: null,
    schemaVersion: 1,
    source: "mcp-tool",
    tool: "wakeflow_complete_demand",
  });
  equal(readFileSync(file, "utf8").includes("permission denied"), false);
  equal(readFileSync(file, "utf8").includes("/Users"), false);
});

test("未初始化的根不写；计数按来源与宿主过滤、坏文件跳过、目录缺席为 0；超过保留数时退役最旧的", async (t) => {
  const bare = await fixture(t, false);
  equal(
    await recordIncident(bare.root, {
      incidentId: createIncidentId(),
      source: "mcp-tool",
      error: new Error("x"),
    }),
    false,
  );
  const { root, directory } = await fixture(t);
  equal(await countIncidents(root, { source: "hook-observer" }), 0);
  let tick = 0;
  const clock = () => new Date(Date.UTC(2026, 9, 10, 0, 0, 0, tick++));
  for (let index = 0; index < WAKEFLOW_INCIDENT_RETENTION + 2; index += 1) {
    equal(
      await recordIncident(
        root,
        {
          incidentId: createIncidentId(),
          source: index % 2 === 0 ? "hook-observer" : "mcp-tool",
          hostId: index % 4 === 0 ? "codex" : "claude-code",
          event: "session-start",
          error: new Error("write failed"),
        },
        { clock },
      ),
      true,
    );
  }
  const files = incidentFiles(directory);
  equal(files.length, WAKEFLOW_INCIDENT_RETENTION);
  // 最旧的两条（毫秒 0 与 1）被退役，其余按时间前缀留着。
  match(files[0] ?? "", /^20261010000000002-/u);
  writeFileSync(
    path.join(directory, ".wakeflow-local", "runtime", "incidents", "broken.json"),
    "{not json",
  );
  const hookObserver = await countIncidents(root, { source: "hook-observer" });
  const codex = await countIncidents(root, { source: "hook-observer", hostId: "codex" });
  const tools = await countIncidents(root, { source: "mcp-tool" });
  equal(hookObserver + tools, WAKEFLOW_INCIDENT_RETENTION);
  ok(codex > 0 && codex <= hookObserver);
  deepEqual(describeIncidentChain(null), []);
  deepEqual(
    describeIncidentChain(
      Object.assign(new Error("m"), { code: "wakeflow-json-value", reason: "shape" }),
    ),
    [{ name: "Error", code: "wakeflow-json-value", reason: "shape" }],
  );
});
