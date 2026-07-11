export function verifiedActorEventFields(defaultActor) {
  const actorWindow = String(process.env.WAKEFLOW_VERIFIED_ACTOR_WINDOW || "").trim();
  const actorRole = String(process.env.WAKEFLOW_VERIFIED_ACTOR_ROLE || "").trim();
  if (!actorWindow) return { actor: defaultActor };
  return {
    actor: defaultActor,
    actorWindow,
    ...(actorRole ? { actorRole } : {}),
    actorVerified: true,
  };
}
