import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { LoginBranding } from './login-branding';

export interface IdentityProps {
  /** Origins the browser app is served from; each gets origin + "/" as callback and logout URL. */
  readonly appOrigins: string[];
}

/**
 * Authentication: Cognito user pool with OIDC Authorization Code + PKCE for the browser app.
 * Groups say what a USER may do; resource-server scopes say what the APP may call.
 */
export class Identity extends Construct {
  static readonly RESOURCE_SERVER = 'jit-api';
  static readonly READ_SCOPE = `${Identity.RESOURCE_SERVER}/requests.read`;
  static readonly WRITE_SCOPE = `${Identity.RESOURCE_SERVER}/requests.write`;

  readonly userPool: cognito.UserPool;
  readonly client: cognito.UserPoolClient;
  readonly domainUrl: string;
  readonly issuerUrl: string;

  constructor(scope: Construct, id: string, props: IdentityProps) {
    super(scope, id);
    const { account, region } = Stack.of(this);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'jit-access-users',
      selfSignUpEnabled: false, // accounts are provisioned by an admin, not self-registered
      signInAliases: { username: true },
      passwordPolicy: {
        minLength: 14,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.NONE,
      featurePlan: cognito.FeaturePlan.ESSENTIALS, // needed for the managed login page and its branding
      removalPolicy: RemovalPolicy.DESTROY,
    });

    for (const [name, description] of [
      ['requesters', 'Can request temporary access'],
      ['approvers', 'Can approve or reject other people’s requests'],
    ]) {
      new cognito.CfnUserPoolGroup(this, `Group-${name}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: name,
        description,
      });
    }

    const read = new cognito.ResourceServerScope({ scopeName: 'requests.read', scopeDescription: 'List requests' });
    const write = new cognito.ResourceServerScope({ scopeName: 'requests.write', scopeDescription: 'Create and decide requests' });
    const resourceServer = this.userPool.addResourceServer('ApiScopes', {
      identifier: Identity.RESOURCE_SERVER,
      scopes: [read, write],
    });

    const domain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: `jit-access-${account}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    const urls = props.appOrigins.map((o) => `${o}/`);
    this.client = this.userPool.addClient('WebClient', {
      userPoolClientName: 'jit-access-web',
      generateSecret: false, // public client (browser): PKCE instead of a client secret
      authFlows: {}, // no username/password API flows; sign-in only through the hosted login page
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.resourceServer(resourceServer, read),
          cognito.OAuthScope.resourceServer(resourceServer, write),
        ],
        callbackUrls: urls,
        logoutUrls: urls,
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.hours(8),
    });

    new LoginBranding(this, 'LoginBranding', { userPool: this.userPool, client: this.client });

    this.domainUrl = domain.baseUrl();
    this.issuerUrl = `https://cognito-idp.${region}.amazonaws.com/${this.userPool.userPoolId}`;
  }
}
