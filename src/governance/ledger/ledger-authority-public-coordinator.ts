import {
  WAKEFLOW_CONFIRMATION_PUBLICATION_RESULT_SCHEMA,
  type WakeflowConfirmationPublicationResultV1 as ConfirmationPublicResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-confirmation-publication-result.generated.js";
import {
  WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA,
  type WakeflowRequirementPublicationResultV1 as RequirementPublicResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-requirement-publication-result.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  LedgerAuthorityPublicationApplicationService,
  LedgerAuthorityPublicationApplicationServiceError,
  type LedgerAuthorityPublicationApplicationOptions,
  type LedgerAuthorityPublicationApplicationResult,
  type LedgerAuthorityPublicationEffectAuthority,
} from "./ledger-authority-publication-application-service.js";
import {
  LedgerAuthorityPublicationPlanningService,
  LedgerAuthorityPublicationPlanningServiceError,
  type LedgerAuthorityPublicationPlanningOptions,
} from "./ledger-authority-publication-planning-service.js";
import {
  parseConfirmationPublicationPublicRequest,
  parseRequirementPublicationPublicRequest,
  LedgerAuthorityPublicationPublicContractError,
  WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_LEDGER_AUTHORITY_PUBLICATION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
  type ConfirmationPublicationPublicRequest,
  type ConfirmationPublicationPublicResult,
  type RequirementPublicationPublicRequest,
  type RequirementPublicationPublicResult,
} from "./ledger-authority-public-contract.js";

/**
 * Wakeflow Governance / Ledger：双family公共根作用域、模式路由与结果脱敏边界。
 *
 * 两个executor分别固定Requirement或Confirmation family；共享函数只拥有Workspace根
 * 生命周期、隐私扫描、Planning/Application调用和成功receipt投影。Coordinator不创建
 * ID/Plan、不解释source、不访问Store，也不注册MCP工具。
 */

export interface LedgerAuthorityPublicationPublicCoordinatorOptions {
  readonly preview?: LedgerAuthorityPublicationPlanningOptions;
  readonly apply?: LedgerAuthorityPublicationApplicationOptions;
  readonly recover?: LedgerAuthorityPublicationApplicationOptions;
}

export type LedgerAuthorityPublicationPublicCoordinatorErrorReason =
  | "root"
  | "privacy"
  | "preview"
  | "apply"
  | "recover"
  | "output";

const ERROR_MESSAGES = {
  root: "Ledger authority publication public workspace root is invalid.",
  privacy: "Ledger authority publication public content contains private root text.",
  preview: "Ledger authority publication public preview failed.",
  apply: "Ledger authority publication public apply failed.",
  recover: "Ledger authority publication public recovery failed.",
  output: "Ledger authority publication public result violated its boundary.",
} as const satisfies Readonly<Record<
  LedgerAuthorityPublicationPublicCoordinatorErrorReason,
  string
>>;

/** 公共路由无法证明安全根、领域结果或最小披露时的稳定错误。 */
export class LedgerAuthorityPublicationPublicCoordinatorError extends Error {
  override readonly name =
    "LedgerAuthorityPublicationPublicCoordinatorError";
  readonly code =
    "wakeflow-ledger-authority-publication-public-coordinator" as const;
  readonly reason: LedgerAuthorityPublicationPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly publicationAuthority: LedgerAuthorityPublicationEffectAuthority;

  constructor(
    reason: LedgerAuthorityPublicationPublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    publicationAuthority: LedgerAuthorityPublicationEffectAuthority =
      "unknown",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.publicationAuthority = publicationAuthority;
  }
}

type PublicationFamily = "requirement" | "confirmation";
type PublicRequest =
  | RequirementPublicationPublicRequest
  | ConfirmationPublicationPublicRequest;
type PublicResult =
  | RequirementPublicationPublicResult
  | ConfirmationPublicationPublicResult;

const LEDGER_AUTHORITY_PUBLIC_MAXIMUM_RESULT_BYTES = 2 * 1024 * 1024;
const validateRequirementResult =
  createRuntimeJsonSchemaValidator<RequirementPublicResultWire>(
    WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA,
  );
const validateConfirmationResult =
  createRuntimeJsonSchemaValidator<ConfirmationPublicResultWire>(
    WAKEFLOW_CONFIRMATION_PUBLICATION_RESULT_SCHEMA,
  );

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined
    && Object.hasOwn(descriptor, "value")
    && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: LedgerAuthorityPublicationPublicCoordinatorErrorReason,
  cause?: unknown,
  publicationAuthority: LedgerAuthorityPublicationEffectAuthority = "unknown",
): never {
  throw new LedgerAuthorityPublicationPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    publicationAuthority,
  );
}

function containsPrivateText(
  value: unknown,
  privateValues: ReadonlySet<string>,
): boolean {
  if (typeof value === "string") {
    return [...privateValues].some((privateValue) =>
      value.includes(privateValue));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value as Readonly<Record<string, unknown>>).some(
    (entry) => containsPrivateText(entry, privateValues),
  );
}

function publicResult(
  value: unknown,
  family: PublicationFamily,
  privateValues: ReadonlySet<string>,
  publicationAuthority: LedgerAuthorityPublicationEffectAuthority,
): PublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("output", error, publicationAuthority);
    }
    throw error;
  }
  const validated = family === "requirement"
    ? validateRequirementResult(json)
    : validateConfirmationResult(json);
  if (
    encodeCanonicalJson(json, "$result").byteLength
      > LEDGER_AUTHORITY_PUBLIC_MAXIMUM_RESULT_BYTES
    || containsPrivateText(json, privateValues)
    || !validated.ok
  ) {
    fail("output", undefined, publicationAuthority);
  }
  return json as unknown as PublicResult;
}

function assertApplicationResult(
  value: Readonly<LedgerAuthorityPublicationApplicationResult>,
  family: PublicationFamily,
  operation: "apply" | "recover",
): void {
  const record = value.loaded.record;
  const actualFamily = record.artifactKind === "wakeflow-requirement-record"
    ? "requirement"
    : "confirmation";
  const recordId = record.artifactKind === "wakeflow-requirement-record"
    ? record.requirementId
    : record.confirmationId;
  if (
    actualFamily !== family
    || value.operation !== operation
    || (value.disposition === "current") !== !value.wroteAuthority
    || (operation === "recover" && value.disposition === "published")
    || value.memberReferences.length !== value.loaded.documents.length
    || value.memberReferences.some((reference, index) => {
      const document = value.loaded.documents[index];
      return document === undefined
        || reference.family !== family
        || reference.recordId !== recordId
        || reference.recordRef !== value.loaded.recordRef
        || reference.recordDigest !== value.loaded.recordDigest
        || reference.memberPath !== document.path
        || reference.memberRef !== document.memberRef
        || reference.memberDigest !== document.digest
        || reference.role !== document.role
        || reference.mediaType !== document.mediaType;
    })
  ) {
    fail("output", undefined, "current");
  }
}

function publicationReceipt(
  value: Readonly<LedgerAuthorityPublicationApplicationResult>,
  family: PublicationFamily,
): Readonly<Record<string, unknown>> {
  assertApplicationResult(value, family, value.operation);
  const record = value.loaded.record;
  const common = {
    publicationAuthority: "current" as const,
    disposition: value.disposition,
    recordRef: value.loaded.recordRef,
    recordDigest: value.loaded.recordDigest,
    memberReferences: value.memberReferences,
  };
  return record.artifactKind === "wakeflow-requirement-record"
    ? Object.freeze({ requirementId: record.requirementId, ...common })
    : Object.freeze({
        confirmationId: record.confirmationId,
        demandId: record.demandId,
        ...common,
      });
}

function initialPublicationAuthority(
  mode: "preview" | "apply" | "recover",
): LedgerAuthorityPublicationEffectAuthority {
  return mode === "preview" ? "unchanged" : "unknown";
}

async function executePublicRequest(
  request: PublicRequest,
  family: PublicationFamily,
  options: LedgerAuthorityPublicationPublicCoordinatorOptions,
): Promise<PublicResult> {
  let publicationAuthority = initialPublicationAuthority(request.mode);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("root", error, publicationAuthority);
    }
    throw error;
  }
  const privateValues = new Set(
    [request.root, root.absolutePath].filter((entry) => entry.length > 1),
  );
  let result: PublicResult | undefined;
  let failure: unknown;
  try {
    if (request.mode === "preview") {
      if (
        containsPrivateText(request.title, privateValues)
        || containsPrivateText(request.documents, privateValues)
      ) {
        fail("privacy", undefined, "unchanged");
      }
      let preview;
      try {
        const service = new LedgerAuthorityPublicationPlanningService(root);
        preview = family === "requirement"
          ? await service.previewRequirement(
              {
                title: request.title,
                designSurfaceId: request.designSurfaceId,
                documents: request.documents,
              },
              options.preview,
            )
          : await service.previewConfirmation(
              {
                title: request.title,
                designSurfaceId: request.designSurfaceId,
                documents: request.documents,
              },
              options.preview,
            );
      } catch (error: unknown) {
        if (error instanceof LedgerAuthorityPublicationPlanningServiceError) {
          fail("preview", error, "unchanged");
        }
        throw error;
      }
      result = publicResult(
        {
          kind: family === "requirement"
            ? "WakeflowRequirementPublicationPreviewResult"
            : "WakeflowConfirmationPublicationPreviewResult",
          schemaVersion:
            WAKEFLOW_LEDGER_AUTHORITY_PUBLICATION_PUBLIC_SCHEMA_VERSION,
          tool: family === "requirement"
            ? WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME
            : WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
          mode: "preview",
          status: "ready",
          plan: preview.plan,
          planDigest: preview.planDigest,
        },
        family,
        privateValues,
        publicationAuthority,
      );
    } else {
      if (containsPrivateText(request.plan, privateValues)) {
        fail("privacy", undefined, "unchanged");
      }
      const application = new LedgerAuthorityPublicationApplicationService(
        root,
      );
      let applied;
      try {
        applied = request.mode === "apply"
          ? await application.apply(
              request.plan,
              request.planDigest,
              options.apply,
            )
          : await application.recover(
              request.plan,
              request.planDigest,
              options.recover,
            );
      } catch (error: unknown) {
        if (error instanceof LedgerAuthorityPublicationApplicationServiceError) {
          publicationAuthority = error.publicationAuthority;
          fail(request.mode, error, publicationAuthority);
        }
        throw error;
      }
      assertApplicationResult(applied, family, request.mode);
      publicationAuthority = "current";
      result = publicResult(
        {
          kind: family === "requirement"
            ? request.mode === "apply"
              ? "WakeflowRequirementPublicationApplyResult"
              : "WakeflowRequirementPublicationRecoveryResult"
            : request.mode === "apply"
              ? "WakeflowConfirmationPublicationApplyResult"
              : "WakeflowConfirmationPublicationRecoveryResult",
          schemaVersion:
            WAKEFLOW_LEDGER_AUTHORITY_PUBLICATION_PUBLIC_SCHEMA_VERSION,
          tool: family === "requirement"
            ? WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME
            : WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
          mode: request.mode,
          status: "current",
          planDigest: applied.planDigest,
          publication: publicationReceipt(applied, family),
        },
        family,
        privateValues,
        publicationAuthority,
      );
    }
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityPublicationPublicCoordinatorError) {
      publicationAuthority = error.publicationAuthority;
    }
    failure = error;
  }
  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure = new LedgerAuthorityPublicationPublicCoordinatorError(
        "root",
        ownString(error, "code"),
        ownString(error, "reason"),
        publicationAuthority,
      );
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("output", undefined, publicationAuthority);
  return result;
}

/** 执行Requirement公共preview/apply/recover。 */
export async function executeRequirementPublicationPublicRequest(
  value: unknown,
  options: LedgerAuthorityPublicationPublicCoordinatorOptions = {},
): Promise<RequirementPublicationPublicResult> {
  const request = parseRequirementPublicationPublicRequest(value);
  return executePublicRequest(request, "requirement", options) as Promise<
    RequirementPublicationPublicResult
  >;
}

/** 执行Confirmation公共preview/apply/recover。 */
export async function executeConfirmationPublicationPublicRequest(
  value: unknown,
  options: LedgerAuthorityPublicationPublicCoordinatorOptions = {},
): Promise<ConfirmationPublicationPublicResult> {
  const request = parseConfirmationPublicationPublicRequest(value);
  return executePublicRequest(request, "confirmation", options) as Promise<
    ConfirmationPublicationPublicResult
  >;
}

export { LedgerAuthorityPublicationPublicContractError };
