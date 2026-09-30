import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { PythonFunction } from './python-function';

export interface WorkflowProps {
  readonly table: dynamodb.ITable;
  readonly bus: events.IEventBus;
  readonly powertools: lambda.ILayerVersion;
  readonly approvalTimeout: Duration;
  readonly demoFailures: boolean;
}

export const EVENT_SOURCE = 'jit.access';

/**
 * The approval workflow. After a request is created, this is the ONLY writer of its status:
 *   Validate -> WaitForApproval (task token) -> Grant -> Wait until expiry -> Revoke
 * with branches for policy rejection, human rejection, approval timeout and failures.
 */
export class Workflow extends Construct {
  readonly stateMachine: sfn.StateMachine;
  readonly functions: lambda.IFunction[];

  constructor(scope: Construct, id: string, props: WorkflowProps) {
    super(scope, id);
    const { table, bus } = props;

    const validateFn = new PythonFunction(this, 'Validate', {
      handler: 'handlers.validate_request.handler',
      description: 'Workflow: apply access policy to a request',
      powertools: props.powertools,
      environment: { DEMO_FAILURES: String(props.demoFailures) },
    }).fn;

    const registerFn = new PythonFunction(this, 'RegisterApproval', {
      handler: 'handlers.register_approval.handler',
      description: 'Workflow: store the task token and mark the request AWAITING_APPROVAL',
      powertools: props.powertools,
      environment: { TABLE_NAME: table.tableName },
    }).fn;
    table.grant(registerFn, 'dynamodb:UpdateItem');
    this.functions = [validateFn, registerFn];

    // ---- helpers ------------------------------------------------------------------------
    const at = (p: string) => sfn.JsonPath.stringAt(p);
    const str = (v: string) => tasks.DynamoAttributeValue.fromString(v);
    const now = str(at('$$.State.EnteredTime'));
    const base = {
      requestId: at('$.request.requestId'),
      requesterSub: at('$.request.requesterSub'),
      requesterUsername: at('$.request.requesterUsername'),
      role: at('$.request.role'),
      correlationId: at('$.request.correlationId'),
    };

    const update = (
      name: string,
      expr: { update: string; condition?: string; values: Record<string, tasks.DynamoAttributeValue> },
    ) => {
      const task = new tasks.DynamoUpdateItem(this, name, {
        table,
        key: { requestId: str(at('$.request.requestId')) },
        updateExpression: expr.update,
        conditionExpression: expr.condition,
        expressionAttributeNames: { '#s': 'status' },
        expressionAttributeValues: expr.values,
        resultPath: sfn.JsonPath.DISCARD,
      });
      // Throttling and transient DynamoDB errors: back off and retry before failing the request.
      task.addRetry({
        errors: [
          'DynamoDB.ProvisionedThroughputExceededException',
          'DynamoDB.RequestLimitExceeded',
          'DynamoDB.ThrottlingException',
          'DynamoDB.InternalServerErrorException',
        ],
        interval: Duration.seconds(1),
        maxAttempts: 4,
        backoffRate: 2,
        jitterStrategy: sfn.JitterType.FULL,
      });
      return task;
    };

    const publish = (name: string, detailType: string, detail: Record<string, unknown>) =>
      new tasks.EventBridgePutEvents(this, name, {
        entries: [{ eventBus: bus, source: EVENT_SOURCE, detailType, detail: sfn.TaskInput.fromObject({ ...base, ...detail }) }],
        resultPath: sfn.JsonPath.DISCARD,
      });

    // ---- terminal states ----------------------------------------------------------------
    const done = new sfn.Succeed(this, 'Done');
    const duplicate = new sfn.Succeed(this, 'DuplicateIgnored', {
      comment: 'Another execution already owns this request (duplicate event)',
    });
    const failed = new sfn.Fail(this, 'WorkflowFailed', { errorPath: '$.error.Error', causePath: '$.error.Cause' });

    // ---- failure / timeout / rejection paths --------------------------------------------
    const markFailed = update('MarkFailed', {
      update: 'SET #s = :failed, failureError = :err, updatedAt = :now REMOVE taskToken',
      values: { ':failed': str('FAILED'), ':err': str(at('$.error.Error')), ':now': now },
    });
    markFailed.next(publish('PublishFailed', 'AccessFailed', { error: at('$.error.Error') })).next(failed);
    const onError = { resultPath: '$.error' };

    const markExpired = update('MarkExpired', {
      update: 'SET #s = :expired, updatedAt = :now REMOVE taskToken',
      condition: '#s = :awaiting',
      values: { ':expired': str('EXPIRED'), ':awaiting': str('AWAITING_APPROVAL'), ':now': now },
    });
    markExpired.addCatch(markFailed, onError);
    markExpired.next(publish('PublishExpired', 'AccessExpired', {})).next(done);

    const autoReject = update('AutoReject', {
      update: 'SET #s = :rejected, decidedBy = :policy, decisionComment = :why, updatedAt = :now',
      condition: '#s = :pending',
      values: {
        ':rejected': str('REJECTED'),
        ':policy': str('policy'),
        ':why': str(at('$.validation.explanation')),
        ':pending': str('PENDING'),
        ':now': now,
      },
    });
    autoReject.addCatch(duplicate, { errors: ['DynamoDB.ConditionalCheckFailedException'], ...onError });
    autoReject.addCatch(markFailed, onError);
    autoReject
      .next(publish('PublishPolicyRejected', 'AccessRejected', { decidedBy: 'policy', comment: at('$.validation.explanation') }))
      .next(done);

    const decisionValues = {
      ':by': str(at('$.decision.approverSub')),
      ':byName': str(at('$.decision.approverUsername')),
      ':decidedAt': str(at('$.decision.decidedAt')),
      ':comment': str(at('$.decision.comment')),
      ':awaiting': str('AWAITING_APPROVAL'),
      ':now': now,
    };

    const markRejected = update('MarkRejected', {
      update:
        'SET #s = :rejected, approverSub = :by, approverUsername = :byName, decidedAt = :decidedAt, ' +
        'decisionComment = :comment, updatedAt = :now REMOVE taskToken',
      condition: '#s = :awaiting',
      values: { ...decisionValues, ':rejected': str('REJECTED') },
    });
    markRejected.addCatch(markFailed, onError);
    markRejected
      .next(publish('PublishRejected', 'AccessRejected', { decidedBy: at('$.decision.approverUsername'), comment: at('$.decision.comment') }))
      .next(done);

    // ---- happy path: grant, wait, revoke ------------------------------------------------
    const grant = update('Grant', {
      update:
        'SET #s = :granted, approverSub = :by, approverUsername = :byName, decidedAt = :decidedAt, ' +
        'expiresAt = :expiresAt, decisionComment = :comment, updatedAt = :now REMOVE taskToken',
      condition: '#s = :awaiting',
      values: { ...decisionValues, ':granted': str('GRANTED'), ':expiresAt': str(at('$.decision.expiresAt')) },
    });
    grant.addCatch(markFailed, onError);

    const revoke = update('Revoke', {
      update: 'SET #s = :revoked, revokedAt = :now, updatedAt = :now',
      condition: '#s = :granted',
      values: { ':revoked': str('REVOKED'), ':granted': str('GRANTED'), ':now': now },
    });
    revoke.addCatch(markFailed, onError);

    grant
      .next(publish('PublishGranted', 'AccessGranted', {
        approverUsername: at('$.decision.approverUsername'),
        expiresAt: at('$.decision.expiresAt'),
      }))
      // A Wait state, not DynamoDB TTL: TTL deletes are best-effort and can lag, revocation can't.
      .next(new sfn.Wait(this, 'WaitUntilExpiry', { time: sfn.WaitTime.timestampPath('$.decision.expiresAt') }))
      .next(revoke)
      .next(publish('PublishRevoked', 'AccessRevoked', {}))
      .next(done);

    // ---- approval (callback pattern) ----------------------------------------------------
    const waitForApproval = new tasks.LambdaInvoke(this, 'WaitForApproval', {
      lambdaFunction: registerFn,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        taskToken: sfn.JsonPath.taskToken,
        requestId: at('$.request.requestId'),
        executionArn: at('$$.Execution.Id'),
        correlationId: at('$.request.correlationId'),
      }),
      taskTimeout: sfn.Timeout.duration(props.approvalTimeout),
      resultPath: '$.decision',
    });
    waitForApproval.addCatch(duplicate, { errors: ['DuplicateExecutionError'], ...onError });
    waitForApproval.addCatch(markExpired, { errors: ['States.Timeout'], ...onError });
    waitForApproval.addCatch(markFailed, onError);
    waitForApproval.next(
      new sfn.Choice(this, 'Approved?')
        .when(sfn.Condition.stringEquals('$.decision.decision', 'APPROVED'), grant)
        .otherwise(markRejected),
    );

    // ---- entry: read the EventBridge event, validate against policy ----------------------
    const validate = new tasks.LambdaInvoke(this, 'ValidatePolicy', {
      lambdaFunction: validateFn,
      payload: sfn.TaskInput.fromObject({
        requestId: at('$.request.requestId'),
        role: at('$.request.role'),
        durationMinutes: sfn.JsonPath.numberAt('$.request.durationMinutes'),
        reason: at('$.request.reason'),
        correlationId: at('$.request.correlationId'),
      }),
      resultSelector: { 'allowed.$': '$.Payload.allowed', 'explanation.$': '$.Payload.explanation' },
      resultPath: '$.validation',
    });
    validate.addRetry({ errors: ['States.TaskFailed'], interval: Duration.seconds(2), maxAttempts: 2, backoffRate: 2 });
    validate.addCatch(markFailed, onError);

    const definition = new sfn.Pass(this, 'ReadRequest', { parameters: { 'request.$': '$.detail' } })
      .next(validate)
      .next(
        new sfn.Choice(this, 'PolicyAllows?')
          .when(sfn.Condition.booleanEquals('$.validation.allowed', true), waitForApproval)
          .otherwise(autoReject),
      );

    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: '/aws/vendedlogs/states/jit-access-approval',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      stateMachineName: 'jit-access-approval',
      stateMachineType: sfn.StateMachineType.STANDARD, // long waits (hours) and exactly-once steps
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(6),
      tracingEnabled: true,
      // Execution data is left out of logs on purpose: it contains task tokens and free-text reasons.
      logs: { destination: logGroup, level: sfn.LogLevel.ALL, includeExecutionData: false },
    });
  }
}
