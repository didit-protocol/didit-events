import type { ApiErrorCode,RequestContext } from "../contracts/event-model.ts";
export class ModelError extends Error {
  readonly status: number;
  constructor(readonly code: ApiErrorCode, message = code as string, readonly fields?: Record<string, string>, readonly context?: RequestContext, readonly retryAfterMs?: number) {
    super(message); this.name = "ModelError";
    this.status = ({ unauthenticated: 401, forbidden: 403, not_found: 404, context_changed: 409, idempotency_conflict: 409,
      capacity: 409, closed: 409, rate_limited: 429, provider_unavailable: 503, retained_data_expired: 410, budget: 503 } as Partial<Record<ApiErrorCode, number>>)[code] ?? 422;
  }
}
