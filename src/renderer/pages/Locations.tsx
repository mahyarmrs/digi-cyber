import { useEffect, useMemo, useState } from 'react';

import { bestPing } from '../../shared/engines';
import type { AppProfile, Language, PingResult, Status } from '../../shared/types';
import { Segmented } from '../components/Controls';
import { Flag } from '../components/Flag';
import { PulseIcon, SearchIcon } from '../components/Icons';
import { Ping } from '../components/Meters';
import type { Translate } from '../i18n';
import { countryName } from '../geo/geo';
import { groupLocations, locationLabel, type CountryGroup, type ProtocolFilter } from '../locations';

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
  onDisconnect: () => void;
}

const protocolNames: Record<string, string> = { xray: 'Xray', wireguard: 'WireGuard', openvpn: 'OpenVPN', l2tp: 'L2TP' };

// An atlas of two panes: countries on one side (searchable, filtered by protocol, quickest first),
// the chosen country's servers on the other.
export function Locations({ t, lang, profile, pings, status, selected, pinging, onPing, onConnect, onDisconnect }: Props) {
  const [filter, setFilter] = useState<ProtocolFilter>('all');
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupLocations(profile, pings, filter, query, lang), [profile, pings, filter, query, lang]);
  const activeId = status.state === 'disconnected' ? null : (status.serverId ?? null);
  const countryOf = (id: number | null) => (id === null ? null : (groups.find((g) => g.items.some((i) => i.location.id === id))?.code ?? null));
  // The country of the connection, else of the chosen location, else Fastest.
  const [open, setOpen] = useState<string | null>(() => countryOf(activeId) ?? countryOf(selected) ?? 'fastest');
  const available = useMemo(() => {
    const all = groupLocations(profile, [], 'all', '', lang).flatMap((g) => g.items.flatMap((i) => i.protocols));
    return (['xray', 'wireguard', 'openvpn', 'l2tp'] as ProtocolFilter[]).filter((p) => all.includes(p));
  }, [profile, lang]);

  // A search that leaves the open country out opens the first match.
  useEffect(() => {
    if (open === 'fastest' && query.trim() === '') return;
    if (!groups.some((g) => g.code === open) && groups.length > 0) setOpen(groups[0].code);
  }, [groups, open, query]);

  const current = groups.find((g) => g.code === open);
  const fastestMs = bestPing(profile, pings, null);

  return (
    <div className="atlas">
      <section className="index" aria-label={t('locations')}>
        <div className="index-head">
          <label className="search-field">
            <SearchIcon />
            <input className="field" value={query} placeholder={t('searchLocations')} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </label>
          {available.length > 1 && (
            <Segmented
              label={t('protocol')}
              value={filter}
              onChange={setFilter}
              options={[{ value: 'all', label: t('all') }, ...available.map((p) => ({ value: p, label: protocolNames[p] }))]}
            />
          )}
          <div className="index-tools">
            <span>{t('serverCount', { n: groups.reduce((n, g) => n + g.items.length, 0) })}</span>
            <button type="button" className="btn btn-quiet btn-small" title={t('pingHint')} disabled={pinging} onClick={onPing}>
              <PulseIcon />
              {pinging ? t('pinging') : t('pingNow')}
            </button>
          </div>
        </div>
        <div className="index-list">
          {query.trim() === '' && (
            <button type="button" className={open === 'fastest' ? 'country on' : 'country'} onClick={() => setOpen('fastest')}>
              <Flag code={null} size={32} />
              <span className="country-name">
                <strong>{t('fastest')}</strong>
                <small>{t('auto')}</small>
              </span>
              <Ping ms={fastestMs} measuring={pinging} />
            </button>
          )}
          {groups.length === 0 && <div className="empty">{query ? t('noMatch') : t('noLocations')}</div>}
          {groups.map((g) => {
            const live = activeId !== null && g.items.some((i) => i.location.id === activeId);
            return (
              <button key={g.code || 'other'} type="button" className={open === g.code ? 'country on' : 'country'} onClick={() => setOpen(g.code)}>
                <Flag code={g.code} size={32} />
                <span className="country-name">
                  <strong>{g.name || locationLabel(g.items[0].location, lang)}</strong>
                  <small>{g.items.length === 1 ? g.items[0].location.city || t('oneServer') : t('serverCount', { n: g.items.length })}</small>
                </span>
                {live && <span className="live-dot" title={t('connectedHere')} />}
                <Ping ms={g.items[0].ping} measuring={pinging} />
              </button>
            );
          })}
        </div>
      </section>

      <section className="detail">
        {open === 'fastest' && query.trim() === '' ? (
          <Fastest t={t} selected={selected} activeId={activeId} onConnect={onConnect} />
        ) : current ? (
          <Country t={t} lang={lang} group={current} activeId={activeId} selected={selected} pinging={pinging} onConnect={onConnect} onDisconnect={onDisconnect} />
        ) : (
          <div className="detail-empty">{t('pickCountry')}</div>
        )}
      </section>
    </div>
  );
}

function Fastest({ t, selected, activeId, onConnect }: { t: Translate; selected: number | null; activeId: number | null; onConnect: (id: number | null) => void }) {
  return (
    <div className="detail-head">
      <Flag code={null} size={64} />
      <div>
        <h1>{t('fastest')}</h1>
        <p>{t('fastestHint')}</p>
      </div>
      <button type="button" className={selected === null && activeId === null ? 'btn btn-line' : 'btn btn-plasma'} onClick={() => onConnect(null)}>
        {t('connectNow')}
      </button>
    </div>
  );
}

function Country(props: {
  t: Translate;
  lang: Language;
  group: CountryGroup;
  activeId: number | null;
  selected: number | null;
  pinging: boolean;
  onConnect: (id: number | null) => void;
  onDisconnect: () => void;
}) {
  const { t, lang, group, activeId, pinging, onConnect, onDisconnect } = props;
  const best = group.items[0];
  const title = group.name || locationLabel(best.location, lang);
  // The panel's own name for a server, when it says more than the country's name in either language.
  const plain = new Set([title, group.code ? countryName(group.code, 'en') : '', group.code ? countryName(group.code, 'fa') : ''].map((n) => n.toLowerCase()));
  const bestLive = activeId === best.location.id;
  return (
    <>
      <div className="detail-head">
        <Flag code={group.code} size={64} />
        <div>
          <h1>{title}</h1>
          <p>{group.items.length === 1 ? t('oneServer') : t('serverCount', { n: group.items.length })}</p>
        </div>
        {!bestLive && (
          <button type="button" className="btn btn-plasma" onClick={() => onConnect(best.location.id)}>
            {t('connectNow')}
          </button>
        )}
      </div>
      <div className="server-list">
        {group.items.map((item) => {
          const id = item.location.id;
          const live = activeId === id;
          const name = item.location.city || locationLabel(item.location, lang);
          const own = item.location.name && !plain.has(item.location.name.toLowerCase()) && item.location.name !== name ? item.location.name : '';
          return (
            <div key={id} className={live ? 'server on' : 'server'}>
              <div className="server-name">
                <strong>
                  {name}
                  {own && <span className="muted"> ({own})</span>}
                </strong>
                <span className="protos">
                  {item.protocols.map((p) => (
                    <span key={p} className="proto">
                      {protocolNames[p]}
                    </span>
                  ))}
                </span>
              </div>
              <Ping ms={item.ping} measuring={pinging} />
              {live ? (
                <button type="button" className="btn btn-line btn-small" onClick={onDisconnect}>
                  {t('disconnect')}
                </button>
              ) : (
                <button type="button" className="btn btn-line btn-small" onClick={() => onConnect(id)}>
                  {t('connectNow')}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
