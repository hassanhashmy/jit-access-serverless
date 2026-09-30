/** Decode a JWT payload for display. This does NOT verify the signature: API Gateway does that. */
export function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [header, payload] = token.split('.').slice(0, 2).map((part) => {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))));
  });
  return { header, payload };
}

/** What each claim means, for the token inspector. */
export const CLAIM_NOTES: Record<string, string> = {
  iss: 'Issuer: the Cognito user pool that signed this token. API Gateway only trusts this issuer.',
  sub: 'Subject: the user’s stable ID. Used to decide "is this your own request?".',
  aud: 'Audience (ID token): the app client this token was issued for.',
  client_id: 'App client (access token). API Gateway checks it when there is no aud claim.',
  token_use: '"id" proves who you are to the app; "access" is what the API accepts.',
  scope: 'What the APP may do on your behalf. Checked per route by API Gateway.',
  'cognito:groups': 'What the USER may do. Checked by the Lambda (approvers only can decide).',
  'cognito:username': 'Username shown in the UI.',
  username: 'Username shown in the UI.',
  exp: 'Expiry. After this time API Gateway rejects the token with 401.',
  iat: 'Issued at.',
  auth_time: 'When the user actually logged in.',
  nonce: 'Random value that binds the ID token to this login attempt (replay protection).',
  at_hash: 'Hash of the access token, binding it to this ID token.',
  jti: 'Unique token ID.',
  origin_jti: 'ID of the original login session.',
  event_id: 'Cognito event ID for this sign-in.',
  version: 'Token format version.',
  kid: 'Key ID: which of Cognito’s public keys (JWKS) verifies the signature.',
  alg: 'Signature algorithm (RS256 = RSA with SHA-256).',
};
