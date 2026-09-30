import { Duration } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface ObservabilityProps {
  readonly httpApi: apigwv2.HttpApi;
  readonly functions: Record<string, lambda.IFunction>;
  readonly stateMachine: sfn.StateMachine;
  readonly deadLetterQueues: Record<string, sqs.IQueue>;
  readonly startWorkflowRule: events.IRule;
  readonly alarmEmail?: string;
}

/** Alarms for every failure boundary, plus one dashboard for the demo. */
export class Observability extends Construct {
  readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObservabilityProps) {
    super(scope, id);

    this.topic = new sns.Topic(this, 'Alarms', { topicName: 'jit-access-alarms', enforceSSL: true });
    if (props.alarmEmail) this.topic.addSubscription(new subs.EmailSubscription(props.alarmEmail));
    const notify = new actions.SnsAction(this.topic);

    const alarm = (name: string, metric: cloudwatch.IMetric, threshold: number, description: string) => {
      const a = new cloudwatch.Alarm(this, name, {
        alarmName: `jit-access-${name}`,
        alarmDescription: description,
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      a.addAlarmAction(notify);
      return a;
    };
    const fiveMin = { period: Duration.minutes(5), statistic: 'Sum' };

    alarm('api-5xx', props.httpApi.metricServerError(fiveMin), 5, 'API returned 5xx responses');

    for (const [name, fn] of Object.entries(props.functions)) {
      alarm(`${name}-errors`, fn.metricErrors(fiveMin), 1, `Lambda ${name} threw an unhandled error`);
    }

    alarm('workflow-failed', props.stateMachine.metricFailed(fiveMin), 1, 'Approval workflow ended in FAILED');

    for (const [name, queue] of Object.entries(props.deadLetterQueues)) {
      alarm(
        `${name}-not-empty`,
        queue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1), statistic: 'Maximum' }),
        1,
        `Messages in ${name}: events were not delivered. See runbook.`,
      );
    }

    const failedInvocations = new cloudwatch.Metric({
      namespace: 'AWS/Events',
      metricName: 'FailedInvocations',
      dimensionsMap: { RuleName: props.startWorkflowRule.ruleName, EventBusName: 'jit-access' },
      ...fiveMin,
    });
    alarm('eventbridge-target-failures', failedInvocations, 1, 'EventBridge could not start the workflow');

    // Security signal: repeated attempts to approve own or someone else's requests without rights.
    const forbidden = new cloudwatch.Metric({
      namespace: 'JitAccess',
      metricName: 'DecisionForbidden',
      dimensionsMap: { service: 'jit-access' },
      ...fiveMin,
    });
    alarm('forbidden-decisions', forbidden, 3, 'Repeated forbidden approval attempts (possible abuse)');

    const fns = Object.values(props.functions);
    new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'jit-access',
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'API requests and errors',
            left: [props.httpApi.metricCount(fiveMin), props.httpApi.metricClientError(fiveMin), props.httpApi.metricServerError(fiveMin)],
          }),
          new cloudwatch.GraphWidget({
            title: 'API latency p95 (ms)',
            left: [props.httpApi.metricLatency({ period: Duration.minutes(5), statistic: 'p95' })],
          }),
          new cloudwatch.GraphWidget({
            title: 'Workflow executions',
            left: [
              props.stateMachine.metricStarted(fiveMin),
              props.stateMachine.metricSucceeded(fiveMin),
              props.stateMachine.metricFailed(fiveMin),
              props.stateMachine.metricTimedOut(fiveMin),
            ],
          }),
        ],
        [
          new cloudwatch.GraphWidget({ title: 'Lambda errors', left: fns.map((f) => f.metricErrors(fiveMin)) }),
          new cloudwatch.GraphWidget({ title: 'Lambda throttles', left: fns.map((f) => f.metricThrottles(fiveMin)) }),
          new cloudwatch.GraphWidget({
            title: 'Dead-letter queues',
            left: Object.values(props.deadLetterQueues).map((q) =>
              q.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1), statistic: 'Maximum' }),
            ),
          }),
          new cloudwatch.GraphWidget({ title: 'Forbidden decisions', left: [forbidden] }),
        ],
      ],
    });
  }
}
