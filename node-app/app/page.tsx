'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { snapshot, Operation } from '../lib/operations';

type Serialized<T> = T extends Date ? string : T extends object ? { [K in keyof T]: Serialized<T[K]> } : T;
type Snapshot = Serialized<Awaited<ReturnType<typeof snapshot>>>;
type Pending = { operationId: string; payload: Operation };
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function api(action: string, body?: unknown) {
  const response = await fetch('/api/' + action, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.error);
  return data;
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card panel grid gap-3"><h2>{title}</h2>{children}</section>;
}
const loadQueue = (key: string): Pending[] => JSON.parse(localStorage.getItem(key) ?? '[]');
const formData = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return new FormData(event.currentTarget);
};
const field = (form: FormData, key: string) => String(form.get(key) ?? '');
const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : 'Connection unavailable.';
const dateTime = (value: string) => new Date(value).toLocaleString();

export default function Home() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [greek, setGreek] = useState(false);
  const [pending, setPending] = useState(0);
  const [query, setQuery] = useState('');
  const [site, setSite] = useState('');
  const [confirmSos, setConfirmSos] = useState(false);
  const [sosUnknown, setSosUnknown] = useState(false);
  const syncing = useRef(false);
  const sosRequest = useRef<Pending | null>(null);
  const t = (english: string, el: string) => greek ? el : english;

  async function refresh() {
    try { setData(await api('snapshot') as Snapshot); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) setData(null);
    } finally { setReady(true); }
  }

  const queueKey = data?.role === 'GUARD' ? 'securio-outbox-' + data.queueScope : '';

  async function sync() {
    if (!queueKey || syncing.current) return;
    syncing.current = true;
    try {
      for (const operation of loadQueue(queueKey)) {
        try {
          await api('operation', operation);
          localStorage.setItem(queueKey, JSON.stringify(loadQueue(queueKey).filter(item => item.operationId !== operation.operationId)));
        } catch (error) {
          setNotice(error instanceof ApiError ? 'Sync stopped. ' + error.message : 'Pending sync. Reconnect to retry.');
          break;
        }
      }
      setPending(loadQueue(queueKey).length);
    } finally { syncing.current = false; }
    await refresh();
  }

  useEffect(() => {
    void refresh();
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (data?.role !== 'GUARD') return;
    void sync();
    const reconnect = () => void sync();
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [queueKey]);

  async function send(action: string, payload: unknown) {
    setNotice('');
    try {
      const result = await api(action, payload);
      setNotice(t('Saved.', 'Αποθηκεύτηκε.'));
      await refresh();
      return result;
    } catch (error) {
      setNotice(errorMessage(error));
      return null;
    }
  }

  async function operate(payload: Operation) {
    const operation = { operationId: crypto.randomUUID(), payload };
    if (data?.role === 'GUARD' && payload.kind === 'job') {
      localStorage.setItem(queueKey, JSON.stringify([...loadQueue(queueKey), operation]));
      setPending(loadQueue(queueKey).length);
      setNotice('');
      await sync();
      return;
    }
    await send('operation', operation);
  }

  async function alertCommand(siteId: string) {
    const operation = sosRequest.current ?? { operationId: crypto.randomUUID(), payload: { kind: 'sos', siteId } };
    sosRequest.current = operation;
    setSosUnknown(false);
    try {
      await api('operation', operation);
      sosRequest.current = null;
      setConfirmSos(false);
      setNotice(t('SOS received by SECURIO COMMAND.', 'Το SECURIO COMMAND έλαβε το SOS.'));
      await refresh();
    } catch {
      setSosUnknown(true);
      setNotice(t('SOS delivery unconfirmed. Contact your control room directly.', 'Η παράδοση SOS δεν επιβεβαιώθηκε. Επικοινωνήστε απευθείας με το κέντρο ελέγχου.'));
    }
  }

  function login(event: FormEvent<HTMLFormElement>) {
    const values = formData(event);
    const otp = field(values, 'otp');
    void send('login', { email: field(values, 'email'), password: field(values, 'password'), ...(otp ? { otp } : {}) });
  }

  const matching = (value: string) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const guardSite = data?.role === 'GUARD' ? data.jobs.find(job => job.siteId === site) ?? data.jobs[0] : undefined;

  return <div className="shell">
    <header className="topbar"><div className="brand">SECUR<span>IO</span></div><div className="top-actions">
      <button className="mini" onClick={() => { document.documentElement.lang = greek ? 'en' : 'el'; setGreek(!greek); }}>{greek ? 'EN' : 'ΕΛ'}</button>
      {data && <button className="mini" onClick={async () => {
        if (data.role === 'GUARD' && loadQueue(queueKey).length && !window.confirm('Discard unsynced jobs and sign out?')) return;
        if (await send('logout', {})) { if (queueKey) localStorage.removeItem(queueKey); setData(null); setSite(''); }
      }}>{t('Sign out', 'Αποσύνδεση')}</button>}
    </div></header>
    {notice && <p className="notice mb-4" role="status">{notice}</p>}
    {!ready && <p>{t('Loading…', 'Φόρτωση…')}</p>}
    {ready && !data && <main className="mx-auto max-w-xl">
      <Panel title={t('Sign in to SECURIO', 'Σύνδεση στο SECURIO')}>
        <form onSubmit={login}>
          <label>Email<input className="input" name="email" type="email" required autoComplete="username" /></label>
          <label>{t('Password', 'Κωδικός')}<input className="input" name="password" type="password" required autoComplete="current-password" /></label>
          <label>{t('Authenticator code (COMMAND and ADMIN)', 'Κωδικός επαλήθευσης (COMMAND και ADMIN)')}<input className="input" name="otp" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" /></label>
          <button className="btn">{t('Sign in', 'Σύνδεση')}</button>
        </form>
      </Panel>
    </main>}
    {data?.role === 'GUARD' && <main className="mx-auto max-w-3xl">
      <div className="kicker">SECURIO GUARD</div>
      <h1>{t('Current duty', 'Τρέχουσα υπηρεσία')}</h1>
      {pending > 0 && <div className="notice">{pending} {t('pending sync', 'σε αναμονή συγχρονισμού')} <button className="mini" onClick={() => void sync()}>{t('Retry', 'Επανάληψη')}</button></div>}
      <Panel title={t('Assigned jobs', 'Ανατεθειμένες εργασίες')}>
        {!data.jobs.length && <p className="muted">{t('No current duty.', 'Δεν υπάρχει ενεργή υπηρεσία.')}</p>}
        {data.jobs.map(job => <div className="job" key={job.id}>
          <div className="job-top"><strong>{job.title}</strong><span className="tag">{({ SCHEDULED: t('Scheduled', 'Προγραμματισμένη'), IN_PROGRESS: t('In progress', 'Σε εξέλιξη'), COMPLETED: t('Completed', 'Ολοκληρώθηκε'), BLOCKED: t('Blocked', 'Αποκλείστηκε') })[job.status]}</span></div>
          <p className="muted">{job.site.name} · {dateTime(job.dueAt)}</p>
          <div className="actions">
            {job.status === 'SCHEDULED' && <button className="btn" disabled={pending > 0} onClick={() => void operate({ kind: 'job', id: job.id, transition: 'start' })}>{t('Start job', 'Έναρξη')}</button>}
            {job.status === 'IN_PROGRESS' && <>
              <button className="btn" disabled={pending > 0} onClick={() => void operate({ kind: 'job', id: job.id, transition: 'done' })}>{t('Mark done', 'Ολοκλήρωση')}</button>
              <button className="btn secondary" disabled={pending > 0} onClick={() => void operate({ kind: 'job', id: job.id, transition: 'block' })}>{t('Mark blocked', 'Δήλωση προβλήματος')}</button>
            </>}
          </div>
        </div>)}
      </Panel>
      {guardSite && <>
        <label>{t('Duty site', 'Χώρος υπηρεσίας')}<select className="input" value={guardSite.siteId} onChange={event => setSite(event.target.value)}>{[...new Map(data.jobs.map(job => [job.siteId, job.site.name]))].map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
        <Panel title={t('Emergency alert', 'Ειδοποίηση έκτακτης ανάγκης')}>
          {data.sos && <p>SOS · {data.sos.status}</p>}
          {confirmSos ? <div className="actions">
            <button className="btn danger" onClick={() => void alertCommand(guardSite.siteId)}>{sosUnknown ? t('Retry SOS', 'Επανάληψη SOS') : t('Confirm SOS', 'Επιβεβαίωση SOS')}</button>
            <button className="btn secondary" onClick={() => setConfirmSos(false)}>{t('Cancel', 'Ακύρωση')}</button>
          </div> : <button className="btn danger" onClick={() => setConfirmSos(true)}>{t('Send SOS', 'Αποστολή SOS')}</button>}
        </Panel>
        <Panel title={t('Report incident', 'Αναφορά συμβάντος')}>
          <form onSubmit={event => {
            const form = formData(event);
            void operate({ kind: 'incident', siteId: guardSite.siteId, category: field(form, 'category'), description: field(form, 'description') });
          }}>
            <label>{t('Category', 'Κατηγορία')}<input className="input" name="category" required maxLength={80} /></label>
            <label>{t('Description', 'Περιγραφή')}<textarea className="textarea" name="description" required maxLength={4000} /></label>
            <button className="btn">{t('Submit incident', 'Υποβολή συμβάντος')}</button>
          </form>
        </Panel>
      </>}
    </main>}
    {data?.role === 'CLIENT' && <main>
      <div className="kicker">SECURIO CLIENT</div>
      <h1>Property security</h1>
      {!data.sites.length && <p>No properties assigned.</p>}
      {data.sites.map(property => <Panel title={property.name} key={property.id}>
        <div className="client-status">{({ ACTIVE: 'Coverage active', NO_COVERAGE: 'No coverage scheduled', UNKNOWN: 'Coverage unconfirmed' })[property.coverage]}</div>
        <h3 className="font-bold">Shared incidents</h3>
        {property.incidents.length ? property.incidents.map(item => <p className="event" key={item.id}>{item.clientSummary}</p>) : <p className="muted">No shared incidents.</p>}
        <h3 className="font-bold">Contact Security</h3>
        {property.phone && <a className="underline" href={'tel:' + property.phone}>Call Security</a>}
        <div className="chat">{[...property.messages].reverse().map(message => <p className="chat-msg" key={message.id}>{message.fromSecurity ? 'Security' : 'You'} · {message.body}</p>)}</div>
        <form onSubmit={event => {
          const form = formData(event);
          const element = event.currentTarget;
          void send('operation', { operationId: crypto.randomUUID(), payload: { kind: 'message', siteId: property.id, body: field(form, 'body') } }).then(result => { if (result) element.reset(); });
        }}>
          <label>Message<input className="input" name="body" required maxLength={2000} /></label>
          <button className="btn">Send</button>
        </form>
      </Panel>)}
    </main>}
    {(data?.role === 'SUPERVISOR' || data?.role === 'COMPANY_ADMIN') && <main>
      <div className="kicker">SECURIO {data.role === 'COMPANY_ADMIN' ? 'ADMIN' : 'COMMAND'}</div>
      <h1>{data.role === 'COMPANY_ADMIN' ? data.config.name : 'What needs attention'}</h1>
      <label>Search sites, guards, jobs and incidents<input className="input" type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Attention">
          {!data.sos.length && !data.jobs.some(item => item.overdue) && <p className="muted">No open SOS or overdue jobs.</p>}
          {data.sos.map(item => <div className="notice" key={item.id}><strong>SOS · {item.status}</strong><p>{item.siteId} · {dateTime(item.createdAt)}</p><button className="btn danger" onClick={() => void operate({ kind: 'respond', id: item.id, transition: item.status === 'DELIVERED' ? 'ACKNOWLEDGED' : 'RESOLVED' })}>{item.status === 'DELIVERED' ? 'Acknowledge' : 'Resolve'}</button></div>)}
          {data.jobs.filter(item => item.overdue).map(item => <p className="tag red" key={item.id}>Overdue · {item.title}</p>)}
        </Panel>
        <Panel title="Sites and jobs">
          {data.sites.filter(item => matching(item.name)).map(item => <strong key={item.id}>{item.name}</strong>)}
          {data.jobs.filter(item => matching([item.title, item.guard.name, item.siteId].join(' '))).map(item => <div className="event" key={item.id}>{item.title} · {item.guard.name} · {item.status}</div>)}
        </Panel>
      </div>
      <Panel title="Incident review">
        {data.incidents.filter(item => matching(item.category + ' ' + item.description)).map(item => <div className="job grid gap-3" key={item.id}>
          <strong>{item.category} · {item.status}</strong><p>{item.description}</p>
          {item.status !== 'CLOSED' && <button className="btn secondary" onClick={() => void operate({ kind: 'review', id: item.id, advance: true })}>Advance status</button>}
          <form onSubmit={event => void operate({ kind: 'review', id: item.id, summary: field(formData(event), 'summary') })}>
            <label>Client-safe summary<textarea className="textarea" name="summary" required maxLength={1600} defaultValue={item.clientSummary ?? ''} /></label>
            <button className="btn">Approve summary for client</button>
          </form>
          {data.role === 'COMPANY_ADMIN' && <form onSubmit={event => void operate({ kind: 'review', id: item.id, reason: field(formData(event), 'reason') })}>
            <label>Removal reason<input className="input" name="reason" required maxLength={400} /></label>
            <button className="btn danger">Remove incident</button>
          </form>}
          {item.clientSummary && <button className="btn secondary" onClick={() => void operate({ kind: 'review', id: item.id, summary: null })}>Revoke client visibility</button>}
        </div>)}
      </Panel>
      <Panel title="Client messages">
        {[...new Map(data.messages.map(message => [JSON.stringify([message.siteId, message.clientId]), message])).values()].map(thread => <div className="job" key={thread.siteId + ':' + thread.clientId}>
          <strong>{thread.siteId}</strong>
          {data.messages.filter(message => message.siteId === thread.siteId && message.clientId === thread.clientId).reverse().map(message => <div className="event" key={message.id}>{message.fromSecurity ? 'Security' : 'Client'} · {message.body}</div>)}
          <form onSubmit={event => {
            const form = formData(event);
            const element = event.currentTarget;
            void send('operation', { operationId: crypto.randomUUID(), payload: { kind: 'message', siteId: thread.siteId, clientId: thread.clientId, body: field(form, 'body') } }).then(result => { if (result) element.reset(); });
          }}><label>Reply<input className="input" name="body" required maxLength={2000} /></label><button className="btn">Send reply</button></form>
        </div>)}
      </Panel>
      {data.role === 'COMPANY_ADMIN' && <>
        <Panel title="Company settings">
          <form onSubmit={event => { const form = formData(event); void send('settings', { name: field(form, 'name'), overdueMinutes: field(form, 'overdueMinutes') }); }}>
            <label>Company name<input className="input" name="name" required defaultValue={data.config.name} /></label>
            <label>Overdue threshold (minutes)<input className="input" name="overdueMinutes" type="number" min={1} max={1440} required defaultValue={data.config.overdueMinutes} /></label>
            <button className="btn">Save settings</button>
          </form>
        </Panel>
        <Panel title="RosterDroid CSV import">
          <p className="muted">{data.config.rosterSyncedAt ? 'Last successful import · ' + dateTime(data.config.rosterSyncedAt) : 'Awaiting first import'}</p>
          <form onSubmit={async event => {
            const form = formData(event);
            const file = form.get('csv');
            if (!(file instanceof File) || !file.size || file.size > 450000) { setNotice('Choose a CSV smaller than 450 KB.'); return; }
            try {
              const mapping = field(form, 'mapping').trim();
              await send('roster', { csv: await file.text(), ...(mapping ? { mapping: JSON.parse(mapping) } : {}) });
            } catch { setNotice('Invalid column mapping or unreadable file.'); }
          }}><label>Roster CSV<input className="input" name="csv" type="file" accept=".csv,text/csv" required /></label><label>Column mapping (JSON, optional)<input className="input" name="mapping" placeholder='{"guardId":"Employee ID"}' /></label><button className="btn">Import roster</button></form>
        </Panel>
        <Panel title="Sites">
          <form onSubmit={event => { const form = formData(event); void send('site', { id: field(form, 'id'), name: field(form, 'name'), phone: field(form, 'phone') || null }); }}>
            <label>External site ID<input className="input" name="id" required /></label>
            <label>Site name<input className="input" name="name" required /></label>
            <label>Security phone<input className="input" name="phone" type="tel" /></label>
            <button className="btn">Save site</button>
          </form>
        </Panel>
        <Panel title="Users and site access">
          {data.users.map(user => <div className="job" key={user.id}><strong>{user.name}</strong><p className="muted">{user.email} · {user.role} · {user.id}</p>
            {user.role !== 'COMPANY_ADMIN' && <button className="btn secondary" onClick={() => void send('account-status', { userId: user.id, enabled: !user.enabled })}>{user.enabled ? 'Disable account' : 'Enable account'}</button>}
            {['CLIENT', 'SUPERVISOR'].includes(user.role) && data.sites.map(item => <label className="check-row" key={item.id}>{item.name}<input type="checkbox" checked={user.grants.some(grant => grant.siteId === item.id)} onChange={event => void send('grant', { userId: user.id, siteId: item.id, enabled: event.target.checked })} /></label>)}
          </div>)}
        </Panel>
      </>}
      <Panel title="Reports"><a className="underline" href="/api/report">Download job history (CSV)</a><p className="muted">Up to 2,000 jobs in your authorized sites, newest due date first.</p></Panel>
      <Panel title="Audit history">
        {data.audit.map(item => <p key={item.action + item.entityId + item.occurredAt} className="event">{dateTime(item.occurredAt)} · {item.action} · {item.entityId}</p>)}
      </Panel>
    </main>}
  </div>;
}
