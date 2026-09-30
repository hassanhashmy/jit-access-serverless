import * as path from 'path';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

// Powertools for AWS Lambda (Python) public layer, pinned. Keep in step with requirements-dev.txt.
const POWERTOOLS_LAYER_VERSION = 38;
const PYTHON_SRC = path.join(__dirname, '..', 'lambdas', 'python');
const PYTHON_ASSET_EXCLUDES = ['.venv', 'tests', '**/__pycache__', '.pytest_cache', '.ruff_cache', '*.toml', '*.txt'];

export function powertoolsLayer(scope: Construct): lambda.ILayerVersion {
  const { region } = Stack.of(scope);
  return lambda.LayerVersion.fromLayerVersionArn(
    scope,
    'PowertoolsPython',
    `arn:aws:lambda:${region}:017000801446:layer:AWSLambdaPowertoolsPythonV3-python312-arm64:${POWERTOOLS_LAYER_VERSION}`,
  );
}

export interface PythonFunctionProps {
  /** Module path inside lambdas/python, e.g. handlers.create_request.handler */
  readonly handler: string;
  readonly description: string;
  readonly powertools: lambda.ILayerVersion;
  readonly environment?: Record<string, string>;
  readonly timeout?: Duration;
}

/** One Python Lambda with the project defaults: arm64, Powertools, X-Ray, JSON logs kept for 30 days. */
export class PythonFunction extends Construct {
  readonly fn: lambda.Function;

  constructor(scope: Construct, id: string, props: PythonFunctionProps) {
    super(scope, id);

    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.fn = new lambda.Function(this, 'Fn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      handler: props.handler,
      code: lambda.Code.fromAsset(PYTHON_SRC, { exclude: PYTHON_ASSET_EXCLUDES }),
      description: props.description,
      memorySize: 256,
      timeout: props.timeout ?? Duration.seconds(10),
      layers: [props.powertools],
      logGroup,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        POWERTOOLS_SERVICE_NAME: 'jit-access',
        POWERTOOLS_METRICS_NAMESPACE: 'JitAccess',
        POWERTOOLS_LOG_LEVEL: 'INFO',
        ...props.environment,
      },
    });
  }
}
