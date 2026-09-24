import { deepEqual, equal } from "node:assert/strict";
import { opendirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

interface JsonObject {
  readonly [key: string]: unknown;
}

function readSchema(relative: string): JsonObject {
  return JSON.parse(readFileSync(path.join(process.cwd(), relative), "utf8")) as JsonObject;
}

function externalReferences(value: unknown, result: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) externalReferences(entry, result);
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "$ref" && typeof entry === "string" && !entry.startsWith("#")) {
        result.push(entry);
      }
      externalReferences(entry, result);
    }
  }
  return result;
}

/** 镜像的约束核心必须与权威一致；本地只允许额外的 description/title 文案。 */
function mirrorCore(value: JsonObject, expected: JsonObject, label: string): JsonObject {
  const extra = Object.keys(value).filter(
    (key) => !Object.hasOwn(expected, key) && key !== "description" && key !== "title",
  );
  deepEqual(extra, [], `${label} carries keywords the Foundation mirror lacks`);
  return Object.fromEntries(Object.keys(expected).map((key) => [key, value[key]]));
}

function definition(schema: JsonObject, name: string): JsonObject {
  const definitions = schema.$defs;
  if (definitions === null || typeof definitions !== "object") {
    throw new Error("Expected local Schema definitions.");
  }
  const value = (definitions as Record<string, unknown>)[name];
  if (value === null || typeof value !== "object") {
    throw new Error(`Expected local Schema definition ${name}.`);
  }
  return value as JsonObject;
}

/** 两份 Schema 共有的本地定义名：请求与结果共享的词法必须逐字节一致。 */
function sharedDefinitions(left: JsonObject, right: JsonObject): readonly string[] {
  const rightDefinitions = right.$defs as JsonObject;
  return Object.keys(left.$defs as JsonObject).filter((name) =>
    Object.hasOwn(rightDefinitions, name),
  );
}

test("MCP wire Schema 自包含且本地词法镜像 Foundation 权威", () => {
  const schemaRoot = path.join(process.cwd(), "src/contracts/schemas/entrypoints");
  const handle = opendirSync(schemaRoot);
  const names: string[] = [];
  try {
    while (true) {
      const entry = handle.readSync();
      if (entry === null) break;
      if (entry.isFile() && entry.name.endsWith(".schema.json")) {
        names.push(entry.name);
      }
    }
  } finally {
    handle.closeSync();
  }
  for (const name of names.sort()) {
    equal(
      externalReferences(readSchema(`src/contracts/schemas/entrypoints/${name}`)).length,
      0,
      `${name} must not advertise unresolved external refs`,
    );
  }

  const sha = readSchema("src/contracts/schemas/foundation/sha256-digest.schema.json");
  const utc = readSchema("src/contracts/schemas/foundation/utc-instant.schema.json");
  const expectedSha = {
    type: sha.type,
    pattern: sha.pattern,
  };
  const expectedUtc = {
    type: utc.type,
    minLength: utc.minLength,
    maxLength: utc.maxLength,
    pattern: utc.pattern,
  };
  // 任何 wire Schema 只要携带或引用 Foundation 词法镜像，就必须与权威一字不差；
  // 不再要求未使用的镜像存在（ADR-0012 D2 单次追加请求已不携带摘要与时刻）。
  const mirrors: ReadonlyArray<readonly [string, JsonObject]> = [
    ["sha256Digest", expectedSha],
    ["utcInstant", expectedUtc],
  ];
  const mirrorCounts = new Map<string, number>();
  for (const name of names) {
    const schema = readSchema(`src/contracts/schemas/entrypoints/${name}`);
    const text = JSON.stringify(schema);
    const definitions = (schema.$defs ?? {}) as JsonObject;
    for (const [mirror, expected] of mirrors) {
      if (text.includes(`#/$defs/${mirror}`)) definition(schema, mirror);
      if (!Object.hasOwn(definitions, mirror)) continue;
      deepEqual(
        mirrorCore(definition(schema, mirror), expected, `${name} ${mirror}`),
        expected,
        `${name} ${mirror} must mirror the Foundation authority`,
      );
      mirrorCounts.set(mirror, (mirrorCounts.get(mirror) ?? 0) + 1);
    }
  }
  for (const [mirror] of mirrors) {
    equal(
      (mirrorCounts.get(mirror) ?? 0) > 0,
      true,
      `at least one wire Schema must still mirror ${mirror}`,
    );
  }

  // 路由读取并入 wakeflow_status{demandId}（§13.94 D10）：两个读工具的请求与 status 结果共用同一 Demand 身份。
  const statusRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-status-request.schema.json",
  );
  const statusResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-status-result.schema.json",
  );
  const verifyRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-verify-request.schema.json",
  );
  deepEqual(
    definition(statusRequest, "demandId"),
    definition(statusResult, "demandId"),
    "status request/result demand identity must not drift",
  );
  deepEqual(
    definition(verifyRequest, "demandId"),
    definition(statusRequest, "demandId"),
    "verify and status requests must share the demand identity",
  );

  const planningRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json",
  );
  const planningResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-task-planning-result.schema.json",
  );
  for (const sharedDefinition of ["demandId", "repositoryId", "windowId", "portableResourcePath"]) {
    deepEqual(
      definition(planningRequest, sharedDefinition),
      definition(planningResult, sharedDefinition),
      `Planning wire definition ${sharedDefinition} must not drift`,
    );
  }
  // ADR-0012 D2：单次追加信封，幂等键与观察到的流修订随请求一起到达。
  deepEqual(planningRequest.required, [
    "root",
    "demandId",
    "idempotencyKey",
    "expectedStreamRevision",
    "taskPackage",
  ]);
  deepEqual((planningRequest.properties as JsonObject).taskPackage, {
    $ref: "#/$defs/requestedTaskPackage",
  });
  deepEqual(definition(planningRequest, "requestedTaskPackage"), {
    oneOf: [
      { $ref: "#/$defs/implementationTaskPackageRequest" },
      { $ref: "#/$defs/testTaskPackageRequest" },
    ],
  });
  const implementationTaskRequest = definition(planningRequest, "implementationTaskPackageRequest");
  const implementationRequestFields = [
    "acceptanceAnchors",
    "assignment",
    "boundaries",
    "commitExpectation",
    "completionExpectations",
    "confirmedContext",
    "lineage",
    "objective",
    "sectionAnchors",
    "selectedAuthorityMemberRefs",
    "workType",
  ];
  deepEqual(
    Object.keys(implementationTaskRequest.properties as JsonObject).sort(),
    implementationRequestFields,
  );
  // 能力卡 5 D3：plan review 是请求级可选回显，只携带用户确认时刻。
  deepEqual(Object.keys(planningRequest.properties as JsonObject), [
    ...(planningRequest.required as string[]),
    "planReview",
  ]);
  const planReviewEcho = (planningRequest.properties as JsonObject).planReview as JsonObject;
  deepEqual(planReviewEcho.required, ["confirmedAt"]);
  deepEqual(Object.keys(planReviewEcho.properties as JsonObject), ["confirmedAt"]);
  deepEqual(
    [...(implementationTaskRequest.required as string[])].sort(),
    implementationRequestFields,
  );
  deepEqual((implementationTaskRequest.properties as Record<string, unknown>).workType, {
    const: "implementation",
  });
  // 公共草稿不得发明领域任务包没有的字段；成员引用在领域里叫 selectedAuthorityRefs。
  const domainTaskPackage = readSchema(
    "src/contracts/schemas/governance/tasking/task-package.schema.json",
  );
  const domainFields = Object.keys(domainTaskPackage.properties as JsonObject);
  equal(domainFields.includes("selectedAuthorityRefs"), true);
  for (const field of implementationRequestFields) {
    if (field === "selectedAuthorityMemberRefs") continue;
    equal(
      domainFields.includes(field),
      true,
      `Planning request field ${field} must exist on the domain TaskPackage`,
    );
  }
  const testTaskRequest = definition(planningRequest, "testTaskPackageRequest");
  const testRequestFields = [
    "boundaries",
    "completionExpectations",
    "confirmedContext",
    "lineage",
    "objective",
    "selectedAuthorityMemberRefs",
    "testContract",
    "workType",
  ];
  deepEqual([...(testTaskRequest.required as string[])].sort(), testRequestFields);
  deepEqual(Object.keys(testTaskRequest.properties as JsonObject).sort(), testRequestFields);
  deepEqual((testTaskRequest.properties as JsonObject).workType, {
    const: "test",
  });
  for (const field of testRequestFields) {
    if (field === "selectedAuthorityMemberRefs") continue;
    equal(
      domainFields.includes(field),
      true,
      `Test planning request field ${field} must exist on the domain TaskPackage`,
    );
  }
  deepEqual((planningResult.properties as JsonObject).status, {
    enum: ["committed", "idempotent"],
  });
  equal((planningResult.required as string[]).includes("next"), true);
  deepEqual(definition(planningResult, "next").required, [
    "frontier",
    "owner",
    "suggestedTool",
    "blockers",
  ]);
  const implementationTargetTask = definition(planningResult, "implementationTargetTask");
  const testTargetTask = definition(planningResult, "testTargetTask");
  deepEqual((implementationTargetTask.properties as JsonObject).workType, {
    const: "implementation",
  });
  deepEqual((testTargetTask.properties as JsonObject).workType, {
    const: "test",
  });
  equal(Object.hasOwn(testTargetTask.properties as JsonObject, "repositoryId"), false);
  equal(Object.hasOwn(testTargetTask.properties as JsonObject, "testCard"), false);
  equal(Object.hasOwn(testTargetTask.properties as JsonObject, "testContract"), true);

  const prepareRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-prepare-delivery-request.schema.json",
  );
  const prepareResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-prepare-delivery-result.schema.json",
  );
  const outcomeRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-record-delivery-outcome-request.schema.json",
  );
  const outcomeResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-record-delivery-outcome-result.schema.json",
  );
  const rearmRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-rearm-delivery-request.schema.json",
  );
  const rearmResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-rearm-delivery-result.schema.json",
  );
  const deliveryIdentityDefinitions = [
    "sha256Digest",
    "utcInstant",
    "demandId",
    "targetTaskId",
    "deliveryId",
    "claimId",
    "windowId",
    "bindingId",
    "eventId",
    "commitId",
  ];
  for (const [label, left, right] of [
    ["Prepare Delivery", prepareRequest, prepareResult],
    ["Record Delivery Outcome", outcomeRequest, outcomeResult],
    ["Rearm Delivery", rearmRequest, rearmResult],
    ["Prepare result and Outcome request", prepareResult, outcomeRequest],
    ["Outcome result and Rearm request", outcomeResult, rearmRequest],
  ] as const) {
    for (const sharedDefinition of deliveryIdentityDefinitions) {
      deepEqual(
        definition(left, sharedDefinition),
        definition(right, sharedDefinition),
        `${label} wire definition ${sharedDefinition} must not drift`,
      );
    }
  }
  for (const sharedDefinition of ["hostAction", "fence", "event", "commit", "next"]) {
    deepEqual(
      definition(prepareResult, sharedDefinition),
      definition(rearmResult, sharedDefinition),
      `Prepare and Rearm permit definition ${sharedDefinition} must not drift`,
    );
  }
  // 回调重发的许可没有围栏（§13.87 D1）：Rearm 的 permit.fence 可空，其余字段与 Prepare 一致。
  const { fence: prepareFence, ...preparePermit } = definition(prepareResult, "permit")
    .properties as JsonObject;
  const { fence: rearmFence, ...rearmPermit } = definition(rearmResult, "permit")
    .properties as JsonObject;
  deepEqual(preparePermit, rearmPermit);
  deepEqual(prepareFence, { $ref: "#/$defs/fence" });
  deepEqual(rearmFence, { oneOf: [{ type: "null" }, { $ref: "#/$defs/fence" }] });
  deepEqual(
    ((definition(rearmResult, "delivery").properties as JsonObject).workType as JsonObject).enum,
    ["implementation", "test", "callback"],
  );
  deepEqual(
    Object.keys(prepareRequest.properties as JsonObject).sort(),
    [
      "authored",
      "demandId",
      "expectedStreamRevision",
      "idempotencyKey",
      "language",
      "root",
      "targetTaskId",
    ],
    "Public prepare request carries only the Controller-authored parts and stream position",
  );
  deepEqual(Object.keys(definition(prepareRequest, "authored").properties as JsonObject).sort(), [
    "boundary",
    "focus",
    "goal",
  ]);
  // 许可从不携带原始句柄：宿主动作只暴露句柄摘要。
  deepEqual(Object.keys(definition(prepareResult, "hostAction").properties as JsonObject).sort(), [
    "bindingId",
    "displayTitle",
    "effect",
    "handleDigest",
    "hostId",
    "windowId",
  ]);
  deepEqual(
    Object.keys(outcomeRequest.properties as JsonObject).sort(),
    [
      "attempt",
      "claimDigest",
      "deliveryId",
      "demandId",
      "expectedStreamRevision",
      "idempotencyKey",
      "observedAt",
      "readback",
      "resolution",
      "root",
    ],
    "Public outcome request never restores a disposition echo: Wakeflow derives it",
  );

  const resultImportRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-result-import-request.schema.json",
  );
  const resultImportResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-result-import-result.schema.json",
  );
  for (const sharedDefinition of [
    "sha256Digest",
    "demandId",
    "targetDeliveryId",
    "repositoryId",
    "portableResourcePath",
    "gitObjectId",
  ]) {
    deepEqual(
      definition(resultImportRequest, sharedDefinition),
      definition(resultImportResult, sharedDefinition),
      `TargetResult Import wire definition ${sharedDefinition} must not drift`,
    );
  }

  const implementationReport = readSchema(
    "src/contracts/schemas/governance/result/implementation-target-result-report.schema.json",
  );
  const testReport = readSchema(
    "src/contracts/schemas/governance/result/test-target-result-report.schema.json",
  );
  const implementationContent = definition(resultImportRequest, "implementationReportContent");
  const testContent = definition(resultImportRequest, "testReportContent");
  for (const [publicContent, domainReport] of [
    [implementationContent, implementationReport],
    [testContent, testReport],
  ] as const) {
    // verdict 由 Wakeflow 从逐步记录派生（§13.85 D3），不由目标 Agent 提交。
    const omitted = new Set(["kind", "schemaVersion", "reportedAt", "reportDigest", "verdict"]);
    deepEqual(
      [...(publicContent.required as string[])].sort(),
      (domainReport.required as string[]).filter((field) => !omitted.has(field)).sort(),
    );
    deepEqual(
      Object.keys(publicContent.properties as Record<string, unknown>).sort(),
      Object.keys(domainReport.properties as Record<string, unknown>)
        .filter((field) => !omitted.has(field))
        .sort(),
    );
  }

  const domainTargetResult = readSchema(
    "src/contracts/schemas/governance/result/target-result.schema.json",
  );
  const publicTargetResult = definition(resultImportResult, "targetResult");
  deepEqual(
    [...(publicTargetResult.required as string[])].sort(),
    [...(domainTargetResult.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(publicTargetResult.properties as Record<string, unknown>).sort(),
    Object.keys(domainTargetResult.properties as Record<string, unknown>).sort(),
  );

  const reviewInspectionRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-request.schema.json",
  );
  const reviewInspectionResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-result.schema.json",
  );
  for (const sharedDefinition of ["demandId", "targetTaskId"]) {
    deepEqual(
      definition(reviewInspectionRequest, sharedDefinition),
      definition(reviewInspectionResult, sharedDefinition),
      `Review inspection wire definition ${sharedDefinition} must not drift`,
    );
  }
  const publicReviewTaskPackage = definition(reviewInspectionResult, "reviewTaskPackage");
  deepEqual(
    [...(publicReviewTaskPackage.required as string[])].sort(),
    [...(domainTaskPackage.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(publicReviewTaskPackage.properties as Record<string, unknown>).sort(),
    Object.keys(domainTaskPackage.properties as Record<string, unknown>).sort(),
    "Public Review TaskPackage fields must mirror the domain TaskPackage",
  );
  const publicReviewTargetResult = definition(reviewInspectionResult, "targetResult");
  deepEqual(
    [...(publicReviewTargetResult.required as string[])].sort(),
    [...(domainTargetResult.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(publicReviewTargetResult.properties as Record<string, unknown>).sort(),
    Object.keys(domainTargetResult.properties as Record<string, unknown>).sort(),
    "Public Review TargetResult fields must mirror the domain TargetResult",
  );
  const publicReviewUnit = definition(reviewInspectionResult, "reviewUnit");
  deepEqual((publicReviewUnit.properties as JsonObject).status, {
    enum: ["reported", "review-blocked", "escalated"],
  });
  deepEqual(
    Object.keys(publicReviewUnit.properties as JsonObject).sort(),
    [
      "allowedDecisions",
      "attemptScope",
      "callback",
      "currentDecision",
      "outcome",
      "priorReviewHistory",
      "resumptionBasis",
      "reviewUnitDigest",
      "status",
      "targetCompletion",
      "targetResult",
      "targetResultSourceEvent",
      "targetTaskId",
      "taskPackage",
      "taskPackageSourceEvent",
      "testSteps",
      "workType",
    ],
    "Review inspection unit carries callback, completion, allowed decisions, and the per-step record",
  );
  deepEqual(
    (
      (definition(reviewInspectionResult, "callbackStatus").properties as JsonObject)
        .status as JsonObject
    ).enum,
    ["pending", "landed", "silent", "acknowledged"],
  );

  const implementationDecisionRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-request.schema.json",
  );
  const implementationDecisionResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-implementation-review-decision-result.schema.json",
  );
  for (const sharedDefinition of sharedDefinitions(
    implementationDecisionRequest,
    implementationDecisionResult,
  )) {
    deepEqual(
      definition(implementationDecisionRequest, sharedDefinition),
      definition(implementationDecisionResult, sharedDefinition),
      `Implementation Decision wire definition ${sharedDefinition} must not drift`,
    );
  }
  const appendEnvelopeFields = [
    "root",
    "demandId",
    "idempotencyKey",
    "expectedStreamRevision",
    "targetResultId",
    "snapshotDigest",
    "reviewUnitDigest",
  ];
  const judgmentFields = [
    "assessment",
    "blockingReasons",
    "decision",
    "escalation",
    "independentChecks",
    "rationale",
    "residualRisks",
    "resumption",
  ];
  deepEqual(
    Object.keys(implementationDecisionRequest.properties as Record<string, unknown>)
      .filter((field) => !appendEnvelopeFields.includes(field))
      .sort(),
    // anchorEvidence：needs-review 结果 accept 时的锚点→托管证据绑定，只属于实现决定（§13.121 D7）。
    [...judgmentFields, "anchorEvidence"].sort(),
    "Public Implementation Decision request carries exactly the Controller judgment plus anchor evidence, escalation and resumption",
  );
  deepEqual((implementationDecisionRequest.properties as JsonObject).decision, {
    enum: ["accept", "rework", "blocked", "escalate"],
  });

  const testDecisionRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-test-review-decision-request.schema.json",
  );
  const testDecisionResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-test-review-decision-result.schema.json",
  );
  for (const sharedDefinition of sharedDefinitions(testDecisionRequest, testDecisionResult)) {
    deepEqual(
      definition(testDecisionRequest, sharedDefinition),
      definition(testDecisionResult, sharedDefinition),
      `Test Decision wire definition ${sharedDefinition} must not drift`,
    );
  }
  deepEqual(
    Object.keys(testDecisionRequest.properties as Record<string, unknown>)
      .filter((field) => !appendEnvelopeFields.includes(field))
      .sort(),
    [...judgmentFields, "stepIds"].sort(),
    "Public Test Decision request adds the rerun step scope to the Controller judgment",
  );
  deepEqual((testDecisionRequest.properties as JsonObject).decision, {
    enum: ["accept", "request-another-attempt", "blocked", "escalate"],
  });
  deepEqual(
    (
      (definition(testDecisionRequest, "testEscalation").properties as JsonObject)
        .classification as JsonObject
    ).enum,
    ["product-defect", "needs-decision"],
  );
  deepEqual(
    Object.keys((testDecisionResult.properties as JsonObject).attached as JsonObject)
      .map((key) => key)
      .sort(),
    ["additionalProperties", "properties", "required", "type"],
  );
  deepEqual(
    Object.keys(
      ((testDecisionResult.properties as JsonObject).attached as JsonObject)
        .properties as JsonObject,
    ).sort(),
    ["escalationEventId", "productDefectRemediationId"],
    "Test Decision result names the escalation or remediation appended in the same commit",
  );

  const completionRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-demand-completion-request.schema.json",
  );
  const completionResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-demand-completion-result.schema.json",
  );
  const cancellationRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-demand-cancellation-request.schema.json",
  );
  const cancellationResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-demand-cancellation-result.schema.json",
  );
  // 完成即归档（ADR-0012 D3）：终态请求不回显计划，apply 只带 planDigest；取消多一个 reason。
  for (const [request, fields] of [
    [completionRequest, ["demandId", "mode", "planDigest", "root"]],
    [cancellationRequest, ["demandId", "mode", "planDigest", "reason", "root"]],
  ] as const) {
    equal(Object.hasOwn(request.$defs as JsonObject, "plan"), false);
    deepEqual(
      Object.keys(definition(request, "effectRequest").properties as JsonObject).sort(),
      [...fields],
      "Demand terminal requests carry no plan echo",
    );
    deepEqual(Object.keys(definition(request, "recoverRequest").properties as JsonObject).sort(), [
      "mode",
      "operationId",
      "root",
    ]);
  }
  for (const sharedDefinition of [
    "verifyReport",
    "archiveReceipt",
    "packageReceipt",
    "eventReceipt",
    "nextProjection",
    "blockers",
    "portableResourcePath",
    "sha256Digest",
    "requirementId",
    "demandId",
    "eventId",
    "commitId",
  ]) {
    deepEqual(
      definition(completionResult, sharedDefinition),
      definition(cancellationResult, sharedDefinition),
      `Demand terminal wire definition ${sharedDefinition} must not drift`,
    );
  }
  deepEqual(
    [...(definition(completionResult, "archiveReceipt").required as string[])].sort(),
    ["archiveRef", "fileCount", "manifestDigest", "payloadTreeDigest", "totalBytes"],
    "Public archive receipt names the sealed package without machine paths",
  );
  const archiveManifest = readSchema(
    "src/contracts/schemas/governance/archive/demand-archive-manifest.schema.json",
  );
  deepEqual((archiveManifest.properties as JsonObject).outcome, {
    enum: ["completed", "cancelled"],
  });
  const verifyGates = (definition(completionResult, "verifyReport").properties as JsonObject)
    .gates as JsonObject;
  deepEqual(((verifyGates.items as JsonObject).properties as JsonObject).status, {
    enum: ["pass", "fail", "unavailable"],
  });
  const packageStatus = (definition(completionResult, "packageReceipt").properties as JsonObject)
    .status as JsonObject;
  deepEqual(packageStatus, {
    enum: ["pending", "parked", "claimed", "withdrawn", "archived"],
  });

  // 测试合同随 test 任务包进入规划请求：Controller 只写合同内容，环境与 stepId 由 Wakeflow 派生。
  const contractDomainTaskPackage = readSchema(
    "src/contracts/schemas/governance/tasking/task-package.schema.json",
  );
  const contractPlanningRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json",
  );
  const domainTestContract = definition(contractDomainTaskPackage, "testContract");
  deepEqual(
    Object.keys(
      definition(contractPlanningRequest, "testContractRequest").properties as JsonObject,
    ).sort(),
    Object.keys(domainTestContract.properties as JsonObject)
      .filter((key) => key !== "environment")
      .sort(),
    "Controller-authored test contract must mirror the domain contract minus the derived environment",
  );
  deepEqual(
    Object.keys(
      definition(contractPlanningRequest, "testContractStepRequest").properties as JsonObject,
    ).sort(),
    Object.keys(definition(contractDomainTaskPackage, "testContractStep").properties as JsonObject)
      .filter((key) => key !== "stepId")
      .sort(),
    "Controller-authored test step must mirror the domain step minus the derived stepId",
  );
  const contractReviewInspection = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-result-review-inspection-result.schema.json",
  );
  deepEqual(
    Object.keys(
      definition(contractReviewInspection, "reviewTaskPackageTestContract")
        .properties as JsonObject,
    ).sort(),
    Object.keys(domainTestContract.properties as JsonObject).sort(),
    "Review inspection test contract mirror must not drift from the domain contract",
  );

  // 结果导入请求带幂等键与观察修订；回调许可随结果返回（§13.87 D1）。
  deepEqual(Object.keys(resultImportRequest.properties as JsonObject).sort(), [
    "claimDigest",
    "deliveryId",
    "demandId",
    "expectedStreamRevision",
    "idempotencyKey",
    "report",
    "root",
  ]);
  deepEqual(
    Object.keys(definition(resultImportResult, "callbackPermit").properties as JsonObject).sort(),
    ["generation", "hostAction", "issuedAt", "prompt"],
  );
});
