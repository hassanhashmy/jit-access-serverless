export interface AppConfig {
  region: string;
  apiUrl: string;
  userPoolId: string;
  clientId: string;
  cognitoDomain: string;
  issuer: string;
}

/** Written next to the app at deploy time, so one build works in any environment. */
export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('config.json not found. For local dev, copy web/config.example.json to web/public/config.json.');
  return res.json();
}
