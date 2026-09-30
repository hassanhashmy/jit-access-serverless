/** Decode a JWT to read its claims (e.g. groups) in the UI. This does NOT verify the signature: API Gateway does that. */
export function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [header, payload] = token.split('.').slice(0, 2).map((part) => {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))));
  });
  return { header, payload };
}
