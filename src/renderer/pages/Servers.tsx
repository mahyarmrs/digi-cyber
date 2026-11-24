import { useMemo, useState } from 'react';

import { bestPing } from '../../shared/engines';
import type { AppProfile, Language, PingResult, Status } from '../../shared/types';
import { Flag } from '../components/Flag';
import { ChevronIcon, PulseIcon, SearchIcon } from '../components/Icons';
import { Ping } from '../components/Meters';
import type { Translate } from '../i18n';
import { groupLocations, locationLabel, type ProtocolFilter } from '../locations';

interface Props {
  t: Translate;
  lang: Language;
  profile: AppProfile;
  pings: PingResult[];
  status: Status;
  selected: number | null;
  pinging: boolean;
  onPing: () => void;
  onConnect: (locationId: number | null) => void;
}

const protocolNames: Record<string, string> = { xray: 'Xray', wireguard: 'WireGuard', openvpn: 'OpenVPN', l2tp: 'L2TP' };

// The locations beside the home page: search, a protocol filter, every country quickest first.
// A click connects; a country with several servers opens to list them.
export function Servers({ t, lang, profile, pings, status, selected, pinging, onPing, onConnect }: Props) {
  const [filter, setFilter] = useState<ProtocolFilter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupLocations(profile, pings, filter, query, lang), [profile, pings, filter, query, lang]);
  const available = useMemo(() => {
    const all = groupLocations(profile, [], 'all', '', lang).flatMap((g) => g.items.flatMap((i) => i.protocols));
    return (['xray', 'wireguard', 'openvpn', 'l2tp'] as ProtocolFilter[]).filter((p) => all.includes(p));
  }, [profile, lang]);
  const activeId = status.state === 'disconnected' ? null : (status.serverId ?? null);
  const chosen = activeId ?? selected;
  const toggle = (code: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <aside className="servers" aria-label={t('serversPanel')}>
      <div className="servers-head">
        <div className="servers-title">
          <h2>{t('serversPanel')}</h2>
          <button type="button" className="icon-btn" title={`${t('pingNow')}: ${t('pingHint')}`} aria-label={t('pingNow')} disabled={pinging} onClick={onPing}>
            <PulseIcon />
          </button>
        </div>
        <label className="search-field">
          <SearchIcon />
          <input className="field" value={query} placeholder={t('searchLocations')} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {available.length > 1 && (
          <div className="chips" role="radiogroup" aria-label={t('protocol')}>
            {(['all', ...available] as ProtocolFilter[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={filter === p} className={filter === p ? 'chip on' : 'chip'} onClick={() => setFilter(p)}>
                {p === 'all' ? t('all') : protocolNames[p]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="servers-list">
        {query.trim() === '' && (
          <button type="button" className={chosen === null && activeId === null ? 'srv on' : 'srv'} onClick={() => onConnect(null)}>
            <Flag code={null} size={34} />
            <span className="srv-name">
              <strong>{t('fastest')}</strong>
              <small>{t('auto')}</small>
            </span>
            <Ping ms={bestPing(profile, pings, null)} measuring={pinging} />
          </button>
        )}
        {groups.length === 0 && <div className="empty">{query ? t('noMatch') : t('noLocations')}</div>}
        {groups.map((g) => {
          if (g.items.length === 1) {
            const item = g.items[0];
            const id = item.location.id;
            return (
              <button key={id} type="button" className={chosen === id ? 'srv on' : 'srv'} onClick={() => onConnect(id)}>
                <Flag code={g.code} size={34} />
                <span className="srv-name">
                  <strong>{g.name || locationLabel(item.location, lang)}</strong>
                  <small>{item.location.city || t('oneServer')}</small>
                </span>
                {activeId === id && <span className="live-dot" title={t('connectedHere')} />}
                <Ping ms={item.ping} measuring={pinging} />
              </button>
            );
          }
          const expanded = open.has(g.code) || query.trim() !== '';
          const live = g.items.some((i) => i.location.id === activeId);
          return (
            <div key={g.code || 'other'}>
              <button type="button" className="srv" aria-expanded={expanded} onClick={() => toggle(g.code)}>
                <Flag code={g.code} size={34} />
                <span className="srv-name">
                  <strong>{g.name || locationLabel(g.items[0].location, lang)}</strong>
                  <small>{t('serverCount', { n: g.items.length })}</small>
                </span>
                {live && <span className="live-dot" title={t('connectedHere')} />}
                <Ping ms={g.items[0].ping} measuring={pinging} />
                <span className="srv-chev">
                  <ChevronIcon open={expanded} />
                </span>
              </button>
              {expanded &&
                g.items.map((item) => (
                  <button key={item.location.id} type="button" className={chosen === item.location.id ? 'srv nested on' : 'srv nested'} onClick={() => onConnect(item.location.id)}>
                    <span className="srv-name">
                      <strong>{item.location.city || locationLabel(item.location, lang)}</strong>
                    </span>
                    {activeId === item.location.id && <span className="live-dot" />}
                    <Ping ms={item.ping} measuring={pinging} />
                  </button>
                ))}
            </div>
          );
        })}
      </div>
      <div className="servers-foot">
        <span>{t('serverCount', { n: groups.reduce((n, g) => n + g.items.length, 0) })}</span>
        <button type="button" className="btn btn-quiet btn-small" disabled={pinging} onClick={onPing}>
          {pinging ? t('pinging') : t('pingNow')}
        </button>
      </div>
    </aside>
  );
}
