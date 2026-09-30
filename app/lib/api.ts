import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import { Identity } from './identity';
import { PythonFunction } from './python-function';

export interface ApiProps {
  readonly identity: Identity;
  readonly table: dynamodb.ITable;
  readonly stateMachine: sfn.IStateMachine;
  readonly powertools: lambda.ILayerVersion;
  readonly allowedOrigins: string[];
}

/**
 * HTTP API. Authentication happens HERE: the JWT authorizer checks signature (JWKS), issuer,
 * client_id, expiry and the route's scope before any Lambda runs. Authorization (who may do what
 * to which request) happens inside the Lambdas.
 */
export class Api extends Construct {
  readonly httpApi: apigwv2.HttpApi;
  readonly url: string;
  readonly functions: lambda.IFunction[];

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);
    const { table } = props;
    const env = { TABLE_NAME: table.tableName };
    const fn = (name: string, handler: string, description: string, extra: Record<string, string> = {}) =>
      new PythonFunction(this, name, {
        handler,
        description,
        powertools: props.powertools,
        environment: { ...env, ...extra },
      }).fn;

    // One function and one role per route: each gets only the permissions its route needs.
    const createFn = fn('CreateRequest', 'handlers.create_request.handler', 'POST /requests');
    table.grant(createFn, 'dynamodb:PutItem', 'dynamodb:GetItem');

    const listFn = fn('ListRequests', 'handlers.list_requests.handler', 'GET /requests');
    table.grant(listFn, 'dynamodb:Query');

    const decideFn = fn('DecideRequest', 'handlers.decide_request.handler', 'POST /requests/{id}/decision');
    table.grant(decideFn, 'dynamodb:GetItem');
    props.stateMachine.grantTaskResponse(decideFn);

    this.functions = [createFn, listFn, decideFn];

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'jit-access-api',
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
        allowHeaders: ['authorization', 'content-type', 'idempotency-key'],
        maxAge: Duration.hours(1),
      },
    });

    const accessLogs = new logs.LogGroup(this, 'AccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new apigwv2.HttpStage(this, 'DefaultStage', {
      httpApi: this.httpApi,
      stageName: '$default',
      autoDeploy: true,
      throttle: { rateLimit: 20, burstLimit: 40 },
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(accessLogs),
        format: apigw.AccessLogFormat.custom(
          JSON.stringify({
            requestId: '$context.requestId',
            routeKey: '$context.routeKey',
            status: '$context.status',
            latencyMs: '$context.responseLatency',
            caller: '$context.authorizer.claims.sub',
            authorizerError: '$context.authorizer.error',
            integrationError: '$context.integrationErrorMessage',
            ip: '$context.identity.sourceIp',
          }),
        ),
      },
    });

    const authorizer = new HttpJwtAuthorizer('CognitoJwt', props.identity.issuerUrl, {
      authorizerName: 'cognito-jwt',
      identitySource: ['$request.header.Authorization'],
      jwtAudience: [props.identity.client.userPoolClientId],
    });

    const route = (
      routeId: string,
      path: string,
      method: apigwv2.HttpMethod,
      handler: lambda.IFunction,
      scope: string,
    ) =>
      this.httpApi.addRoutes({
        path,
        methods: [method],
        integration: new HttpLambdaIntegration(`${routeId}Integration`, handler),
        authorizer,
        authorizationScopes: [scope],
      });

    route('Create', '/requests', apigwv2.HttpMethod.POST, createFn, Identity.WRITE_SCOPE);
    route('List', '/requests', apigwv2.HttpMethod.GET, listFn, Identity.READ_SCOPE);
    route('Decide', '/requests/{id}/decision', apigwv2.HttpMethod.POST, decideFn, Identity.WRITE_SCOPE);

    this.url = this.httpApi.apiEndpoint;
  }
}
