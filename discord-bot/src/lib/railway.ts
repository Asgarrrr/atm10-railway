// ── Railway GraphQL API client ─────────────────────────────────────────────────
//
// Wraps the Railway v2 GraphQL API for service lifecycle management.
// All functions require a RailwayConfig — if the caller does not have one
// (env vars missing), it should skip the call gracefully rather than throw.

const RAILWAY_API_URL = "https://backboard.railway.com/graphql/v2";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RailwayConfig {
  /** Personal or project API token from railway.com/account/tokens */
  token: string;
  /** UUID of the target service (visible in the Railway dashboard URL) */
  serviceId: string;
  /** UUID of the target environment (e.g. the "production" environment UUID) */
  environmentId: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

// ── Core GraphQL helper ────────────────────────────────────────────────────────

async function gql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(RAILWAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable body)");
    throw new Error(`Railway API HTTP ${res.status}: ${body}`);
  }

  const json = (await res.json()) as GraphQLResponse<T>;

  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message).join("; ");
    throw new Error(`Railway API error: ${messages}`);
  }

  if (json.data === undefined || json.data === null) {
    throw new Error("Railway API returned a response with no data field");
  }

  return json.data;
}

// ── Mutations ──────────────────────────────────────────────────────────────────

/**
 * Trigger a redeploy of the given service instance.
 *
 * Equivalent to clicking "Restart" / "Redeploy" in the Railway dashboard.
 * Use this to start a service that was stopped via `stopService()`, or to
 * pick up the latest image after a new build.
 */
const REDEPLOY_MUTATION = /* graphql */ `
  mutation serviceInstanceRedeploy($serviceId: String!, $environmentId: String!) {
    serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
  }
`;

/**
 * Update a service instance's configuration.
 *
 * Used internally by `stopService()` to set numReplicas = 0, which keeps the
 * container stopped even with Railway's restart-on-failure policy.
 */
const UPDATE_INSTANCE_MUTATION = /* graphql */ `
  mutation serviceInstanceUpdate(
    $serviceId: String!
    $environmentId: String!
    $input: ServiceInstanceUpdateInput!
  ) {
    serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
  }
`;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Start or restart the Minecraft service by triggering a Railway redeploy.
 *
 * Works whether the service is currently stopped (replicas = 0) or already
 * running. Railway will pull the current image and boot a fresh container.
 *
 * @throws if the API call fails — callers should handle this gracefully.
 */
export async function restartService(cfg: RailwayConfig): Promise<void> {
  await gql<{ serviceInstanceRedeploy: boolean }>(
    cfg.token,
    REDEPLOY_MUTATION,
    { serviceId: cfg.serviceId, environmentId: cfg.environmentId },
  );
}

/**
 * Start the Minecraft service by restoring its replica count to 1 then
 * triggering a redeploy.
 *
 * Must be used instead of `restartService()` when the service was stopped via
 * `stopService()` (numReplicas = 0), because `serviceInstanceRedeploy` only
 * redeploys existing instances — with 0 replicas it is a no-op.
 *
 * @throws if the API call fails — callers should handle this gracefully.
 */
export async function startService(cfg: RailwayConfig): Promise<void> {
  await gql<{ serviceInstanceUpdate: boolean }>(
    cfg.token,
    UPDATE_INSTANCE_MUTATION,
    {
      serviceId:     cfg.serviceId,
      environmentId: cfg.environmentId,
      input:         { numReplicas: 1 },
    },
  );
}

/**
 * Stop the Minecraft service by setting its replica count to 0.
 *
 * With Railway's `ON_FAILURE` restart policy, this keeps the service stopped
 * until `startService()` is explicitly called. Without this call, a clean
 * RCON `stop` (exit code 0) would not trigger an automatic restart anyway,
 * but calling this ensures Railway's dashboard reflects the "stopped" state.
 *
 * @throws if the API call fails — callers should handle this gracefully.
 */
export async function stopService(cfg: RailwayConfig): Promise<void> {
  await gql<{ serviceInstanceUpdate: boolean }>(
    cfg.token,
    UPDATE_INSTANCE_MUTATION,
    {
      serviceId:     cfg.serviceId,
      environmentId: cfg.environmentId,
      input:         { numReplicas: 0 },
    },
  );
}
