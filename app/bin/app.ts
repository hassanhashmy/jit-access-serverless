#!/usr/bin/env node
import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { JitAccessStack } from '../lib/jit-access-stack';

const app = new App();

new JitAccessStack(app, 'JitAccess', {
  env: { account: '232936223811', region: 'eu-west-2' },
  approvalTimeoutMinutes: Number(app.node.tryGetContext('approvalTimeoutMinutes') ?? 15),
  demoFailures: String(app.node.tryGetContext('demoFailures')) === 'true',
  alarmEmail: app.node.tryGetContext('alarmEmail') || undefined,
});

// Compliance as code: every synth is checked against the AWS Solutions rule pack.
Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
