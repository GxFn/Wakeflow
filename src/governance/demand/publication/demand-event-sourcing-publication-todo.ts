import type {
  StoredTodoCollectionItem,
  TodoCollectionAuthoritySnapshot,
} from "../../todo/todo-collection-authority.js";
import {
  claimTodoItem,
  inspectTodoItems,
  recoverTodoItemTransaction,
  TodoCollectionServiceError,
} from "../../todo/todo-collection-service.js";
import { parseTodoIntakeLineageReference } from "../../todo/todo-intake-lineage.js";
import type { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import type { DemandEventSourcingPublicationTransaction } from "./demand-event-sourcing-publication-transaction.js";
import {
  failDemandEventSourcingPublication as fail,
  type DemandEventSourcingPublicationTodoResult,
} from "./demand-event-sourcing-publication-contract.js";

/** Demand 发布与 TODO 权威事实之间的精确前序状态和挂载关系验证。 */

export async function inspectTodoForDemandPublication(
  root: RootedDirectory,
  todoId: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<TodoCollectionAuthoritySnapshot>> {
  try {
    return await inspectTodoItems(root, signal);
  } catch (error: unknown) {
    if (
      error instanceof TodoCollectionServiceError
      && error.reason === "recovery-required"
    ) {
      try {
        return (await recoverTodoItemTransaction(
          root,
          todoId,
          signal === undefined ? undefined : { signal },
        )).snapshot;
      } catch {
        fail("recovery-required", "$todo/transaction");
      }
    }
    if (error instanceof TodoCollectionServiceError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("conflict", "$todo");
    }
    throw error;
  }
}

export function exactClaimedTodoItem(
  snapshot: Readonly<TodoCollectionAuthoritySnapshot>,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
): Readonly<StoredTodoCollectionItem> | null {
  const item = snapshot.items.find(
    (candidate) => candidate.todoId === transaction.todoId,
  );
  if (
    item?.state.status !== "claimed"
    || item.state.mount === null
    || item.state.previousStateDigest !== transaction.expectedTodoStateDigest
    || item.intakeSource.resourcePath !== transaction.identity.source.intakeRef
    || item.intakeDigest !== transaction.identity.source.intakeDigest
    || item.state.mount.demandId !== transaction.demandId
    || item.state.mount.stateRootRef !== transaction.finalRootRef
    || item.state.mount.identityDigest !== transaction.identityDigest
  ) {
    return null;
  }
  return item;
}

export function assertPendingTodoItem(
  snapshot: Readonly<TodoCollectionAuthoritySnapshot>,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
): Readonly<StoredTodoCollectionItem> {
  const item = snapshot.items.find(
    (candidate) => candidate.todoId === transaction.todoId,
  );
  if (item === undefined) fail("todo-not-found", "$todo");
  if (
    item.state.status !== "pending-claim"
    || item.intakeSource.resourcePath !== transaction.identity.source.intakeRef
    || item.intakeDigest !== transaction.identity.source.intakeDigest
    || item.stateDigest !== transaction.expectedTodoStateDigest
  ) {
    fail("cas-mismatch", "$todo");
  }
  return item;
}

export function demandPublicationTodoResult(
  snapshot: Readonly<TodoCollectionAuthoritySnapshot>,
  item: Readonly<StoredTodoCollectionItem>,
): Readonly<DemandEventSourcingPublicationTodoResult> {
  return Object.freeze({
    item,
    lineageRef: parseTodoIntakeLineageReference({
      artifactKind: "wakeflow-todo-intake-lineage",
      schemaVersion: 1,
      todoId: item.todoId,
      intakeRef: item.intakeSource.resourcePath,
      intakeDigest: item.intakeDigest,
    }),
    snapshot,
  });
}

export async function claimTodoForDemandPublication(
  root: RootedDirectory,
  transaction: Readonly<DemandEventSourcingPublicationTransaction>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventSourcingPublicationTodoResult>> {
  const before = await inspectTodoForDemandPublication(
    root,
    transaction.todoId,
    signal,
  );
  const claimed = exactClaimedTodoItem(before, transaction);
  if (claimed !== null) return demandPublicationTodoResult(before, claimed);
  const pending = assertPendingTodoItem(before, transaction);
  try {
    const result = await claimTodoItem(root, {
      todoId: transaction.todoId,
      intakeDigest: pending.intakeDigest,
      stateDigest: pending.stateDigest,
      mount: {
        demandId: transaction.demandId,
        stateRootRef: transaction.finalRootRef,
        identityDigest: transaction.identityDigest,
      },
    }, {
      clock: () => transaction.initialCommand.recordedAt,
      ...(signal === undefined ? {} : { signal }),
    });
    return Object.freeze({
      item: result.item,
      lineageRef: result.lineageRef,
      snapshot: result.snapshot,
    });
  } catch (error: unknown) {
    if (error instanceof TodoCollectionServiceError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "lock-timeout") fail("lock-timeout", "$todo/lock");
      if (error.reason === "cas-mismatch") fail("cas-mismatch", "$todo");
      fail("conflict", "$todo");
    }
    throw error;
  }
}
