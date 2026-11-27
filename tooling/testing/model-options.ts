/** Bounded, reproducible pure-model inputs; these never enable runtime fault injection. */
export function modelTestOptions(environment: Readonly<Record<string, string | undefined>>) {
  const seedText = environment.WAKEFLOW_MODEL_SEED ?? "20261003";
  const runsText = environment.WAKEFLOW_MODEL_RUNS ?? "200";
  const path = environment.WAKEFLOW_MODEL_PATH;
  const replayPath = environment.WAKEFLOW_MODEL_REPLAY_PATH;
  const seed = Number(seedText);
  const numRuns = Number(runsText);
  if (
    !/^-?\d+$/u.test(seedText) ||
    !Number.isInteger(seed) ||
    seed < -2147483648 ||
    seed > 2147483647 ||
    !/^\d+$/u.test(runsText) ||
    !Number.isInteger(numRuns) ||
    numRuns < 1 ||
    numRuns > 1000 ||
    (path !== undefined && (path.length > 512 || !/^\d+(?::\d+)*$/u.test(path))) ||
    (replayPath !== undefined &&
      (replayPath.length > 1024 || !/^[A-Za-z0-9+/]*:[A-Za-z0-9+/]*$/u.test(replayPath)))
  )
    throw new Error("Invalid bounded model test options.");
  return {
    seed,
    numRuns,
    ...(path === undefined ? {} : { path }),
    ...(replayPath === undefined ? {} : { replayPath }),
  };
}
