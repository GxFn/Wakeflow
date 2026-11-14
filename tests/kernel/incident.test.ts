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
  createIncidentId,
  describeIncidentChain,
  describeIncidentFrames,
  isIncidentId,
  recordIncident,
  redactIncidentText,
  summarizeIncidents,
  WAKEFLOW_INCIDENT_RETENTION,
} from "../../src/kernel/incident.js";
import { useDisposableDurability } from "../support/disposable-durability.js";

useDisposableDurability();

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

test("事故记录：0600 的 JSON，带公开错误细节、cause 链的结构事实与脱敏后的消息、最里层错误的栈帧与请求键名（§13.166 G1，open-items G1）", async (t) => {
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
  // 栈帧来自最里层的错误（本测试文件里造的那个）：只有函数名与相对制品的位置，没有绝对路径。
  const frames = record.frames as readonly string[];
  ok(frames.length > 0 && frames.length <= 12);
  for (const frame of frames) match(frame, /^[\w$.<>[\] -]+ [\w.@/:-]+:\d+:\d+$/u);
  ok(frames.some((frame) => frame.includes(".build/tests/kernel/incident.test.js:")));
  delete record.frames;
  // 外层是 Wakeflow 自己的错误，消息是固定文本：有就照原样比，这里只确认它是一段文字。
  equal(typeof record.chain[0].message, "string");
  deepEqual(record, {
    chain: [
      {
        name: "WakeflowError",
        code: "io-failure",
        reason: "demand-root-remove",
        path: "$demandRoot",
        message: record.chain[0].message,
      },
      // 引号里的路径换成占位记号；errno 的名字与说明留下。
      {
        name: "Error",
        code: "EACCES",
        errno: "EACCES",
        message: "EACCES: permission denied, rm '<text>'",
      },
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
  equal(readFileSync(file, "utf8").includes("/Users"), false);
  equal(readFileSync(file, "utf8").includes("someone"), false);
});

test("消息的脱敏（open-items G1）：引号里不像标识符的内容、绝对路径、URL、邮箱与裸 UUID 换成占位记号，类型化的 id 与属性名留下，结果单行有界", () => {
  const cases: readonly (readonly [string, string | null])[] = [
    [
      "Cannot read properties of undefined (reading 'steps')",
      "Cannot read properties of undefined (reading 'steps')",
    ],
    [
      "ENOENT: no such file or directory, open '/Users/someone/My Folder/x.json'",
      "ENOENT: no such file or directory, open '<text>'",
    ],
    [
      'Unexpected token \'}\', "{"secret": "v"}" is not valid JSON',
      "Unexpected token '<text>', \"<text>\" is not valid JSON",
    ],
    ["spawn /Users/someone/My Tools/bin/git ENOENT, retry", "spawn <path>, retry"],
    ["see file:///Users/someone/a.txt and ~/notes/b.md; done", "see <path> and <path>; done"],
    ["mail someone@example.invalid about it", "mail <email> about it"],
    [
      "session 11111111-2222-4333-8444-555555555555 of demand_11111111-2222-4333-8444-555555555555",
      "session <uuid> of demand_11111111-2222-4333-8444-555555555555",
    ],
    ["line one\nline two\ttabbed  ", "line one line two tabbed"],
    ["", null],
    [" \n ", null],
  ];
  for (const [input, expected] of cases) equal(redactIncidentText(input), expected, input);
  const long = redactIncidentText("x".repeat(1000));
  equal(long !== null && Array.from(long).length, 240);
});

test("栈帧（open-items G1）：只留函数名与相对制品的位置——lib、.build 与 node 内部模块，别的只留文件名；读不出的行跳过，至多 12 帧", () => {
  const stack = [
    "TypeError: Cannot read properties of undefined (reading 'x') at '/Users/someone/private'",
    "    at planMaintenance (file:///Users/someone/.claude/plugins/cache/wakeflow/lib/capabilities/workspace/maintain-workspace.js:120:15)",
    "    at async Object.apply (/Users/someone/Documents/repo/.build/src/kernel/publication-transaction.js:88:7)",
    "    at node:internal/process/task_queues:105:5",
    "    at file:///Users/someone/elsewhere/tool.mjs:3:1",
    "    at new Thing (/opt/x/y z/thing.js:1:2)",
    "    not a frame",
  ].join("\n");
  deepEqual(describeIncidentFrames(stack), [
    "planMaintenance lib/capabilities/workspace/maintain-workspace.js:120:15",
    "Object.apply .build/src/kernel/publication-transaction.js:88:7",
    "<anonymous> node:internal/process/task_queues:105:5",
    "<anonymous> tool.mjs:3:1",
    "new Thing thing.js:1:2",
  ]);
  const deep = Array.from(
    { length: 40 },
    (_, index) => `    at f${index} (/a/lib/m.js:${index}:1)`,
  );
  equal(describeIncidentFrames(deep.join("\n")).length, 12);
  deepEqual(describeIncidentFrames("no frames here"), []);
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
  deepEqual(await summarizeIncidents(root, { source: "hook-observer" }), {
    count: 0,
    latestRecordedAt: null,
  });
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
  const hookObserver = await summarizeIncidents(root, { source: "hook-observer" });
  const codex = await summarizeIncidents(root, { source: "hook-observer", hostId: "codex" });
  const tools = await summarizeIncidents(root, { source: "mcp-tool" });
  equal(hookObserver.count + tools.count, WAKEFLOW_INCIDENT_RETENTION);
  ok(codex.count > 0 && codex.count <= hookObserver.count);
  // 最近一条的时间（open-items G8）：最后写下的两条是毫秒 50（hook-observer）与 51（mcp-tool）。
  equal(hookObserver.latestRecordedAt, "2026-10-10T00:00:00.050Z");
  equal(tools.latestRecordedAt, "2026-10-10T00:00:00.051Z");
  // 时间下限之前的不计：旧事故按时间淡出，不再永远挂在门上。
  deepEqual(
    await summarizeIncidents(root, { source: "hook-observer", since: "2026-10-10T00:00:00.049Z" }),
    { count: 1, latestRecordedAt: "2026-10-10T00:00:00.050Z" },
  );
  deepEqual(
    await summarizeIncidents(root, { source: "hook-observer", since: "2026-10-11T00:00:00.000Z" }),
    { count: 0, latestRecordedAt: null },
  );
  deepEqual(describeIncidentChain(null), []);
  deepEqual(
    describeIncidentChain(
      Object.assign(new Error("m"), { code: "wakeflow-json-value", reason: "shape" }),
    ),
    [{ name: "Error", code: "wakeflow-json-value", reason: "shape", message: "m" }],
  );
  // 错误自己说出的位置进链（结构记号）；不是这种形状的 path（例如文件路径）不进。
  deepEqual(
    describeIncidentChain(
      Object.assign(new Error(""), { reason: "stage-changed", path: "$stage/after-sync" }),
    ),
    [{ name: "Error", reason: "stage-changed", path: "$stage/after-sync" }],
  );
  deepEqual(describeIncidentChain(Object.assign(new Error(""), { path: "/Users/someone/file" })), [
    { name: "Error" },
  ]);
});
