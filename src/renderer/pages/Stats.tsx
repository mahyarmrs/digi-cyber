import { useMemo } from 'react';

import { lastDays } from '../../shared/activity';
import { bestPing, usableLocationIds } from '../../shared/engines';
import type { Activity, AppLocation, AppProfile, Language, PingResult } from '../../shared/types';
import { usageOf } from '../../shared/usage';
import { Flag } from '../components/Flag';
import { ArrowDownIcon, ArrowUpIcon } from '../components/Icons';
import { Ping } from '../components/Meters';
import { bytes, daysLeft, spent } from '../format';
import { countryName } from '../geo/geo';
import type { Translate } from '../i18n';
import { locationLabel } from '../locations';

interface Props {
  t: Translate;
  lang: Language;
  profile: AppProfile;
  pings: PingResult[];
  activity: Activity;
  onConnect: (locationId: number | null) => void;
}

const iso = (s: string | number) => '⁨' + String(s) + '⁩';

// Statistics: the plan's traffic in detail, the last 30 days connected and the recent locations.
export function Stats({ t, lang, profile, pings, activity, onConnect }: Props) {
  const a = profile.account;
  const u = usageOf(a);
  const month = lastDays(activity, 30);
  const max = Math.max(3600, ...month.map((d) => d.seconds));
  const total = month.reduce((s, d) => s + d.seconds, 0);
  const used = month.filter((d) => d.seconds > 0).length;
  const usable = useMemo(() => new Set(usableLocationIds(profile)), [profile]);
  const byId = useMemo(() => new Map(profile.locations.map((l) => [l.id, l])), [profile]);
  const recents = activity.recents.filter((id): id is number => id !== null && usable.has(id) && byId.has(id));
  const day = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { day: 'numeric', month: 'short' });

  return (
    <div className="page">
      <h1 className="page-title">{t('statistics')}</h1>
      <section className="card">
        <div className="card-head">
          <h3>{t('totalTraffic')}</h3>
          <span className="muted">{u.total > 0 ? t('usedOf', { used: iso(bytes(u.used)), total: iso(bytes(u.total)) }) : t('unlimitedTraffic')}</span>
        </div>
        <div className={u.percent === null ? 'bar-track unlimited' : 'bar-track'}>
          <div className={`bar-fill ${u.level === 'ok' ? '' : u.level === 'warn' ? 'warn' : 'bad'}`} style={{ width: `${u.percent ?? 100}%` }} />
        </div>
        <div className="figures">
          <div className="figure">
            <span>
              <ArrowDownIcon /> {t('downloaded')}
            </span>
            <strong dir="ltr">{bytes(a.download)}</strong>
          </div>
          <div className="figure">
            <span>
              <ArrowUpIcon /> {t('uploaded')}
            </span>
            <strong dir="ltr">{bytes(a.upload)}</strong>
          </div>
          <div className="figure">
            <span>{u.left !== null ? t('remaining') : t('timeLeft')}</span>
            <strong dir="ltr">{u.left !== null ? bytes(u.left) : a.expiryTime > 0 ? `${daysLeft(a.expiryTime)} d` : '∞'}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>{t('last30')}</h3>
          <span className="muted">
            {t('hoursConnected')}: {spent(t, total)}
            {used > 0 ? ` (${t('dailyAverage')}: ${spent(t, total / used)})` : ''}
          </span>
        </div>
        <div className="month-bars">
          {month.map((d, i) => (
            <i key={d.key} className={i === month.length - 1 ? 'today' : ''} style={{ height: `${Math.max(2, (d.seconds / max) * 100)}%` }} title={`${day.format(new Date(`${d.key}T12:00:00`))}: ${spent(t, d.seconds)}`} />
          ))}
        </div>
        <div className="card-foot">
          <span>{day.format(new Date(`${month[0].key}T12:00:00`))}</span>
          <span>{day.format(new Date(`${month[month.length - 1].key}T12:00:00`))}</span>
        </div>
      </section>

      {recents.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>{t('favouriteLocations')}</h3>
          </div>
          <div className="recent-list">
            {recents.map((id) => {
              const l = byId.get(id) as AppLocation;
              return (
                <button key={id} type="button" className="recent" onClick={() => onConnect(id)}>
                  <Flag code={l.countryCode} size={34} />
                  <span className="srv-name">
                    <strong>{l.countryCode ? countryName(l.countryCode, lang) : locationLabel(l, lang)}</strong>
                    <small>{l.city || locationLabel(l, lang)}</small>
                  </span>
                  <Ping ms={bestPing(profile, pings, id)} />
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
