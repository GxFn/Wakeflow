import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  classifyTargetSessionPrompts,
  parseTargetSessionPromptObservation,
  TARGET_SESSION_OUTSIDE_PROMPT_TIMES_MAXIMUM,
  TargetSessionPromptObservationError,
  unobservedTargetSessionPrompts,
} from "../../../src/governance/result/target-session-prompts.js";

/**
 * 0 级（纯函数）：目标会话里越级 prompt 的归类与观察记录的形状（open-items H13，1.4 第 4 段）。
 * 落地到导入之间的 prompt 归成三类——带 Wakeflow 许可的、与 Controller 推过的续跑短句相符的、其余的；
 * 只记条数与时刻。未观察不是零条：两种状态各自自洽，混在一起的记录读不进来。
 */

const FROM = parseUtcInstant("2026-11-17T00:03:00.000Z");
const UNTIL = parseUtcInstant("2026-11-17T00:10:40.000Z");
const NUDGE_DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER_DIGEST = `sha256:${"b".repeat(64)}`;

function at(minute: number, second = 0): ReturnType<typeof parseUtcInstant> {
  return parseUtcInstant(
    `2026-11-17T00:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`,
  );
}

test("归类：带许可的、与续跑短句相符的、其余的各自计数；区间之外的不算；时刻按先后给出", () => {
  const observation = classifyTargetSessionPrompts({
    from: FROM,
    until: UNTIL,
    nudgeDigests: new Set([NUDGE_DIGEST]),
    records: [
      { recordedAt: at(6, 30), promptDigest: OTHER_DIGEST, promptPermitIds: [] },
      { recordedAt: at(5), promptDigest: null, promptPermitIds: null },
      {
        recordedAt: at(7),
        promptDigest: OTHER_DIGEST,
        promptPermitIds: ["target-delivery_11111111-1111-4111-8111-111111111111"],
      },
      { recordedAt: at(8), promptDigest: NUDGE_DIGEST, promptPermitIds: [] },
      // 许可身份优先于短句的摘要：带着许可的就是 Wakeflow 的投递。
      {
        recordedAt: at(9),
        promptDigest: NUDGE_DIGEST,
        promptPermitIds: ["target-delivery_22222222-2222-4222-8222-222222222222"],
      },
      // 落地之前与导入之后的不在区间里。
      { recordedAt: at(2), promptDigest: OTHER_DIGEST, promptPermitIds: [] },
      { recordedAt: at(11), promptDigest: OTHER_DIGEST, promptPermitIds: [] },
    ],
  });
  deepEqual(observation, {
    status: "observed",
    reason: null,
    from: FROM,
    until: UNTIL,
    permitPrompts: 2,
    nudgePrompts: 1,
    outsidePrompts: 2,
    outsideAt: [at(5), at(6, 30)],
  });
  // 它就是落盘的形状：原样读得回来。
  deepEqual(parseTargetSessionPromptObservation(observation), observation);
});

test("任务包之外的 prompt 很多时条数照实给，时刻只列最早的十六个", () => {
  const records = Array.from({ length: 20 }, (_, index) => ({
    recordedAt: at(4, index),
    promptDigest: OTHER_DIGEST,
    promptPermitIds: [],
  }));
  const observation = classifyTargetSessionPrompts({
    from: FROM,
    until: UNTIL,
    nudgeDigests: new Set(),
    records: records.reverse(),
  });
  equal(observation.outsidePrompts, 20);
  equal(observation.outsideAt.length, TARGET_SESSION_OUTSIDE_PROMPT_TIMES_MAXIMUM);
  equal(observation.outsideAt[0], at(4, 0));
  equal(observation.outsideAt.at(-1), at(4, 15));
  deepEqual(parseTargetSessionPromptObservation(observation), observation);
});

test("未观察不是零条：带原因、没有起点、计数全为零；两种状态混在一起的记录读不进来", () => {
  const unobserved = unobservedTargetSessionPrompts("landing-record-absent", UNTIL);
  deepEqual(unobserved, {
    status: "unobserved",
    reason: "landing-record-absent",
    from: null,
    until: UNTIL,
    permitPrompts: 0,
    nudgePrompts: 0,
    outsidePrompts: 0,
    outsideAt: [],
  });
  deepEqual(parseTargetSessionPromptObservation(unobserved), unobserved);
  const observed = classifyTargetSessionPrompts({
    from: FROM,
    until: UNTIL,
    nudgeDigests: new Set(),
    records: [{ recordedAt: at(5), promptDigest: OTHER_DIGEST, promptPermitIds: [] }],
  });
  const refused = (value: unknown) =>
    throws(
      () => parseTargetSessionPromptObservation(value),
      (error: unknown) => error instanceof TargetSessionPromptObservationError,
    );
  // 未观察却带着起点或计数。
  refused({ ...unobserved, from: FROM });
  refused({ ...unobserved, outsidePrompts: 1 });
  refused({ ...unobserved, reason: "because" });
  // 观察到了却带着原因、没有起点，或时刻的个数与条数对不上。
  refused({ ...observed, reason: "landing-record-absent" });
  refused({ ...observed, from: null });
  refused({ ...observed, outsideAt: [] });
  refused({ ...observed, outsidePrompts: 2 });
  // 起点晚于终点、成员多了或少了、计数不是非负整数。
  refused({ ...observed, from: at(11) });
  refused({ ...observed, sessionId: "leak" });
  const { until: _until, ...withoutUntil } = observed;
  refused(withoutUntil);
  refused({ ...observed, permitPrompts: -1 });
  refused({ ...observed, nudgePrompts: 1.5 });
});
