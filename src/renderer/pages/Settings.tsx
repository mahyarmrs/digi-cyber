import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { AccountSummary, AppProfile, ProtocolChoice, Settings, SplitApp } from '../../shared/types';
import { Row, Segmented, Switch } from '../components/Controls';
import { PlusIcon, TrashIcon } from '../components/Icons';
import { Mark, Wordmark } from '../components/Mark';
import { Dashes } from '../components/Meters';
import { bytes, daysLeft } from '../format';
import { errorText, type Translate } from '../i18n';

export type Section = 'general' | 'account' | 'connection' | 'killswitch' | 'split' | 'privacy' | 'support' | 'about';

interface Props {
  t: Translate;
  settings: Settings;
  profile: AppProfile;
  section: Section;
  onSection: (s: Section) => void;
  onChange: (patch: Partial<Settings>) => void;
  onRefresh: () => void;
  accounts: AccountSummary[];
  switchingAccount: string | null;
  onAddAccount: () => void;
  onSwitchAccount: (id: string) => void;
  onLogout: () => void;
}

function Group({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <section className="group">
      {title && <h3 className="group-title">{title}</h3>}
      {children}
      {note && <p className="group-note">{note}</p>}
    </section>
  );
}

// An index of sections on one side, the chosen section's rows on the other.
export function SettingsPage(props: Props) {
  const { t, section, onSection } = props;
  const nav: [Section, string][] = [
    ['general', t('general')],
    ['account', t('account')],
    ['connection', t('connection')],
    ['killswitch', t('killSwitch')],
    ['split', t('splitTunneling')],
    ['privacy', t('privacy')],
    ['support', t('supportSection')],
    ['about', t('about')],
  ];
  const title = nav.find(([key]) => key === section)?.[1] ?? '';
  return (
    <div className="prefs">
      <nav className="prefs-index" aria-label={t('settings')}>
        {nav.map(([key, label]) => (
          <button key={key} type="button" className={section === key ? 'on' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => onSection(key)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="prefs-body">
        {section !== 'about' && <h1>{title}</h1>}
        {section === 'general' && <General {...props} />}
        {section === 'account' && <Account {...props} />}
        {section === 'connection' && <Connection {...props} />}
        {section === 'killswitch' && <KillSwitch {...props} />}
        {section === 'split' && <Split {...props} />}
        {section === 'privacy' && <Privacy {...props} />}
        {section === 'support' && <Support {...props} />}
        {section === 'about' && <About {...props} />}
      </div>
    </div>
  );
}

function General({ t, settings, onChange }: Props) {
  return (
    <Group>
      <Row title={t('language')}>
        <Segmented
          label={t('language')}
          value={settings.language}
          onChange={(language) => onChange({ language })}
          options={[
            { value: 'fa', label: 'فارسی' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Row>
      <Row title={t('appearance')}>
        <Segmented
          label={t('appearance')}
          value={settings.theme}
          onChange={(theme) => onChange({ theme })}
          options={[
            { value: 'dark', label: t('themeDark') },
            { value: 'light', label: t('themeLight') },
            { value: 'system', label: t('themeSystem') },
          ]}
        />
      </Row>
      <Row title={t('startWithWindows')} hint={t('startWithWindowsHint')}>
        <Switch label={t('startWithWindows')} checked={settings.startWithWindows} onChange={(startWithWindows) => onChange({ startWithWindows })} />
      </Row>
      <Row title={t('launchMinimized')} hint={t('launchMinimizedHint')}>
        <Switch label={t('launchMinimized')} checked={settings.launchMinimized} onChange={(launchMinimized) => onChange({ launchMinimized })} />
      </Row>
      <Row title={t('connectOnStart')} hint={t('connectOnStartHint')}>
        <Switch label={t('connectOnStart')} checked={settings.connectOnStart} onChange={(connectOnStart) => onChange({ connectOnStart })} />
      </Row>
      <Row title={t('notifications')} hint={t('notificationsHint')}>
        <Switch label={t('notifications')} checked={settings.notifications} onChange={(notifications) => onChange({ notifications })} />
      </Row>
    </Group>
  );
}

function Account({ t, profile, onRefresh, accounts, switchingAccount, onAddAccount, onSwitchAccount, onLogout }: Props) {
  const a = profile.account;
  const used = a.upload + a.download;
  const percent = a.total > 0 ? Math.min(100, Math.round((used / a.total) * 1000) / 10) : null;
  let expiry = t('never');
  if (a.expiryTime > 0) expiry = `${new Date(a.expiryTime).toLocaleDateString()} (${t('daysLeft', { n: daysLeft(a.expiryTime) })})`;
  else if (a.expiryTime < 0) expiry = t('firstUse');
  return (
    <>
      <Group>
        <Row title={<span dir="ltr">{a.username}</span>} hint={profile.title}>
          <span className={a.enabled ? 'pill ok' : 'pill bad'}>{a.enabled ? t('active') : t('inactive')}</span>
        </Row>
        <Row title={t('usage')} hint={<span dir="ltr">{bytes(used)} / {a.total > 0 ? bytes(a.total) : t('unlimited')}</span>}>
          <div style={{ width: 180 }}>
            <Dashes percent={percent} count={10} label={t('usage')} />
          </div>
        </Row>
        <Row title={t('expires')} hint={expiry} />
        <Row title={t('devices')} hint={a.deviceLimit > 0 ? t('devicesOf', { n: '\u2068' + a.devices + '\u2069', max: '\u2068' + a.deviceLimit + '\u2069' }) : t('unlimited')} />
      </Group>
      <Group title={t('accounts')}>
        {accounts.map((account) => (
          <Row key={account.id} title={<span dir="ltr">{account.username}</span>} hint={<span dir="ltr">{account.label}</span>}>
            {account.active ? (
              <span className="pill ok">{t('currentAccount')}</span>
            ) : (
              <button type="button" className="btn btn-line btn-small" disabled={switchingAccount !== null} onClick={() => onSwitchAccount(account.id)}>
                {switchingAccount === account.id ? t('switchingAccount') : t('switchToAccount')}
              </button>
            )}
          </Row>
        ))}
        <div className="button-row">
          <button type="button" className="btn btn-line btn-small" disabled={switchingAccount !== null} onClick={onAddAccount}>
            <PlusIcon /> {t('addAccount')}
          </button>
        </div>
      </Group>
      <div className="button-row">
        <button type="button" className="btn btn-line" onClick={onRefresh}>
          {t('refresh')}
        </button>
        {profile.supportUrl && (
          <button type="button" className="btn btn-line" onClick={() => void window.dc.openExternal(profile.supportUrl ?? '')}>
            {t('support')}
          </button>
        )}
        <button type="button" className="btn btn-danger" onClick={onLogout}>
          {t('logout')}
        </button>
      </div>
    </>
  );
}

const protocols: [ProtocolChoice, string, string][] = [
  ['auto', '', 'protocolHint'],
  ['xray', 'Xray', 'protoXray'],
  ['wireguard', 'WireGuard', 'protoWireguard'],
  ['openvpn', 'OpenVPN', 'protoOpenvpn'],
  ['l2tp', 'L2TP/IPsec', 'protoL2tp'],
];

function Connection({ t, settings, onChange }: Props) {
  const [dns, setDns] = useState(settings.dns);
  useEffect(() => setDns(settings.dns), [settings.dns]);
  const shown = window.dc.os === 'macos' ? protocols.filter(([key]) => key !== 'l2tp') : protocols;
  return (
    <>
      <Group title={t('protocol')}>
        {shown.map(([key, name, hint]) => (
          <Row key={key} title={key === 'auto' ? t('auto') : <span dir="ltr">{name}</span>} hint={t(hint)} onClick={() => onChange({ protocol: key })}>
            <span className={settings.protocol === key ? 'radio on' : 'radio'} role="radio" aria-checked={settings.protocol === key} />
          </Row>
        ))}
      </Group>
      <Group>
        <Row title={t('autoReconnect')} hint={t('autoReconnectHint')}>
          <Switch label={t('autoReconnect')} checked={settings.autoReconnect} onChange={(autoReconnect) => onChange({ autoReconnect })} />
        </Row>
        <Row title={t('adBlock')} hint={t('adBlockHint')}>
          <Switch label={t('adBlock')} checked={settings.adBlock} onChange={(adBlock) => onChange({ adBlock })} />
        </Row>
        <Row title={t('customDns')} hint={t('customDnsHint')}>
          <input className="field" style={{ width: 220, height: 38 }} dir="ltr" value={dns} placeholder="1.1.1.1, 8.8.8.8" onChange={(e) => setDns(e.target.value)} onBlur={() => onChange({ dns: dns.trim() })} />
        </Row>
      </Group>
    </>
  );
}

function KillSwitch({ t, settings, onChange }: Props) {
  return (
    <Group note={t('killSwitchLong')}>
      <Row title={t('killSwitch')} hint={t('killSwitchHint')}>
        <Switch label={t('killSwitch')} checked={settings.killSwitch} onChange={(killSwitch) => onChange({ killSwitch })} />
      </Row>
    </Group>
  );
}

function AppIcon({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void window.dc.appIcon(path).then(setSrc).catch(() => setSrc(null));
  }, [path]);
  return src ? <img className="app-icon" src={src} alt="" /> : <span className="app-icon placeholder" />;
}

function Split({ t, settings, onChange }: Props) {
  const add = async () => {
    const app = await window.dc.pickApp();
    if (app && !settings.splitApps.some((a) => a.name === app.name)) onChange({ splitApps: [...settings.splitApps, app], splitTunneling: true });
  };
  const remove = (app: SplitApp) => onChange({ splitApps: settings.splitApps.filter((a) => a.name !== app.name) });
  return (
    <>
      <Group>
        <Row title={t('iranDirect')} hint={t('iranDirectHint')}>
          <Switch label={t('iranDirect')} checked={settings.iranDirect} onChange={(iranDirect) => onChange({ iranDirect })} />
        </Row>
        <Row title={t('splitTunneling')} hint={t('splitHint')}>
          <Switch label={t('splitTunneling')} checked={settings.splitTunneling} onChange={(splitTunneling) => onChange({ splitTunneling })} />
        </Row>
      </Group>
      <Group title={t('apps')}>
        {settings.splitApps.length === 0 && <Row title={<span className="muted">{t('noApps')}</span>} />}
        {settings.splitApps.map((app) => (
          <Row
            key={app.name}
            title={
              <span className="app-row">
                <AppIcon path={app.path} />
                <span dir="ltr">{app.name}</span>
              </span>
            }
            hint={<span dir="ltr">{app.path}</span>}
          >
            <button type="button" className="icon-btn" aria-label={t('remove')} title={t('remove')} onClick={() => remove(app)}>
              <TrashIcon />
            </button>
          </Row>
        ))}
        <div className="button-row">
          <button type="button" className="btn btn-line btn-small" onClick={() => void add()}>
            <PlusIcon /> {t('addApp')}
          </button>
        </div>
      </Group>
    </>
  );
}

function Privacy({ t, settings, onChange }: Props) {
  return (
    <Group>
      {window.dc.os !== 'macos' && (
        <Row title={t('webrtc')} hint={t('webrtcHint')}>
          <Switch label={t('webrtc')} checked={settings.webrtcProtection} onChange={(webrtcProtection) => onChange({ webrtcProtection })} />
        </Row>
      )}
      <Row title={t('timezone')} hint={t('timezoneHint')}>
        <Switch label={t('timezone')} checked={settings.timezoneSpoof} onChange={(timezoneSpoof) => onChange({ timezoneSpoof })} />
      </Row>
    </Group>
  );
}

type Sending = { state: 'idle' } | { state: 'sending' } | { state: 'sent'; id: string | null } | { state: 'failed'; code: string };

// A report sends the log since the app started to the panel, which files it under this account.
function Support({ t, profile }: Props) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState<Sending>({ state: 'idle' });
  const [log, setLog] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const view = useRef<HTMLPreElement | null>(null);

  const loadLog = async () => setLog(await window.dc.logText());
  useEffect(() => {
    if (view.current) view.current.scrollTop = view.current.scrollHeight;
  }, [log]);

  const send = async () => {
    setSending({ state: 'sending' });
    try {
      setSending({ state: 'sent', ...(await window.dc.sendReport(message.trim())) });
      setMessage('');
    } catch (err) {
      setSending({ state: 'failed', code: err instanceof Error ? err.message : 'unexpected' });
    }
  };
  const copy = async () => {
    await navigator.clipboard.writeText(await window.dc.logText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Group title={t('reportProblem')}>
        <p className="group-note" style={{ marginBottom: 12 }}>
          {t('reportHint')}
        </p>
        <textarea className="field" rows={4} maxLength={4000} value={message} placeholder={t('reportPlaceholder')} onChange={(e) => setMessage(e.target.value)} />
        <div className="button-row">
          <button type="button" className="btn btn-plasma" disabled={sending.state === 'sending'} onClick={() => void send()}>
            {sending.state === 'sending' ? t('reportSending') : t('reportSend')}
          </button>
        </div>
        {sending.state === 'sent' && <p className="result ok">{sending.id ? t('reportSentId', { id: sending.id }) : t('reportSent')}</p>}
        {sending.state === 'failed' && <p className="result bad">{sending.code === 'report_unsupported' ? t('reportUnsupported') : errorText(t, sending.code)}</p>}
      </Group>
      <Group title={t('appLog')}>
        <p className="group-note">{t('appLogHint')}</p>
        <div className="button-row">
          <button type="button" className="btn btn-line btn-small" onClick={() => void loadLog()}>
            {log === null ? t('showLog') : t('refreshLog')}
          </button>
          <button type="button" className="btn btn-line btn-small" onClick={() => void copy()}>
            {copied ? t('copied') : t('copyLog')}
          </button>
          <button type="button" className="btn btn-line btn-small" onClick={() => void window.dc.saveLog()}>
            {t('saveLog')}
          </button>
          {profile.supportUrl && (
            <button type="button" className="btn btn-line btn-small" onClick={() => void window.dc.openExternal(profile.supportUrl ?? '')}>
              {t('support')}
            </button>
          )}
        </div>
        {log !== null && (
          <pre ref={view} className="log-view" dir="ltr">
            {log}
          </pre>
        )}
      </Group>
    </>
  );
}

function About({ t, profile }: Props) {
  return (
    <div className="about">
      <Mark />
      <Wordmark />
      <p className="muted">{t('aboutText')}</p>
      <p className="muted">
        {t('version')} <span dir="ltr">{__APP_VERSION__}</span>
      </p>
      {profile.supportUrl && (
        <button type="button" className="btn btn-line" onClick={() => void window.dc.openExternal(profile.supportUrl ?? '')}>
          {t('support')}
        </button>
      )}
    </div>
  );
}
