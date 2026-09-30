import './style.css';
import type { User } from 'oidc-client-ts';
import { Api, ApiError, type AccessRequest } from './api';
import { Auth } from './auth';
import { loadConfig } from './config';
import { decodeJwt } from './jwt';

type Tab = 'request' | 'mine' | 'approvals';

const ACCESS_ROLES = [
  { name: 'prod-logs-read', label: 'Production logs (read)', max: 240 },
  { name: 'prod-db-readonly', label: 'Production database (read-only)', max: 120 },
  { name: 'prod-breakglass-admin', label: 'Break-glass admin (needs INC-###)', max: 60 },
];

const app = document.querySelector<HTMLDivElement>('#app')!;

/** Every value from the API or a token is escaped before it touches innerHTML. */
const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '');
const fmtRelative = (iso?: string) => {
  if (!iso) return '';
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(s);
  const text = abs < 90 ? `${abs}s` : abs < 5400 ? `${Math.round(abs / 60)} min` : `${Math.round(abs / 3600)} h`;
  return s >= 0 ? `in ${text}` : `${text} ago`;
};

async function main() {
  const config = await loadConfig();
  const auth = new Auth(config);
  let user: User | null;
  try {
    user = await auth.init();
  } catch (e) {
    renderSignedOut(auth, (e as Error).message);
    return;
  }
  if (!user) {
    renderSignedOut(auth);
    return;
  }
  new SignedInApp(auth, user, new Api(config.apiUrl, () => user!.access_token)).start();
}

function renderSignedOut(auth: Auth, error?: string) {
  app.innerHTML = `
    <main class="signed-out">
      <div class="brand"><span class="mark">JIT</span> Access</div>
      <h1>Temporary production access, approved by someone else.</h1>
      <p>Request time-boxed access for an incident. A different approver has to agree, and the access expires on its own. Every step is audited.</p>
      ${error ? `<p class="alert">${esc(error)}</p>` : ''}
      <button class="primary" id="login">Sign in</button>
      <p class="fine">Sign-in uses OpenID Connect (authorization code + PKCE) with Amazon Cognito.</p>
    </main>`;
  document.querySelector('#login')!.addEventListener('click', () => auth.login());
}

class SignedInApp {
  private tab: Tab;
  private mine: AccessRequest[] = [];
  private pending: AccessRequest[] = [];
  private idempotencyKey = crypto.randomUUID();
  private readonly claims: Record<string, unknown>;
  private readonly groups: string[];

  constructor(private readonly auth: Auth, private readonly user: User, private readonly api: Api) {
    this.claims = decodeJwt(user.access_token).payload;
    const raw = this.claims['cognito:groups'];
    this.groups = Array.isArray(raw) ? raw.map(String) : [];
    this.tab = this.isRequester ? 'request' : this.isApprover ? 'approvals' : 'mine';
  }

  private get isRequester() {
    return this.groups.includes('requesters');
  }

  private get isApprover() {
    return this.groups.includes('approvers');
  }

  private get username() {
    return String(this.claims.username ?? this.user.profile['cognito:username'] ?? this.user.profile.sub);
  }

  start() {
    this.renderShell();
    this.refresh();
    // Status changes happen asynchronously in the workflow, so poll while the tab is visible.
    setInterval(() => document.visibilityState === 'visible' && this.refresh(), 4000);
  }

  private async refresh() {
    try {
      const [mine, pending] = await Promise.all([
        this.api.list('mine'),
        this.isApprover ? this.api.list('pending') : Promise.resolve([]),
      ]);
      this.mine = mine;
      this.pending = pending;
      if (this.tab === 'mine' || this.tab === 'approvals') this.renderTab();
      this.renderTabBadges();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.toast('Your session expired. Sign in again.', 'error');
      }
    }
  }

  private renderShell() {
    app.innerHTML = `
      <header class="topbar">
        <div class="brand"><span class="mark">JIT</span> Access</div>
        <div class="who">
          <span class="user">${esc(this.username)}</span>
          ${this.groups.map((g) => `<span class="chip ${g === 'approvers' ? 'chip-accent' : ''}">${esc(g)}</span>`).join('')}
          <button class="ghost" id="logout">Sign out</button>
        </div>
      </header>
      <nav class="tabs" role="tablist">
        ${this.isRequester ? this.tabButton('request', 'Request access') : ''}
        ${this.tabButton('mine', 'My requests')}
        ${this.isApprover ? this.tabButton('approvals', 'Approvals') : ''}
      </nav>
      <main id="panel" class="panel"></main>
      <div id="toast" class="toast" hidden></div>`;
    document.querySelector('#logout')!.addEventListener('click', () => this.auth.logout());
    document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as Tab;
        document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        this.renderTab();
      }),
    );
    this.renderTab();
  }

  private tabButton(tab: Tab, label: string) {
    return `<button role="tab" data-tab="${tab}" aria-selected="${this.tab === tab}">${label}<span class="badge" data-badge="${tab}" hidden></span></button>`;
  }

  private renderTabBadges() {
    const set = (tab: Tab, n: number) => {
      const el = document.querySelector<HTMLElement>(`[data-badge="${tab}"]`);
      if (el) {
        el.textContent = String(n);
        el.hidden = n === 0;
      }
    };
    set('approvals', this.pending.length);
    set('mine', this.mine.filter((r) => ['PENDING', 'AWAITING_APPROVAL', 'GRANTED'].includes(r.status)).length);
  }

  private renderTab() {
    const panel = document.querySelector<HTMLElement>('#panel')!;
    if (this.tab === 'request') panel.innerHTML = this.requestForm();
    if (this.tab === 'mine') panel.innerHTML = this.requestList(this.mine, false);
    if (this.tab === 'approvals') panel.innerHTML = this.requestList(this.pending, true);
    this.bindPanel(panel);
  }

  private requestForm() {
    return `
      <section class="card form-card">
        <h2>Request temporary access</h2>
        <form id="request-form">
          <label for="role">Access</label>
          <select id="role" name="role">
            ${ACCESS_ROLES.map((r) => `<option value="${r.name}">${r.label} · max ${r.max} min</option>`).join('')}
          </select>
          <label for="duration">Duration (minutes)</label>
          <input id="duration" name="duration" type="number" min="1" value="30" required />
          <label for="reason">Reason</label>
          <textarea id="reason" name="reason" rows="3" maxlength="500" required placeholder="INC-1234: investigating 5xx errors on checkout"></textarea>
          <button class="primary" type="submit">Submit request</button>
        </form>
        <p class="fine">Policy is checked by the workflow, not this form: try asking for more than the maximum.</p>
      </section>`;
  }

  private requestList(items: AccessRequest[], approving: boolean) {
    if (items.length === 0) {
      return `<section class="empty"><h2>${approving ? 'Nothing waiting for approval' : 'No requests yet'}</h2>
        <p>${approving ? 'New requests appear here within a few seconds.' : 'Use “Request access” to create one.'}</p></section>`;
    }
    return `<section class="list">${items.map((r) => this.requestCard(r, approving)).join('')}</section>`;
  }

  private requestCard(r: AccessRequest, approving: boolean) {
    const own = r.requesterSub === this.user.profile.sub;
    const details = [
      ['Requested by', r.requesterUsername],
      ['Duration', `${r.durationMinutes} min`],
      ['Created', fmtTime(r.createdAt)],
      r.approverUsername || r.decidedBy ? ['Decided by', r.approverUsername ?? r.decidedBy] : null,
      r.decisionComment ? ['Comment', r.decisionComment] : null,
      r.expiresAt && r.status === 'GRANTED' ? ['Expires', `${fmtTime(r.expiresAt)} (${fmtRelative(r.expiresAt)})`] : null,
      r.revokedAt ? ['Revoked', fmtTime(r.revokedAt)] : null,
      r.failureError ? ['Error', r.failureError] : null,
    ].filter(Boolean) as [string, string][];

    return `
      <article class="card request status-${esc(r.status.toLowerCase())}">
        <div class="request-head">
          <span class="role">${esc(r.role)}</span>
          <span class="pill">${esc(r.status.replace('_', ' '))}</span>
        </div>
        <p class="reason">${esc(r.reason)}</p>
        <dl>${details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <p class="mono fine">id ${esc(r.requestId)}</p>
        ${
          !approving && own
            ? `<div class="session">
                <button class="${r.status === 'GRANTED' ? 'primary' : 'ghost'}" data-session="${esc(r.requestId)}">Open AWS console</button>
                <span class="fine">${
                  r.status === 'GRANTED'
                    ? `Real AWS session as <span class="mono">jit-target-${esc(r.role)}</span>, until ${esc(fmtTime(r.expiresAt))}.`
                    : 'Only works while this request is GRANTED. Try it now to see the API refuse.'
                }</span>
              </div>`
            : ''
        }
        ${
          approving
            ? `<div class="decide">
                ${own ? '<p class="warn">This is your own request. The UI still lets you try; the API will refuse.</p>' : ''}
                <input type="text" id="comment-${esc(r.requestId)}" placeholder="Comment (optional)" maxlength="500" />
                <button class="primary" data-decide="APPROVED" data-id="${esc(r.requestId)}">Approve</button>
                <button class="danger" data-decide="REJECTED" data-id="${esc(r.requestId)}">Reject</button>
              </div>`
            : ''
        }
      </article>`;
  }

  private bindPanel(panel: HTMLElement) {
    panel.querySelector<HTMLFormElement>('#request-form')?.addEventListener('submit', (e) => this.submitRequest(e));
    panel.querySelectorAll<HTMLButtonElement>('[data-session]').forEach((b) =>
      b.addEventListener('click', () => this.openConsole(b.dataset.session!)),
    );
    panel.querySelectorAll<HTMLButtonElement>('[data-decide]').forEach((b) =>
      b.addEventListener('click', () => this.decide(b.dataset.id!, b.dataset.decide as 'APPROVED' | 'REJECTED')),
    );
  }

  private async submitRequest(e: SubmitEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    try {
      // Same key for retries of this submission; a fresh key only after it succeeds.
      await this.api.create(
        { role: String(data.get('role')), durationMinutes: Number(data.get('duration')), reason: String(data.get('reason')) },
        this.idempotencyKey,
      );
      this.idempotencyKey = crypto.randomUUID();
      form.reset();
      this.toast('Request submitted. Watch it move through the workflow in “My requests”.', 'ok');
      this.refresh();
    } catch (err) {
      this.toast(`${err instanceof ApiError ? err.status + ': ' : ''}${(err as Error).message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  private async openConsole(id: string) {
    // Open the tab during the click, so the browser doesn't block it as a pop-up.
    const tab = window.open('about:blank', '_blank');
    try {
      const session = await this.api.startSession(id);
      if (tab) {
        tab.opener = null;
        tab.location.href = session.consoleUrl;
      } else {
        window.location.href = session.consoleUrl;
      }
      this.toast(`AWS console opened as jit-target-${session.role} until ${fmtTime(session.sessionExpiresAt)}.`, 'ok');
    } catch (err) {
      tab?.close();
      this.toast(`${err instanceof ApiError ? err.status + ': ' : ''}${(err as Error).message}`, 'error');
    }
  }

  private async decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    const comment = document.querySelector<HTMLInputElement>(`#comment-${CSS.escape(id)}`)?.value ?? '';
    try {
      await this.api.decide(id, decision, comment);
      this.toast(decision === 'APPROVED' ? 'Approved. The workflow is granting access.' : 'Rejected.', 'ok');
      this.refresh();
    } catch (err) {
      this.toast(`${err instanceof ApiError ? err.status + ': ' : ''}${(err as Error).message}`, 'error');
    }
  }

  private toast(message: string, kind: 'ok' | 'error') {
    const el = document.querySelector<HTMLElement>('#toast')!;
    el.textContent = message;
    el.className = `toast toast-${kind}`;
    el.hidden = false;
    clearTimeout((el as unknown as { t?: number }).t);
    (el as unknown as { t?: number }).t = window.setTimeout(() => (el.hidden = true), 6000);
  }
}

main().catch((e) => {
  app.innerHTML = `<main class="signed-out"><p class="alert">${esc((e as Error).message)}</p></main>`;
});
