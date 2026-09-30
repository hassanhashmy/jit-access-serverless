import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import type { AppConfig } from './config';

export const API_SCOPES = ['jit-api/requests.read', 'jit-api/requests.write'];

/**
 * OpenID Connect Authorization Code flow with PKCE, against Cognito.
 *   1. signinRedirect(): browser goes to Cognito with a code_challenge (hash of a random verifier)
 *   2. Cognito redirects back with ?code=...
 *   3. signinRedirectCallback(): exchanges code + code_verifier for ID, access and refresh tokens
 * No client secret exists in the browser; PKCE proves the same app started and finished the login.
 */
export class Auth {
  private readonly manager: UserManager;

  constructor(private readonly config: AppConfig) {
    this.manager = new UserManager({
      authority: config.issuer, // discovery: {issuer}/.well-known/openid-configuration
      client_id: config.clientId,
      redirect_uri: `${window.location.origin}/`,
      post_logout_redirect_uri: `${window.location.origin}/`,
      response_type: 'code',
      scope: ['openid', 'profile', ...API_SCOPES].join(' '),
      // Tokens live only for this browser tab, not in localStorage.
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      automaticSilentRenew: false,
    });
  }

  /** Finish a login if we were just redirected back from Cognito; otherwise return the stored user. */
  async init(): Promise<User | null> {
    const params = new URLSearchParams(window.location.search);
    if (params.has('code') && params.has('state')) {
      const user = await this.manager.signinRedirectCallback();
      window.history.replaceState({}, document.title, '/');
      return user;
    }
    if (params.has('error')) {
      throw new Error(`Login failed: ${params.get('error_description') ?? params.get('error')}`);
    }
    const user = await this.manager.getUser();
    return user && !user.expired ? user : null;
  }

  login(): Promise<void> {
    return this.manager.signinRedirect();
  }

  /** Cognito has no standard end_session_endpoint, so call its /logout endpoint directly. */
  async logout(): Promise<void> {
    await this.manager.removeUser();
    const url = new URL('/logout', this.config.cognitoDomain);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('logout_uri', `${window.location.origin}/`);
    window.location.assign(url.toString());
  }
}
