// Typed runtime input keys for app code.
// VarKey and SecretKey are string literal union types, not values or config storage.
// Add a key here before using vars.get("KEY") or secret.get("KEY") in code.
// Values still come from .env.local in local dev and remote vars/secrets in deployed envs.

export type VarKey = never;

// To relay online matches for players behind strict NATs, add
// "TURN_KEY_ID" | "TURN_KEY_API_TOKEN" (Cloudflare Realtime TURN) here,
// set them with `edgespark secret set`, and restore the TURN lookup in
// GET /api/public/ice.
export type SecretKey = never;
