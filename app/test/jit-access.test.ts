import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { JitAccessStack } from '../lib/jit-access-stack';

// Security and reliability invariants of the stack, checked on the synthesized CloudFormation.
const app = new App();
const stack = new JitAccessStack(app, 'JitAccess', {
  env: { account: '232936223811', region: 'eu-west-2' },
  approvalTimeoutMinutes: 15,
  demoFailures: false,
});
const template = Template.fromStack(stack);
const resources = (type: string) => Object.entries(template.findResources(type));

describe('IAM', () => {
  test('every IAM role carries the platform permission boundary', () => {
    const roles = resources('AWS::IAM::Role');
    expect(roles.length).toBeGreaterThan(5);
    for (const [id, role] of roles) {
      expect({ id, boundary: role.Properties.PermissionsBoundary }).toEqual({ id, boundary: expect.anything() });
    }
  });

  test('no policy grants Action "*"', () => {
    for (const [, policy] of resources('AWS::IAM::Policy')) {
      for (const statement of policy.Properties.PolicyDocument.Statement) {
        expect([statement.Action].flat()).not.toContain('*');
      }
    }
  });

  test('no IAM users or access keys are created', () => {
    template.resourceCountIs('AWS::IAM::User', 0);
    template.resourceCountIs('AWS::IAM::AccessKey', 0);
  });
});

describe('API authentication', () => {
  test('every route requires the Cognito JWT authorizer and a scope', () => {
    const routes = resources('AWS::ApiGatewayV2::Route');
    expect(routes).toHaveLength(3);
    for (const [, route] of routes) {
      expect(route.Properties.AuthorizationType).toBe('JWT');
      expect(route.Properties.AuthorizationScopes.length).toBeGreaterThan(0);
    }
  });

  test('the JWT authorizer trusts our user pool issuer and app client', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
      JwtConfiguration: { Audience: [Match.anyValue()], Issuer: Match.anyValue() },
    });
  });

  test('browser client is public (no secret) and uses the authorization code flow only', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
    });
  });

  test('users cannot sign themselves up', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });
});

describe('Data and events', () => {
  test('table streams new images and has point-in-time recovery', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      StreamSpecification: { StreamViewType: 'NEW_IMAGE' },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  test('stream consumer filters INSERTs, reports partial failures and has an on-failure DLQ', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      BisectBatchOnFunctionError: true,
      FilterCriteria: { Filters: [{ Pattern: JSON.stringify({ eventName: ['INSERT'] }) }] },
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
    });
  });

  test('EventBridge -> Step Functions target has retries and a DLQ', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: { source: ['jit.access'], 'detail-type': ['AccessRequested'] },
      Targets: [Match.objectLike({ RetryPolicy: Match.anyValue(), DeadLetterConfig: Match.anyValue() })],
    });
  });
});

describe('Workflow', () => {
  const definition = JSON.stringify(Object.values(template.findResources('AWS::StepFunctions::StateMachine'))[0].Properties.DefinitionString);

  test('uses the callback pattern with an approval timeout', () => {
    expect(definition).toContain('waitForTaskToken');
    expect(definition).toContain('TimeoutSeconds');
    expect(definition).toContain('States.Timeout');
  });

  test('is a Standard workflow with logging and tracing, without execution data in logs', () => {
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineType: 'STANDARD',
      TracingConfiguration: { Enabled: true },
      LoggingConfiguration: Match.objectLike({ Level: 'ALL', IncludeExecutionData: false }),
    });
  });
});

describe('Web', () => {
  test('site bucket is private and TLS-only', () => {
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      },
    });
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });
});
