import { equal, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  parseConfirmationPublicationPublicRequest,
  parseRequirementPublicationPublicRequest,
  LedgerAuthorityPublicationPublicContractError,
  WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_LEDGER_AUTHORITY_PUBLICATION_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
} from "../../../src/governance/ledger/ledger-authority-public-contract.js";
import { LedgerAuthorityPublicationPlanningService } from "../../../src/governance/ledger/ledger-authority-publication-planning-service.js";
import {
  cleanupLedgerAuthorityPublicationFixture,
  confirmationPublicationInput,
  createLedgerAuthorityPublicationFixture,
  ledgerAuthorityPublicationUuidFactory,
  requirementPublicationInput,
  CONFIRMATION_UUID,
  DEMAND_UUID,
  RECORDED_AT,
  REQUIREMENT_UUID,
} from "./ledger-authority-publication.fixture.js";

function expectContractError(
  action: () => unknown,
  reason: LedgerAuthorityPublicationPublicContractError["reason"],
): void {
  throws(
    action,
    (error: unknown) =>
      error instanceof LedgerAuthorityPublicationPublicContractError
      && error.reason === reason,
  );
}

test("Ledger Authority Public Contract保持双工具family隔离与共享防御边界", async (t) => {
  const fixture = await createLedgerAuthorityPublicationFixture();
  try {
    equal(
      WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
      "wakeflow_publish_requirement",
    );
    equal(
      WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
      "wakeflow_publish_confirmation",
    );
    equal(WAKEFLOW_LEDGER_AUTHORITY_PUBLICATION_PUBLIC_SCHEMA_VERSION, 1);

    await t.test("Preview requests become independent recursively frozen JSON", () => {
      const requirement = parseRequirementPublicationPublicRequest({
        root: fixture.workspacePath,
        mode: "preview",
        ...requirementPublicationInput(),
      });
      const confirmation = parseConfirmationPublicationPublicRequest({
        root: fixture.workspacePath,
        mode: "preview",
        ...confirmationPublicationInput(),
      });
      equal(requirement.mode, "preview");
      equal(confirmation.mode, "preview");
      equal(Object.isFrozen(requirement), true);
      equal(Object.isFrozen(requirement.documents), true);
      equal(Object.isFrozen(requirement.documents[0]), true);
      equal(Object.isFrozen(confirmation), true);
      equal(Object.hasOwn(requirement, "family"), false);
      equal(Object.hasOwn(confirmation, "demandId"), false);
    });

    const planning = new LedgerAuthorityPublicationPlanningService(
      fixture.workspaceRoot,
    );
    const requirement = await planning.previewRequirement(
      requirementPublicationInput(),
      {
        uuidFactory: ledgerAuthorityPublicationUuidFactory(
          [REQUIREMENT_UUID],
          { value: 0 },
        ),
        clock: () => RECORDED_AT,
      },
    );
    const confirmation = await planning.previewConfirmation(
      confirmationPublicationInput(),
      {
        uuidFactory: ledgerAuthorityPublicationUuidFactory(
          [CONFIRMATION_UUID, DEMAND_UUID],
          { value: 0 },
        ),
        clock: () => RECORDED_AT,
      },
    );

    await t.test("Apply and Recover reject a Plan from the other family", () => {
      for (const mode of ["apply", "recover"] as const) {
        const requirementRequest = {
          root: fixture.workspacePath,
          mode,
          plan: requirement.plan,
          planDigest: requirement.planDigest,
        };
        const confirmationRequest = {
          root: fixture.workspacePath,
          mode,
          plan: confirmation.plan,
          planDigest: confirmation.planDigest,
        };
        equal(
          parseRequirementPublicationPublicRequest(requirementRequest).mode,
          mode,
        );
        equal(
          parseConfirmationPublicationPublicRequest(confirmationRequest).mode,
          mode,
        );
        expectContractError(
          () => parseRequirementPublicationPublicRequest(confirmationRequest),
          "plan",
        );
        expectContractError(
          () => parseConfirmationPublicationPublicRequest(requirementRequest),
          "plan",
        );
      }
    });

    await t.test("Schema, Plan, and capacity errors stay distinct", () => {
      expectContractError(
        () => parseRequirementPublicationPublicRequest({
          root: fixture.workspacePath,
          mode: "preview",
          ...requirementPublicationInput(),
          family: "requirement",
        }),
        "schema",
      );
      expectContractError(
        () => parseRequirementPublicationPublicRequest({
          root: fixture.workspacePath,
          mode: "apply",
          plan: { unexpected: true },
          planDigest: requirement.planDigest,
        }),
        "plan",
      );
      expectContractError(
        () => parseRequirementPublicationPublicRequest({
          root: fixture.workspacePath,
          mode: "preview",
          ...requirementPublicationInput(),
          title: "x".repeat(2 * 1024 * 1024),
        }),
        "capacity",
      );
    });

    await t.test("Accessor input is rejected without execution", () => {
      const hostile = {
        root: fixture.workspacePath,
        mode: "preview",
        ...requirementPublicationInput(),
      };
      let getterCalls = 0;
      Object.defineProperty(hostile, "title", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "Unexpected";
        },
      });
      expectContractError(
        () => parseRequirementPublicationPublicRequest(hostile),
        "json",
      );
      equal(getterCalls, 0);
    });
  } finally {
    await cleanupLedgerAuthorityPublicationFixture(fixture);
  }
});
