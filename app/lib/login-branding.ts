import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

// Brand colours shared with the web app (web/src/style.css). Cognito wants RRGGBBAA hex.
const TEAL = '0d7a6bff';
const TEAL_DARK = '095a4fff';
const TEAL_DARKER = '074a41ff';
const TEAL_SOFT = 'e0f2eeff';
const INK = '16202aff';
const MUTED = '5d6977ff';
const LINE = 'd3d9e0ff';
const PAGE = 'eef2f5ff';
const WHITE = 'ffffffff';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="56" viewBox="0 0 240 56">
<rect x="0" y="8" width="64" height="40" rx="8" fill="#0d7a6b"/>
<text x="32" y="35" text-anchor="middle" font-family="Menlo,Consolas,monospace" font-size="19" font-weight="700" fill="#ffffff" letter-spacing="1">JIT</text>
<text x="78" y="37" font-family="Helvetica,Arial,sans-serif" font-size="26" font-weight="700" fill="#16202a">Access</text>
</svg>`;

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
<rect width="32" height="32" rx="7" fill="#0d7a6b"/>
<text x="16" y="22" text-anchor="middle" font-family="Menlo,Consolas,monospace" font-size="14" font-weight="700" fill="#ffffff">J</text>
</svg>`;

const svg = (markup: string) => Buffer.from(markup).toString('base64');

export interface LoginBrandingProps {
  readonly userPool: cognito.IUserPool;
  readonly client: cognito.IUserPoolClient;
}

/**
 * Styles the Cognito managed login page to match the app. Only the values we change are listed;
 * Cognito keeps its defaults for everything else.
 */
export class LoginBranding extends Construct {
  constructor(scope: Construct, id: string, props: LoginBrandingProps) {
    super(scope, id);

    new cognito.CfnManagedLoginBranding(this, 'Style', {
      userPoolId: props.userPool.userPoolId,
      clientId: props.client.userPoolClientId,
      useCognitoProvidedValues: false,
      assets: [
        { category: 'FORM_LOGO', colorMode: 'LIGHT', extension: 'SVG', bytes: svg(LOGO_SVG) },
        { category: 'FAVICON_SVG', colorMode: 'LIGHT', extension: 'SVG', bytes: svg(FAVICON_SVG) },
      ],
      settings: {
        categories: {
          auth: {
            authMethodOrder: [[{ display: 'INPUT', type: 'USERNAME_PASSWORD' }]],
            federation: { interfaceStyle: 'BUTTON_LIST', order: [] },
          },
          form: {
            displayGraphics: true,
            instructions: { enabled: false },
            languageSelector: { enabled: false },
            location: { horizontal: 'CENTER', vertical: 'CENTER' },
            sessionTimerDisplay: 'NONE',
          },
          global: {
            colorSchemeMode: 'LIGHT',
            pageHeader: { enabled: false },
            pageFooter: { enabled: false },
            spacingDensity: 'REGULAR',
          },
        },
        componentClasses: {
          buttons: { borderRadius: 8.0 },
          input: {
            borderRadius: 8.0,
            lightMode: { defaults: { backgroundColor: WHITE, borderColor: 'c3ccd6ff' }, placeholderColor: '7a8694ff' },
          },
          inputLabel: { lightMode: { textColor: INK } },
          inputDescription: { lightMode: { textColor: MUTED } },
          focusState: { lightMode: { borderColor: TEAL } },
          link: { lightMode: { defaults: { textColor: TEAL }, hover: { textColor: TEAL_DARK } } },
          divider: { lightMode: { borderColor: LINE } },
        },
        components: {
          favicon: { enabledTypes: ['SVG'] },
          form: {
            borderRadius: 14.0,
            backgroundImage: { enabled: false },
            lightMode: { backgroundColor: WHITE, borderColor: LINE },
            logo: { enabled: true, formInclusion: 'IN', location: 'CENTER', position: 'TOP' },
          },
          pageBackground: { image: { enabled: false }, lightMode: { color: PAGE } },
          pageText: { lightMode: { headingColor: INK, bodyColor: MUTED, descriptionColor: MUTED } },
          primaryButton: {
            lightMode: {
              defaults: { backgroundColor: TEAL, textColor: WHITE },
              hover: { backgroundColor: TEAL_DARK, textColor: WHITE },
              active: { backgroundColor: TEAL_DARKER, textColor: WHITE },
              disabled: { backgroundColor: WHITE, borderColor: WHITE },
            },
          },
          secondaryButton: {
            lightMode: {
              defaults: { backgroundColor: WHITE, borderColor: TEAL, textColor: TEAL },
              hover: { backgroundColor: TEAL_SOFT, borderColor: TEAL_DARK, textColor: TEAL_DARK },
              active: { backgroundColor: 'c9e9e2ff', borderColor: TEAL_DARKER, textColor: TEAL_DARKER },
            },
          },
        },
      },
    });
  }
}
