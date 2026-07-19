/**
 * The frozen competition incident is a deterministic seeded replay produced by
 * scripts/demo-reset.mjs. The banner keeps sanitized demo data visually
 * distinct from live provider (GitHub/OpenAI) execution. Override only when
 * the frozen incident id changes; never point this at a real tenant incident.
 */
export const DEMO_REPLAY_INCIDENT_ID =
  process.env.NEXT_PUBLIC_CODEER_DEMO_INCIDENT_ID ?? '00000000-0000-4000-8000-000000290004';

export function isSeededReplayIncident(incidentId: string): boolean {
  return incidentId === DEMO_REPLAY_INCIDENT_ID;
}
