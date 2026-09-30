import * as path from 'path';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { EVENT_SOURCE } from './workflow';

export interface EventWiringProps {
  readonly table: dynamodb.ITable;
  readonly bus: events.IEventBus;
  readonly stateMachine: sfn.IStateMachine;
  readonly demoFailures: boolean;
}

function deadLetterQueue(scope: Construct, id: string, queueName: string): sqs.Queue {
  return new sqs.Queue(scope, id, {
    queueName,
    encryption: sqs.QueueEncryption.SQS_MANAGED,
    enforceSSL: true,
    retentionPeriod: Duration.days(14),
    removalPolicy: RemovalPolicy.DESTROY,
  });
}

/**
 * Event-driven glue:
 *   DynamoDB Stream (INSERT) -> stream-publisher (TypeScript) -> EventBridge bus
 *   bus rule AccessRequested -> Step Functions      (retries, then DLQ)
 *   bus rule jit.access.*    -> CloudWatch Logs     (audit trail of every event)
 */
export class EventWiring extends Construct {
  readonly publisher: lambda.IFunction;
  readonly streamDlq: sqs.Queue;
  readonly eventsDlq: sqs.Queue;
  readonly startWorkflowRule: events.Rule;

  constructor(scope: Construct, id: string, props: EventWiringProps) {
    super(scope, id);

    this.streamDlq = deadLetterQueue(this, 'StreamDlq', 'jit-access-stream-dlq');
    this.eventsDlq = deadLetterQueue(this, 'EventsDlq', 'jit-access-events-dlq');

    const publisher = new NodejsFunction(this, 'StreamPublisher', {
      entry: path.join(__dirname, '..', 'lambdas', 'ts', 'stream-publisher', 'index.ts'),
      description: 'DynamoDB Stream -> EventBridge (AccessRequested)',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      logGroup: new logs.LogGroup(this, 'PublisherLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        EVENT_BUS_NAME: props.bus.eventBusName,
        POWERTOOLS_SERVICE_NAME: 'jit-access',
        DEMO_FAILURES: String(props.demoFailures),
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: { minify: true, sourceMap: true, format: OutputFormat.CJS, externalModules: [] },
    });
    props.bus.grantPutEventsTo(publisher);

    publisher.addEventSource(
      new DynamoEventSource(props.table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        // Only new requests. Status updates by the workflow don't need to re-enter the pipeline.
        filters: [lambda.FilterCriteria.filter({ eventName: lambda.FilterRule.isEqual('INSERT') })],
        reportBatchItemFailures: true, // retry only the failed records, not the whole batch
        bisectBatchOnError: true, // split a failing batch to isolate the poison record
        retryAttempts: 3,
        maxRecordAge: Duration.hours(1),
        onFailure: new SqsDlq(this.streamDlq), // after retries: record pointer goes to the DLQ
      }),
    );
    this.publisher = publisher;

    this.startWorkflowRule = new events.Rule(this, 'StartWorkflow', {
      eventBus: props.bus,
      description: 'New access request -> approval workflow',
      eventPattern: { source: [EVENT_SOURCE], detailType: ['AccessRequested'] },
      targets: [
        new targets.SfnStateMachine(props.stateMachine, {
          retryAttempts: 8,
          maxEventAge: Duration.hours(2),
          deadLetterQueue: this.eventsDlq,
        }),
      ],
    });

    new events.Rule(this, 'Audit', {
      eventBus: props.bus,
      description: 'Every JIT Access event -> audit log',
      eventPattern: { source: [EVENT_SOURCE] },
      targets: [
        new targets.CloudWatchLogGroup(
          new logs.LogGroup(this, 'AuditLogs', {
            logGroupName: '/aws/events/jit-access-audit',
            retention: logs.RetentionDays.THREE_MONTHS,
            removalPolicy: RemovalPolicy.DESTROY,
          }),
        ),
      ],
    });
  }
}
