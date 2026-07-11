import { AsyncLocalStorage } from "node:async_hooks";

const callerStorage = new AsyncLocalStorage();

export function runWithMcpCaller(caller, callback) {
  return callerStorage.run(caller?.enforced ? caller : null, callback);
}

export function currentMcpCaller() {
  return callerStorage.getStore() || null;
}
