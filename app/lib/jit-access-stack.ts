import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Api } from './api';
import { EventWiring } from './events';
import { Identity } from './identity';
import { applyNagSuppressions } from './nag-suppressions';
import { Observability } from './observability';
import { powertoolsLayer } from './python-function';
import { Web } from './web';
import { Workflow } from './workflow';

export interface JitAccessStackProps extends StackProps {
  readonly approvalTimeoutMinutes: number;
  readonly demoFailures: boolean;
  readonly alarmEmail?: string;
}

const LOCAL_DEV_ORIGIN = 'http://localhost:5173';

export class JitAccessStack extends Stack {
  constructor(scope: Construct, id: string, props: JitAccessStackProps) {
    super(scope, id, props);

    // Contract with the Terraform platform layer: every IAM role in this stack carries its boundary.
    // CloudFormation resolves the SSM value at deploy time, so no ARN is hard-coded here.
    const boundaryArn = ssm.StringParameter.valueForStringParameter(this, '/jit/platform/permissions-boundary-arn');
    iam.PermissionsBoundary.of(this).apply(iam.ManagedPolicy.fromManagedPolicyArn(this, 'Boundary', boundaryArn));

    const table = new dynamodb.Table(this, 'Requests', {
      tableName: 'jit-access-requests',
      partitionKey: { name: 'requestId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.DESTROY, // demo environment: torn down between demos
    });
    // "My requests", newest first.
    table.addGlobalSecondaryIndex({
      indexName: 'byRequester',
      partitionKey: { name: 'requesterSub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });
    // Approval queue. Low-cardinality partition key is fine at this scale; shard it at high volume.
    table.addGlobalSecondaryIndex({
      indexName: 'byStatus',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    const bus = new events.EventBus(this, 'Bus', { eventBusName: 'jit-access' });
    // Keep a replayable copy of every event: after an incident, fix the consumer and replay.
    bus.archive('Archive', {
      archiveName: 'jit-access-archive',
      eventPattern: { source: ['jit.access'] },
      retention: Duration.days(7),
    });

    const powertools = powertoolsLayer(this);

    const web = new Web(this, 'Web');
    const appOrigins = [web.url, web.cloudFrontUrl, LOCAL_DEV_ORIGIN];
    const identity = new Identity(this, 'Identity', { appOrigins });

    const workflow = new Workflow(this, 'Workflow', {
      table,
      bus,
      powertools,
      approvalTimeout: Duration.minutes(props.approvalTimeoutMinutes),
      demoFailures: props.demoFailures,
    });

    const wiring = new EventWiring(this, 'Events', {
      table,
      bus,
      stateMachine: workflow.stateMachine,
      demoFailures: props.demoFailures,
    });

    const api = new Api(this, 'Api', {
      identity,
      table,
      stateMachine: workflow.stateMachine,
      powertools,
      allowedOrigins: appOrigins,
      consoleIssuer: web.url,
    });

    web.deploy({
      region: this.region,
      apiUrl: api.url,
      userPoolId: identity.userPool.userPoolId,
      clientId: identity.client.userPoolClientId,
      cognitoDomain: identity.domainUrl,
      issuer: identity.issuerUrl,
    });

    new Observability(this, 'Observability', {
      httpApi: api.httpApi,
      functions: {
        ...api.functions,
        'validate-request': workflow.functions[0],
        'register-approval': workflow.functions[1],
        'revoke-sessions': workflow.functions[2],
        'stream-publisher': wiring.publisher,
      },
      stateMachine: workflow.stateMachine,
      deadLetterQueues: { 'stream-dlq': wiring.streamDlq, 'events-dlq': wiring.eventsDlq },
      startWorkflowRule: wiring.startWorkflowRule,
      alarmEmail: props.alarmEmail,
    });

    new CfnOutput(this, 'WebUrl', { value: web.url });
    new CfnOutput(this, 'CloudFrontDomain', { value: web.distribution.distributionDomainName });
    new CfnOutput(this, 'ApiUrl', { value: api.url });
    new CfnOutput(this, 'UserPoolId', { value: identity.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: identity.client.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', { value: identity.domainUrl });
    new CfnOutput(this, 'StateMachineArn', { value: workflow.stateMachine.stateMachineArn });

    applyNagSuppressions(this);
  }
}
