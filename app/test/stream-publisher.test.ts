import { toAccessRequestedEvent, type AccessRequest } from '../lambdas/ts/stream-publisher';

const item: AccessRequest = {
  requestId: 'r-1',
  requesterSub: 'sub-alice',
  requesterUsername: 'alice',
  role: 'prod-logs-read',
  durationMinutes: 60,
  reason: 'INC-42',
  createdAt: '2026-10-01T09:00:00Z',
  correlationId: 'corr-1',
};

test('maps a request item to an AccessRequested event on the given bus', () => {
  const entry = toAccessRequestedEvent(item, 'jit-access');
  expect(entry).toMatchObject({ EventBusName: 'jit-access', Source: 'jit.access', DetailType: 'AccessRequested' });
  expect(JSON.parse(entry.Detail!)).toEqual(item);
});

test('never forwards fields outside the event schema (e.g. task tokens)', () => {
  const entry = toAccessRequestedEvent({ ...item, taskToken: 'secret' } as AccessRequest, 'jit-access');
  expect(entry.Detail).not.toContain('secret');
});
