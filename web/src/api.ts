export interface AccessRequest {
  requestId: string;
  requesterUsername: string;
  requesterSub: string;
  role: string;
  durationMinutes: number;
  reason: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  approverUsername?: string;
  decidedBy?: string;
  decisionComment?: string;
  expiresAt?: string;
  revokedAt?: string;
  failureError?: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class Api {
  constructor(private readonly baseUrl: string, private readonly accessToken: () => string) {}

  private async call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.accessToken()}`, // the ACCESS token, never the ID token
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.message ?? res.statusText);
    return data as T;
  }

  create(body: { role: string; durationMinutes: number; reason: string }, idempotencyKey: string) {
    return this.call<AccessRequest>('POST', '/requests', body, { 'idempotency-key': idempotencyKey });
  }

  list(view: 'mine' | 'pending') {
    return this.call<{ items: AccessRequest[] }>('GET', `/requests?view=${view}`).then((r) => r.items);
  }

  /** A one-time sign-in URL for a real, time-limited AWS console session (only while GRANTED). */
  startSession(requestId: string) {
    return this.call<{ consoleUrl: string; role: string; sessionExpiresAt: string; grantExpiresAt: string }>(
      'POST',
      `/requests/${encodeURIComponent(requestId)}/session`,
    );
  }

  decide(requestId: string, decision: 'APPROVED' | 'REJECTED', comment: string) {
    return this.call<{ requestId: string }>('POST', `/requests/${encodeURIComponent(requestId)}/decision`, {
      decision,
      comment,
    });
  }
}
