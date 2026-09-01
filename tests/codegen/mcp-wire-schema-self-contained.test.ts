import { deepEqual, equal } from "node:assert/strict";
import { opendirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

interface JsonObject {
  readonly [key: string]: unknown;
}

function readSchema(relative: string): JsonObject {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), relative), "utf8"),
  ) as JsonObject;
}

function externalReferences(value: unknown, result: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) externalReferences(entry, result);
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (
        key === "$ref" &&
        typeof entry === "string" &&
        !entry.startsWith("#")
      ) {
        result.push(entry);
      }
      externalReferences(entry, result);
    }
  }
  return result;
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

test("MCP wire Schema 自包含且本地词法镜像 Foundation 权威", () => {
  const schemaRoot = path.join(
    process.cwd(),
    "src/contracts/schemas/entrypoints",
  );
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
      externalReferences(
        readSchema(`src/contracts/schemas/entrypoints/${name}`),
      ).length,
      0,
      `${name} must not advertise unresolved external refs`,
    );
  }

  const sha = readSchema(
    "src/contracts/schemas/foundation/sha256-digest.schema.json",
  );
  const utc = readSchema(
    "src/contracts/schemas/foundation/utc-instant.schema.json",
  );
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
  for (const name of [
    "wakeflow-window-host-binding-registration-request.schema.json",
    "wakeflow-window-host-binding-registration-result.schema.json",
    "wakeflow-target-task-planning-request.schema.json",
    "wakeflow-target-task-planning-result.schema.json",
    "wakeflow-target-delivery-preparation-request.schema.json",
    "wakeflow-target-delivery-preparation-result.schema.json",
    "wakeflow-target-host-effect-claim-request.schema.json",
    "wakeflow-target-host-effect-claim-result.schema.json",
    "wakeflow-target-host-effect-outcome-request.schema.json",
    "wakeflow-target-host-effect-outcome-result.schema.json",
    "wakeflow-target-host-effect-rearm-request.schema.json",
    "wakeflow-target-host-effect-rearm-result.schema.json",
    "wakeflow-target-result-review-inspection-result.schema.json",
    "wakeflow-controller-implementation-review-decision-request.schema.json",
    "wakeflow-controller-implementation-review-decision-result.schema.json",
    "wakeflow-controller-test-review-decision-request.schema.json",
    "wakeflow-controller-test-review-decision-result.schema.json",
    "wakeflow-controller-product-defect-remediation-request.schema.json",
    "wakeflow-controller-product-defect-remediation-result.schema.json",
    "wakeflow-target-result-import-request.schema.json",
    "wakeflow-target-result-import-result.schema.json",
    "wakeflow-demand-controller-route-result.schema.json",
    "wakeflow-demand-completion-request.schema.json",
    "wakeflow-demand-completion-result.schema.json",
    "wakeflow-target-result-review-resume-request.schema.json",
    "wakeflow-target-result-review-resume-result.schema.json",
    "wakeflow-test-card-planning-request.schema.json",
    "wakeflow-test-card-planning-result.schema.json",
    "wakeflow-test-delivery-preparation-request.schema.json",
    "wakeflow-test-delivery-preparation-result.schema.json",
  ]) {
    const schema = readSchema(`src/contracts/schemas/entrypoints/${name}`);
    deepEqual(definition(schema, "sha256Digest"), expectedSha);
  }
  for (const name of [
    "wakeflow-window-host-binding-registration-request.schema.json",
    "wakeflow-window-host-binding-registration-result.schema.json",
    "wakeflow-target-task-planning-request.schema.json",
    "wakeflow-target-task-planning-result.schema.json",
    "wakeflow-target-delivery-preparation-request.schema.json",
    "wakeflow-target-delivery-preparation-result.schema.json",
    "wakeflow-target-host-effect-claim-request.schema.json",
    "wakeflow-target-host-effect-claim-result.schema.json",
    "wakeflow-target-host-effect-outcome-request.schema.json",
    "wakeflow-target-host-effect-outcome-result.schema.json",
    "wakeflow-target-host-effect-rearm-result.schema.json",
    "wakeflow-target-result-review-inspection-result.schema.json",
    "wakeflow-controller-implementation-review-decision-result.schema.json",
    "wakeflow-controller-test-review-decision-result.schema.json",
    "wakeflow-controller-product-defect-remediation-result.schema.json",
    "wakeflow-target-result-import-result.schema.json",
    "wakeflow-demand-completion-request.schema.json",
    "wakeflow-demand-completion-result.schema.json",
    "wakeflow-target-result-review-resume-result.schema.json",
    "wakeflow-test-card-planning-request.schema.json",
    "wakeflow-test-card-planning-result.schema.json",
    "wakeflow-test-delivery-preparation-request.schema.json",
    "wakeflow-test-delivery-preparation-result.schema.json",
  ]) {
    const schema = readSchema(`src/contracts/schemas/entrypoints/${name}`);
    deepEqual(definition(schema, "utcInstant"), expectedUtc);
  }

  const routeRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-demand-controller-route-request.schema.json",
  );
  const routeResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-demand-controller-route-result.schema.json",
  );
  deepEqual(
    definition(routeRequest, "demandId"),
    definition(routeResult, "demandId"),
    "Demand Controller Route request/result demand identity must not drift",
  );

  const planningRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json",
  );
  const planningResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-task-planning-result.schema.json",
  );
  for (const sharedDefinition of [
    "plan",
    "taskPackage",
    "authorityMemberReference",
    "assignment",
    "implementationAssignment",
    "testAssignment",
    "boundaries",
    "acceptanceAnchor",
    "testCardTuple",
    "nonEmptyTextList",
    "textList",
    "humanText",
    "portableResourcePath",
    "sha256Digest",
    "utcInstant",
    "programId",
    "demandId",
    "repositoryId",
    "windowId",
    "taskPackageId",
    "targetTaskId",
    "eventId",
    "commitId",
  ]) {
    deepEqual(
      definition(planningRequest, sharedDefinition),
      definition(planningResult, sharedDefinition),
      `Planning wire definition ${sharedDefinition} must not drift`,
    );
  }
  const domainTaskPackage = readSchema(
    "src/contracts/schemas/governance/tasking/task-package.schema.json",
  );
  const publicTaskPackage = definition(planningRequest, "taskPackage");
  deepEqual(
    [...(publicTaskPackage.required as string[])].sort(),
    [...(domainTaskPackage.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(publicTaskPackage.properties as Record<string, unknown>).sort(),
    Object.keys(domainTaskPackage.properties as Record<string, unknown>).sort(),
    "Public Planning TaskPackage fields must mirror the full domain union",
  );
  deepEqual(
    (publicTaskPackage.properties as Record<string, unknown>).workType,
    { enum: ["implementation", "test"] },
  );
  const implementationTaskRequest = definition(
    planningRequest,
    "implementationTaskPackageRequest",
  );
  const testTaskRequest = definition(planningRequest, "testTaskPackageRequest");
  deepEqual(
    (implementationTaskRequest.properties as Record<string, unknown>).workType,
    { const: "implementation" },
  );
  deepEqual(testTaskRequest.required, ["workType"]);
  deepEqual(Object.keys(testTaskRequest.properties as JsonObject), [
    "workType",
  ]);
  deepEqual((testTaskRequest.properties as JsonObject).workType, {
    const: "test",
  });
  const implementationTargetTask = definition(
    planningResult,
    "implementationTargetTask",
  );
  const testTargetTask = definition(planningResult, "testTargetTask");
  deepEqual((implementationTargetTask.properties as JsonObject).workType, {
    const: "implementation",
  });
  deepEqual((testTargetTask.properties as JsonObject).workType, {
    const: "test",
  });
  equal(
    Object.hasOwn(testTargetTask.properties as JsonObject, "repositoryId"),
    false,
  );
  equal(
    Object.hasOwn(testTargetTask.properties as JsonObject, "testCard"),
    true,
  );

  const deliveryRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-delivery-preparation-request.schema.json",
  );
  const deliveryResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-delivery-preparation-result.schema.json",
  );
  for (const sharedDefinition of [
    "plan",
    "intent",
    "intentTarget",
    "intentRoute",
    "rework",
    "productDefectRemediation",
    "reviewDecisionReference",
    "previousResultReference",
    "requiredCorrection",
    "productDefectRequiredCorrection",
    "checkId",
    "longSummary",
    "methodSummary",
    "observationSummary",
    "portableResourcePath",
    "sha256Digest",
    "utcInstant",
    "hostId",
    "programId",
    "demandId",
    "targetTaskId",
    "taskPackageId",
    "windowId",
    "bindingId",
    "targetDeliveryId",
    "targetReviewDecisionId",
    "targetResultId",
    "productDefectRemediationId",
    "eventId",
    "commitId",
  ]) {
    deepEqual(
      definition(deliveryRequest, sharedDefinition),
      definition(deliveryResult, sharedDefinition),
      `Delivery Preparation wire definition ${sharedDefinition} must not drift`,
    );
  }
  const domainIntent = readSchema(
    "src/contracts/schemas/governance/delivery/target-delivery-intent.schema.json",
  );
  const publicIntent = definition(deliveryRequest, "intent");
  deepEqual(
    [...(publicIntent.required as string[])].sort(),
    [...(domainIntent.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(publicIntent.properties as Record<string, unknown>).sort(),
    Object.keys(domainIntent.properties as Record<string, unknown>).sort(),
    "Public Delivery Intent fields must mirror the domain Intent",
  );

  const claimRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-host-effect-claim-request.schema.json",
  );
  const claimResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-host-effect-claim-result.schema.json",
  );
  for (const sharedDefinition of [
    "sha256Digest",
    "utcInstant",
    "hostId",
    "demandId",
    "targetTaskId",
    "targetDeliveryId",
    "windowId",
    "bindingId",
  ]) {
    deepEqual(
      definition(claimRequest, sharedDefinition),
      definition(claimResult, sharedDefinition),
      `Host Effect Claim wire definition ${sharedDefinition} must not drift`,
    );
  }
  const domainObservation = readSchema(
    "src/contracts/schemas/workspace/agent-host-window-observation.schema.json",
  );
  const publicObservation = definition(claimRequest, "observation");
  deepEqual(
    [...(publicObservation.required as string[])].sort(),
    [...(domainObservation.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(publicObservation.properties as Record<string, unknown>).sort(),
    Object.keys(domainObservation.properties as Record<string, unknown>).sort(),
    "Public Claim observation fields must mirror the transient domain observation",
  );

  const outcomeRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-host-effect-outcome-request.schema.json",
  );
  const outcomeResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-host-effect-outcome-result.schema.json",
  );
  for (const sharedDefinition of [
    "sha256Digest",
    "utcInstant",
    "demandId",
    "claimId",
  ]) {
    deepEqual(
      definition(outcomeRequest, sharedDefinition),
      definition(outcomeResult, sharedDefinition),
      `Host Effect Outcome wire definition ${sharedDefinition} must not drift`,
    );
  }
  for (const sharedDefinition of ["sha256Digest", "demandId", "claimId"]) {
    deepEqual(
      definition(claimResult, sharedDefinition),
      definition(outcomeRequest, sharedDefinition),
      `Claim result and Outcome request definition ${sharedDefinition} must not drift`,
    );
  }

  const rearmRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-host-effect-rearm-request.schema.json",
  );
  const rearmResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-host-effect-rearm-result.schema.json",
  );
  for (const sharedDefinition of ["sha256Digest", "demandId", "claimId"]) {
    deepEqual(
      definition(rearmRequest, sharedDefinition),
      definition(rearmResult, sharedDefinition),
      `Host Effect Rearm wire definition ${sharedDefinition} must not drift`,
    );
    deepEqual(
      definition(outcomeResult, sharedDefinition),
      definition(rearmRequest, sharedDefinition),
      `Outcome result and Rearm request definition ${sharedDefinition} must not drift`,
    );
  }
  const domainRearm = readSchema(
    "src/contracts/schemas/governance/delivery/target-host-effect-rearm.schema.json",
  );
  const publicRearm = definition(rearmResult, "rearm");
  deepEqual(
    [...(publicRearm.required as string[])].sort(),
    [...(domainRearm.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(publicRearm.properties as Record<string, unknown>).sort(),
    Object.keys(domainRearm.properties as Record<string, unknown>).sort(),
    "Public Rearm fields must mirror the domain Rearm fact",
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
    "claimId",
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
  const implementationContent = definition(
    resultImportRequest,
    "implementationReportContent",
  );
  const testContent = definition(resultImportRequest, "testReportContent");
  for (const [publicContent, domainReport] of [
    [implementationContent, implementationReport],
    [testContent, testReport],
  ] as const) {
    const omitted = new Set([
      "kind",
      "schemaVersion",
      "reportedAt",
      "reportDigest",
    ]);
    deepEqual(
      [...(publicContent.required as string[])].sort(),
      (domainReport.required as string[])
        .filter((field) => !omitted.has(field))
        .sort(),
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
    Object.keys(
      publicTargetResult.properties as Record<string, unknown>,
    ).sort(),
    Object.keys(
      domainTargetResult.properties as Record<string, unknown>,
    ).sort(),
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
  const publicReviewTaskPackage = definition(
    reviewInspectionResult,
    "reviewTaskPackage",
  );
  deepEqual(
    [...(publicReviewTaskPackage.required as string[])].sort(),
    [...(domainTaskPackage.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(
      publicReviewTaskPackage.properties as Record<string, unknown>,
    ).sort(),
    Object.keys(domainTaskPackage.properties as Record<string, unknown>).sort(),
    "Public Review TaskPackage fields must mirror the domain TaskPackage",
  );
  const publicReviewTargetResult = definition(
    reviewInspectionResult,
    "targetResult",
  );
  deepEqual(
    [...(publicReviewTargetResult.required as string[])].sort(),
    [...(domainTargetResult.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(
      publicReviewTargetResult.properties as Record<string, unknown>,
    ).sort(),
    Object.keys(
      domainTargetResult.properties as Record<string, unknown>,
    ).sort(),
    "Public Review TargetResult fields must mirror the domain TargetResult",
  );
  const publicReviewUnit = definition(reviewInspectionResult, "reviewUnit");
  deepEqual(publicReviewUnit.oneOf, [
    { $ref: "#/$defs/reportedReviewUnit" },
    { $ref: "#/$defs/blockedReviewUnit" },
  ]);
  const reportedReviewUnit = definition(
    reviewInspectionResult,
    "reportedReviewUnit",
  );
  const blockedReviewUnit = definition(
    reviewInspectionResult,
    "blockedReviewUnit",
  );
  deepEqual(
    [...(blockedReviewUnit.required as string[])].sort(),
    [
      ...(reportedReviewUnit.required as string[]),
      "currentBlockedDecision",
    ].sort(),
  );
  deepEqual(
    Object.keys(blockedReviewUnit.properties as Record<string, unknown>).sort(),
    [
      ...Object.keys(reportedReviewUnit.properties as Record<string, unknown>),
      "currentBlockedDecision",
    ].sort(),
  );
  deepEqual((reportedReviewUnit.properties as Record<string, unknown>).status, {
    const: "reported",
  });
  deepEqual((blockedReviewUnit.properties as Record<string, unknown>).status, {
    const: "review-blocked",
  });
  const currentBlockedDecision = definition(
    reviewInspectionResult,
    "currentBlockedDecision",
  );
  deepEqual(currentBlockedDecision.required, ["sourceEvent", "decision"]);

  const implementationDecisionRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-controller-implementation-review-decision-request.schema.json",
  );
  const implementationDecisionResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-controller-implementation-review-decision-result.schema.json",
  );
  for (const sharedDefinition of [
    "sha256Digest",
    "demandId",
    "targetResultId",
  ]) {
    deepEqual(
      definition(implementationDecisionRequest, sharedDefinition),
      definition(implementationDecisionResult, sharedDefinition),
      `Implementation Decision wire definition ${sharedDefinition} must not drift`,
    );
  }
  const domainImplementationDecision = readSchema(
    "src/contracts/schemas/governance/review/controller-implementation-review-decision.schema.json",
  );
  const publicImplementationDecision = definition(
    implementationDecisionResult,
    "decision",
  );
  deepEqual(
    [...(publicImplementationDecision.required as string[])].sort(),
    [...(domainImplementationDecision.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(
      publicImplementationDecision.properties as Record<string, unknown>,
    ).sort(),
    Object.keys(
      domainImplementationDecision.properties as Record<string, unknown>,
    ).sort(),
    "Public Implementation Decision fields must mirror the domain Decision",
  );
  const judgmentFields = [
    "assessment",
    "blockingReasons",
    "decision",
    "independentChecks",
    "rationale",
    "residualRisks",
  ];
  deepEqual(
    Object.keys(
      implementationDecisionRequest.properties as Record<string, unknown>,
    )
      .filter(
        (field) =>
          ![
            "root",
            "demandId",
            "targetResultId",
            "snapshotDigest",
            "reviewUnitDigest",
          ].includes(field),
      )
      .sort(),
    judgmentFields,
    "Public Decision request must contain exactly the Controller judgment fields",
  );

  const testDecisionRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-controller-test-review-decision-request.schema.json",
  );
  const testDecisionResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-controller-test-review-decision-result.schema.json",
  );
  for (const sharedDefinition of [
    "sha256Digest",
    "demandId",
    "targetResultId",
  ]) {
    deepEqual(
      definition(testDecisionRequest, sharedDefinition),
      definition(testDecisionResult, sharedDefinition),
      `Test Decision wire definition ${sharedDefinition} must not drift`,
    );
  }
  const domainTestDecision = readSchema(
    "src/contracts/schemas/governance/review/controller-test-review-decision.schema.json",
  );
  const publicTestDecision = definition(testDecisionResult, "decision");
  deepEqual(
    [...(publicTestDecision.required as string[])].sort(),
    [...(domainTestDecision.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(
      publicTestDecision.properties as Record<string, unknown>,
    ).sort(),
    Object.keys(
      domainTestDecision.properties as Record<string, unknown>,
    ).sort(),
    "Public Test Decision fields must mirror the domain Decision",
  );
  deepEqual(
    Object.keys(testDecisionRequest.properties as Record<string, unknown>)
      .filter(
        (field) =>
          ![
            "root",
            "demandId",
            "targetResultId",
            "snapshotDigest",
            "reviewUnitDigest",
          ].includes(field),
      )
      .sort(),
    judgmentFields,
    "Public Test Decision request must contain exactly the Controller judgment fields",
  );

  const remediationRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-controller-product-defect-remediation-request.schema.json",
  );
  const remediationResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-controller-product-defect-remediation-result.schema.json",
  );
  for (const sharedDefinition of [
    "sha256Digest",
    "demandId",
    "targetReviewDecisionId",
    "targetTaskId",
  ]) {
    deepEqual(
      definition(remediationRequest, sharedDefinition),
      definition(remediationResult, sharedDefinition),
      `Product Remediation wire definition ${sharedDefinition} must not drift`,
    );
  }
  const domainRemediationAuthorization = readSchema(
    "src/contracts/schemas/governance/review/controller-product-defect-remediation-authorization.schema.json",
  );
  const publicRemediationAuthorization = definition(
    remediationResult,
    "authorization",
  );
  deepEqual(
    [...(publicRemediationAuthorization.required as string[])].sort(),
    [...(domainRemediationAuthorization.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(
      publicRemediationAuthorization.properties as Record<string, unknown>,
    ).sort(),
    Object.keys(
      domainRemediationAuthorization.properties as Record<string, unknown>,
    ).sort(),
    "Public Product Remediation fields must mirror the domain Authorization",
  );
  deepEqual(
    Object.keys(
      remediationRequest.properties as Record<string, unknown>,
    ).sort(),
    [
      "affectedTargets",
      "authorizationRationale",
      "demandId",
      "postAcceptanceRouteDigest",
      "root",
      "testReviewDecisionId",
    ],
    "Public Product Remediation request must not expose Test Target or baseline echoes",
  );

  const completionRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-demand-completion-request.schema.json",
  );
  const completionResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-demand-completion-result.schema.json",
  );
  for (const sharedDefinition of [
    "plan",
    "authority",
    "completion",
    "authorityMemberReference",
    "testingDecision",
    "observedState",
    "todoSource",
    "nonEmptyText",
    "portableResourcePath",
    "sha256Digest",
    "utcInstant",
    "todoId",
    "programId",
    "demandId",
    "windowId",
    "eventId",
    "commitId",
  ]) {
    deepEqual(
      definition(completionRequest, sharedDefinition),
      definition(completionResult, sharedDefinition),
      `Demand Completion wire definition ${sharedDefinition} must not drift`,
    );
  }

  const domainCompletion = readSchema(
    "src/contracts/schemas/governance/lifecycle/demand-completion.schema.json",
  );
  const publicCompletion = definition(completionRequest, "completion");
  deepEqual(
    [...(publicCompletion.required as string[])].sort(),
    [...(domainCompletion.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(publicCompletion.properties as Record<string, unknown>).sort(),
    Object.keys(domainCompletion.properties as Record<string, unknown>).sort(),
    "Public Completion fields must mirror the domain Completion",
  );

  const domainAuthority = readSchema(
    "src/contracts/schemas/governance/demand/demand-authority.schema.json",
  );
  const publicAuthority = definition(completionRequest, "authority");
  deepEqual(
    [...(publicAuthority.required as string[])].sort(),
    [...(domainAuthority.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(publicAuthority.properties as Record<string, unknown>).sort(),
    Object.keys(domainAuthority.properties as Record<string, unknown>).sort(),
    "Public Completion plan Authority fields must mirror Demand Authority",
  );

  const domainAuthorityMember = readSchema(
    "src/contracts/schemas/governance/ledger/ledger-authority-member-reference.schema.json",
  );
  const publicAuthorityMember = definition(
    completionRequest,
    "authorityMemberReference",
  );
  deepEqual(
    [...(publicAuthorityMember.required as string[])].sort(),
    [...(domainAuthorityMember.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(
      publicAuthorityMember.properties as Record<string, unknown>,
    ).sort(),
    Object.keys(
      domainAuthorityMember.properties as Record<string, unknown>,
    ).sort(),
    "Public Completion plan Authority reference fields must mirror Ledger Authority",
  );

  const testCardPlanningRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-test-card-planning-request.schema.json",
  );
  const testCardPlanningResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-test-card-planning-result.schema.json",
  );
  for (const sharedDefinition of [
    "plan",
    "demandAuthority",
    "testCard",
    "generationSource",
    "authorityMemberReference",
    "portableResourcePath",
    "sha256Digest",
    "utcInstant",
    "demandId",
    "eventId",
    "commitId",
  ]) {
    deepEqual(
      definition(testCardPlanningRequest, sharedDefinition),
      definition(testCardPlanningResult, sharedDefinition),
      `TestCard Planning wire definition ${sharedDefinition} must not drift`,
    );
  }

  const domainTestCard = readSchema(
    "src/contracts/schemas/governance/testing/test-card.schema.json",
  );
  const publicTestCard = definition(testCardPlanningRequest, "testCard");
  deepEqual(
    [...(publicTestCard.required as string[])].sort(),
    [...(domainTestCard.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(publicTestCard.properties as Record<string, unknown>).sort(),
    Object.keys(domainTestCard.properties as Record<string, unknown>).sort(),
    "Public TestCard fields must mirror the domain TestCard",
  );

  const publicTestCardAuthority = definition(
    testCardPlanningRequest,
    "demandAuthority",
  );
  deepEqual(
    [...(publicTestCardAuthority.required as string[])].sort(),
    [...(domainAuthority.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(
      publicTestCardAuthority.properties as Record<string, unknown>,
    ).sort(),
    Object.keys(domainAuthority.properties as Record<string, unknown>).sort(),
    "Public TestCard plan Authority fields must mirror Demand Authority",
  );

  const publicTestCardAuthorityMember = definition(
    testCardPlanningRequest,
    "authorityMemberReference",
  );
  deepEqual(
    [...(publicTestCardAuthorityMember.required as string[])].sort(),
    [...(domainAuthorityMember.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(
      publicTestCardAuthorityMember.properties as Record<string, unknown>,
    ).sort(),
    Object.keys(
      domainAuthorityMember.properties as Record<string, unknown>,
    ).sort(),
    "Public TestCard Authority reference fields must mirror Ledger Authority",
  );

  const testDeliveryRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-test-delivery-preparation-request.schema.json",
  );
  const testDeliveryResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-test-delivery-preparation-result.schema.json",
  );
  for (const sharedDefinition of [
    "plan",
    "intent",
    "intentTarget",
    "intentRoute",
    "testExecutionAttempt",
    "testCardTuple",
    "replacement",
    "rerunSource",
    "environmentSetup",
    "setupPolicy",
    "portableResourcePath",
    "sha256Digest",
    "utcInstant",
    "hostId",
    "programId",
    "demandId",
    "targetTaskId",
    "taskPackageId",
    "testCardId",
    "windowId",
    "bindingId",
    "targetDeliveryId",
    "testAttemptId",
    "targetResultId",
    "targetReviewDecisionId",
    "claimId",
    "eventId",
    "commitId",
  ]) {
    deepEqual(
      definition(testDeliveryRequest, sharedDefinition),
      definition(testDeliveryResult, sharedDefinition),
      `Test Delivery Preparation wire definition ${sharedDefinition} must not drift`,
    );
  }

  const domainTestDeliveryIntent = readSchema(
    "src/contracts/schemas/governance/testing/test-delivery-intent.schema.json",
  );
  const publicTestDeliveryIntent = definition(testDeliveryRequest, "intent");
  deepEqual(
    [...(publicTestDeliveryIntent.required as string[])].sort(),
    [...(domainTestDeliveryIntent.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(
      publicTestDeliveryIntent.properties as Record<string, unknown>,
    ).sort(),
    Object.keys(
      domainTestDeliveryIntent.properties as Record<string, unknown>,
    ).sort(),
    "Public Test Delivery Intent fields must mirror the domain Intent",
  );

  const domainTestExecutionAttempt = readSchema(
    "src/contracts/schemas/governance/testing/test-execution-attempt.schema.json",
  );
  const publicTestExecutionAttempt = definition(
    testDeliveryRequest,
    "testExecutionAttempt",
  );
  deepEqual(
    [...(publicTestExecutionAttempt.required as string[])].sort(),
    [...(domainTestExecutionAttempt.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(
      publicTestExecutionAttempt.properties as Record<string, unknown>,
    ).sort(),
    Object.keys(
      domainTestExecutionAttempt.properties as Record<string, unknown>,
    ).sort(),
    "Public Test Execution Attempt fields must mirror the domain Attempt",
  );

  const testDeliveryPreviewRequest = definition(
    testDeliveryRequest,
    "previewRequest",
  );
  deepEqual(
    Object.keys(
      testDeliveryPreviewRequest.properties as Record<string, unknown>,
    ).sort(),
    ["demandId", "mode", "root", "targetTaskId"],
    "Public Test Delivery preview must not restore mode or lineage echoes",
  );

  const authoredContent = definition(
    testCardPlanningRequest,
    "authoredContent",
  );
  deepEqual(
    Object.keys(authoredContent.properties as Record<string, unknown>).sort(),
    [
      "allowedOperations",
      "allowedSkills",
      "approvedPlan",
      "cannotConclude",
      "controllerSelfChecks",
      "evidenceRequired",
      "failureMeans",
      "forbiddenOperations",
      "maxAttempts",
      "objectBoundary",
      "question",
      "realScenarioConditions",
      "setupPolicy",
      "stopConditions",
      "successMeans",
    ],
    "Public TestCard preview must contain exactly Controller-authored content",
  );
  const testCardPreviewRequest = definition(
    testCardPlanningRequest,
    "previewRequest",
  );
  deepEqual(
    Object.keys(
      testCardPreviewRequest.properties as Record<string, unknown>,
    ).sort(),
    ["demandId", "mode", "root", "testCard"],
    "Public TestCard preview must not restore an Authority path selector",
  );

  const resumeRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-result-review-resume-request.schema.json",
  );
  const resumeResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-result-review-resume-result.schema.json",
  );
  for (const sharedDefinition of ["sha256Digest", "demandId", "targetTaskId"]) {
    deepEqual(
      definition(resumeRequest, sharedDefinition),
      definition(resumeResult, sharedDefinition),
      `Target Result Review Resume wire definition ${sharedDefinition} must not drift`,
    );
  }
  deepEqual(
    Object.keys(resumeRequest.properties as Record<string, unknown>).sort(),
    [
      "root",
      "demandId",
      "targetTaskId",
      "expectedBlockedState",
      "resolutionSummary",
    ].sort(),
    "Public Resume request must not restore derived Decision, Result, or Snapshot echoes",
  );
  const domainResume = readSchema(
    "src/contracts/schemas/governance/review/controller-target-review-resume.schema.json",
  );
  const publicResume = definition(resumeResult, "resume");
  deepEqual(
    [...(publicResume.required as string[])].sort(),
    [...(domainResume.required as string[])].sort(),
  );
  deepEqual(
    Object.keys(publicResume.properties as Record<string, unknown>).sort(),
    Object.keys(domainResume.properties as Record<string, unknown>).sort(),
    "Public Resume result fields must mirror the domain Resume",
  );
  for (const sharedDefinition of ["blockedDecision", "blockedSource"]) {
    const publicDefinition = definition(resumeResult, sharedDefinition);
    const domainDefinition = definition(domainResume, sharedDefinition);
    deepEqual(
      [...(publicDefinition.required as string[])].sort(),
      [...(domainDefinition.required as string[])].sort(),
    );
    deepEqual(
      Object.keys(
        publicDefinition.properties as Record<string, unknown>,
      ).sort(),
      Object.keys(
        domainDefinition.properties as Record<string, unknown>,
      ).sort(),
      `Public Resume result definition ${sharedDefinition} fields must mirror its domain definition`,
    );
  }
});
