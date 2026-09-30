/**
 * DynamoDB Stream -> EventBridge. Turns each new request (INSERT) into an AccessRequested event.
 *
 * The producer (the table) knows nothing about consumers: anything interested subscribes with an
 * EventBridge rule. Failures are reported per record (partial batch response), so one bad record
 * is retried or sent to the DLQ on its own without blocking the rest of the shard.
 */
import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import { Logger } from '@aws-lambda-powertools/logger';
import { EventBridgeClient, PutEventsCommand, type PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBRecord, DynamoDBStreamHandler } from 'aws-lambda';

export const EVENT_SOURCE = 'jit.access';

const logger = new Logger();
const processor = new BatchProcessor(EventType.DynamoDBStreams);
const eventBridge = new EventBridgeClient({});

export interface AccessRequest {
  requestId: string;
  requesterSub: string;
  requesterUsername: string;
  role: string;
  durationMinutes: number;
  reason: string;
  createdAt: string;
  correlationId: string;
}

export function toAccessRequestedEvent(item: AccessRequest, busName: string): PutEventsRequestEntry {
  return {
    EventBusName: busName,
    Source: EVENT_SOURCE,
    DetailType: 'AccessRequested',
    Detail: JSON.stringify({
      requestId: item.requestId,
      requesterSub: item.requesterSub,
      requesterUsername: item.requesterUsername,
      role: item.role,
      durationMinutes: item.durationMinutes,
      reason: item.reason,
      createdAt: item.createdAt,
      correlationId: item.correlationId,
    }),
  };
}

async function publishRecord(record: DynamoDBRecord): Promise<void> {
  const image = record.dynamodb?.NewImage;
  if (!image) throw new Error(`record ${record.eventID} has no NewImage`);
  const item = unmarshall(image as Parameters<typeof unmarshall>[0]) as AccessRequest;

  // Failure scenario for the demo: a "poison" record that always fails.
  if (process.env.DEMO_FAILURES === 'true' && item.reason.includes('#poison')) {
    throw new Error(`demo: poison record ${item.requestId}`);
  }

  const result = await eventBridge.send(
    new PutEventsCommand({ Entries: [toAccessRequestedEvent(item, process.env.EVENT_BUS_NAME!)] }),
  );
  // PutEvents can succeed as a call but fail per entry, so check it explicitly.
  if (result.FailedEntryCount) {
    throw new Error(`PutEvents rejected ${item.requestId}: ${result.Entries?.[0]?.ErrorCode}`);
  }
  logger.info('published AccessRequested', { requestId: item.requestId, correlationId: item.correlationId });
}

export const handler: DynamoDBStreamHandler = async (event, context) =>
  processPartialResponse(event, publishRecord, processor, { context });
