import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { lastDays } from '../../shared/activity';
import { bestPing } from '../../shared/engines';
import type { Activity, AppAccount, AppLocation, AppProfile, Language, PingResult, Settings, Status } from '../../shared/types';
import { usageOf } from '../../shared/usage';
import { Switch } from '../components/Controls';
import { Flag } from '../components/Flag';
import { BlockIcon, ChevronIcon, EyeOffIcon, LockIcon, PinIcon, ShieldIcon } from '../components/Icons';
import { Mark } from '../components/Mark';
import { Ping } from '../components/Meters';
import { bytes, clock, daysLeft, spent } from '../format';
import { errorText, type Translate } from '../i18n';
import { locationLabel } from '../locations';
import type { Section } from './Settings';

interface Props {
  t: Translate;
  lang: Language;
  profile: AppProfile;
  status: Status;
  settings: Settings;
  pings: PingResult[];
  activity: Activity;
  onConnect: (locationId: number | null) => void;
  onDisconnect: () => void;
  onLocations: () => void;
  onOpenSettings: (section: Section) => void;
  onChange: (patch: Partial<Settings>) => void;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export const protocolNames: Record<string, string> = {
  vless: 'VLESS',
  vmess: 'VMess',
  trojan: 'Trojan',
  shadowsocks: 'Shadowsocks',
  hysteria: 'Hysteria',
  hysteria2: 'Hysteria 2',
  wireguard: 'WireGuard',
  openvpn: 'OpenVPN',
  l2tp: 'L2TP/IPsec',
};

const iso = (s: string | number) => '⁨' + String(s) + '⁩';

// Home: the connection in one card, then the plan, the week and the switches people reach for most.
export function Home(props: Props) {
  const { t } = props;
  return (
    <div className="page">
      <Hero {...props} />
      <div className="cards">
        <PlanCard t={t} account={props.profile.account} onOpen={() => props.onOpenSettings('account')} />
        <WeekCard t={t} lang={props.lang} activity={props.activity} />
      </div>
      <Protection t={t} settings={props.settings} onChange={props.onChange} />
    </div>
  );
}

function Hero({ t, lang, profile, status, settings, pings, onConnect, onDisconnect, onLocations, onOpenSettings }: Props) {
  const connected = status.state === 'connected';
  const busy = status.state === 'connecting' || status.state === 'disconnecting';
  const now = useNow(connected);
  const byId = useMemo(() => new Map(profile.locations.map((l) => [l.id, l])), [profile]);
  const live = status.state !== 'disconnected' || Boolean(status.blocking);
  const shownId = live ? (status.serverId ?? status.locationId ?? null) : settings.locationId;
  const shown: AppLocation | undefined = shownId === null ? undefined : byId.get(shownId);
  const place = shown ? locationLabel(shown, lang) : t('fastest');
  const city = shown?.city && shown.city !== place ? shown.city : '';
  const ms = bestPing(profile, pings, live ? (status.serverId ?? null) : settings.locationId);
  const protocol = live && status.protocol ? (protocolNames[status.protocol] ?? status.protocol.toUpperCase()) : settings.protocol === 'auto' ? t('auto') : (protocolNames[settings.protocol] ?? settings.protocol);

  const kind = status.blocking ? 'holding' : connected ? 'live' : busy ? 'busy' : 'idle';
  const title = status.blocking ? t('coreHolding') : connected ? t('coreProtected') : status.state === 'connecting' ? t('connecting') : status.state === 'disconnecting' ? t('disconnecting') : t('coreUnprotected');
  const line = status.blocking ? t('heroHolding') : connected ? t('heroLive') : t('heroIdle');

  return (
    <section className={`hero ${kind}`} aria-live="polite">
      <Mark className="mark hero-mark" />
      <div className="hero-top">
        <span className={`badge ${kind === 'busy' ? 'busy' : kind === 'holding' ? 'holding' : ''}`}>
          <ShieldIcon off={!connected && !busy} />
        </span>
        <div className="hero-state">
          <h1>{title}</h1>
          <p>{line}</p>
        </div>
        {connected && status.since ? <span className="hero-timer">{clock(now - status.since)}</span> : null}
      </div>

      <button type="button" className="hero-place" title={t('changeLocation')} onClick={onLocations}>
        <Flag code={shown ? shown.countryCode || '' : null} size={36} />
        <span className="hero-place-text">
          <strong>{place}</strong>
          <small>{city || t('changeLocation')}</small>
        </span>
        <ChevronIcon />
      </button>

      <div className="hero-bottom">
        <div className="facts">
          <div className="fact">
            <span>{t('protocol')}</span>
            <strong dir="ltr">{protocol}</strong>
          </div>
          <div className="fact">
            <span>{t('pingLabel')}</span>
            <strong>
              <Ping ms={ms} />
            </strong>
          </div>
          {live && status.address && (
            <div className="fact">
              <span>{t('tunnelAddress')}</span>
              <strong dir="ltr" className="num">
                {status.address}
              </strong>
            </div>
          )}
        </div>
        {connected || status.blocking ? (
          <button type="button" className={connected ? 'btn btn-glass btn-wide' : 'btn btn-line btn-wide'} onClick={onDisconnect}>
            {t('disconnect')}
          </button>
        ) : status.state === 'connecting' ? (
          <button type="button" className="btn btn-line btn-wide" onClick={onDisconnect}>
            {t('cancel')}
          </button>
        ) : (
          <button type="button" className="btn btn-plasma btn-wide" disabled={busy} onClick={() => onConnect(settings.locationId)}>
            {t('quickConnect')}
          </button>
        )}
      </div>

      {!status.blocking && status.error && (
        <p className="hero-alert bad">
          <span>{errorText(t, status.error)}</span>
          {(status.error === 'all_failed' || status.error === 'connection_lost') && (
            <button type="button" className="link" onClick={() => onOpenSettings('support')}>
              {t('reportShort')}
            </button>
          )}
        </p>
      )}
      {status.notice && <p className="hero-alert warn">{t(`notice.${status.notice}`)}</p>}
    </section>
  );
}

function expiryOf(t: Translate, a: AppAccount, now = Date.now()): string {
  if (a.expiryTime > 0 && a.expiryTime <= now) return t('expiredPlan');
  if (a.expiryTime > 0 && a.expiryTime - now < 86_400_000) return t('hoursLeft');
  if (a.expiryTime > 0) return t('daysLeft', { n: iso(daysLeft(a.expiryTime, now)) });
  if (a.expiryTime < 0) return t('firstUse');
  return t('never');
}

function PlanCard({ t, account, onOpen }: { t: Translate; account: AppAccount; onOpen: () => void }) {
  const u = usageOf(account);
  return (
    <button type="button" className="card clickable" onClick={onOpen}>
      <div className="card-head">
        <h3>{t('planLabel')}</h3>
        <span className={account.enabled ? 'pill ok' : 'pill bad'}>{account.enabled ? t('active') : t('inactive')}</span>
      </div>
      <div className="big">
        {u.total > 0 ? (
          <>
            <span dir="ltr">{bytes(u.used)}</span> <small>{t('usedOf', { used: '', total: iso(bytes(u.total)) }).trim()}</small>
          </>
        ) : (
          <>
            <span dir="ltr">{bytes(u.used)}</span> <small>{t('unlimitedTraffic')}</small>
          </>
        )}
      </div>
      <div className={u.percent === null ? 'bar-track unlimited' : 'bar-track'} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={u.percent ?? undefined}>
        <div className={`bar-fill ${u.level === 'ok' ? '' : u.level === 'warn' ? 'warn' : 'bad'}`} style={{ width: `${u.percent ?? 100}%` }} />
      </div>
      <div className="card-foot">
        <span>{expiryOf(t, account)}</span>
        {u.left !== null && <span>{t('trafficLeft', { n: iso(bytes(u.left)) })}</span>}
        {account.deviceLimit > 0 && <span>{`${t('devices')}: ${t('devicesOf', { n: iso(account.devices), max: iso(account.deviceLimit) })}`}</span>}
      </div>
    </button>
  );
}

function WeekCard({ t, lang, activity }: { t: Translate; lang: Language; activity: Activity }) {
  const days = lastDays(activity, 7);
  const max = Math.max(3600, ...days.map((d) => d.seconds));
  const total = days.reduce((s, d) => s + d.seconds, 0);
  const weekday = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { weekday: lang === 'fa' ? 'narrow' : 'short' });
  return (
    <section className="card">
      <div className="card-head">
        <h3>{t('timeConnected')}</h3>
        <span className="muted">{t('thisWeek')}</span>
      </div>
      <div className="big">{spent(t, total)}</div>
      <div className="week-bars">
        {days.map((d, i) => (
          <div key={d.key} className={i === days.length - 1 ? 'week-bar today' : 'week-bar'} title={spent(t, d.seconds)}>
            <i style={{ height: `${Math.max(4, (d.seconds / max) * 100)}%` }} />
            <span>{weekday.format(new Date(`${d.key}T12:00:00`))}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// The switches people reach for most, right on the page; the rest live in settings.
function Protection({ t, settings, onChange }: { t: Translate; settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const items: { key: keyof Settings; label: string; hint: string; Icon: () => ReactElement }[] = [
    { key: 'killSwitch', label: t('killSwitch'), hint: 'Xray, WireGuard', Icon: LockIcon },
    { key: 'adBlock', label: t('adBlock'), hint: 'Xray, WireGuard', Icon: BlockIcon },
    { key: 'iranDirect', label: t('iranDirect'), hint: 'Xray, WireGuard', Icon: PinIcon },
    window.dc.os !== 'macos'
      ? { key: 'webrtcProtection', label: t('webrtc'), hint: 'Chrome, Edge, Brave', Icon: EyeOffIcon }
      : { key: 'timezoneSpoof', label: t('timezone'), hint: 'macOS', Icon: EyeOffIcon },
  ];
  return (
    <section className="card">
      <div className="card-head">
        <h3>{t('quickProtection')}</h3>
      </div>
      <div className="toggles">
        {items.map(({ key, label, hint, Icon }) => {
          const on = Boolean(settings[key]);
          return (
            <div key={key} className={on ? 'toggle on' : 'toggle'}>
              <span className="toggle-icon">
                <Icon />
              </span>
              <span className="toggle-text">
                <strong>{label}</strong>
                <small dir="ltr">{hint}</small>
              </span>
              <Switch label={label} checked={on} onChange={(v) => onChange({ [key]: v } as Partial<Settings>)} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
