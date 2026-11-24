import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { bannerNotices, noticeLog, unreadNotices } from '../shared/notices';
import type { SignInCode } from '../shared/signin';
import type { Activity, AppProfile, PingResult, ProfileUpdate, Settings, Status } from '../shared/types';
import { BellIcon, ChartIcon, GearIcon, GlobeIcon, HelpIcon, HomeIcon, RefreshIcon } from './components/Icons';
import { Wordmark } from './components/Mark';
import { NoticeDrawer, NoticeStrips, Toast } from './components/Notices';
import { translator } from './i18n';
import { Home } from './pages/Home';
import { Locations } from './pages/Locations';
import { Servers } from './pages/Servers';
import { SettingsPage, type Section } from './pages/Settings';
import { Stats } from './pages/Stats';
import { Welcome } from './pages/Welcome';

type Page = 'home' | 'locations' | 'stats' | 'settings';

function useSystemDark(): boolean {
  const query = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const onChange = () => setDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [query]);
  return dark;
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'disconnected' });
  const [pings, setPings] = useState<PingResult[]>([]);
  const [activity, setActivity] = useState<Activity>({ days: {}, recents: [] });
  const [page, setPage] = useState<Page>('home');
  const [section, setSection] = useState<Section>('general');
  const [signOutReason, setSignOutReason] = useState('');
  const [showNotices, setShowNotices] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'bad' } | null>(null);
  const [signInCode, setSignInCode] = useState<SignInCode | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const systemDark = useSystemDark();

  const lang = settings?.language ?? 'fa';
  const t = useMemo(() => translator(lang), [lang]);
  const dark = settings?.theme === 'system' ? systemDark : settings?.theme !== 'light';

  useEffect(() => {
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
    document.documentElement.lang = lang;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [lang, dark]);

  const refreshPings = useCallback(async () => {
    setPinging(true);
    try {
      setPings(await window.dc.ping());
    } catch {
      // The previous results stay.
    } finally {
      setPinging(false);
    }
  }, []);

  const showToast = useCallback((text: string, kind: 'ok' | 'bad') => {
    setToast({ text, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const signedOut = useCallback((code: string) => {
    setProfile(null);
    setSignedIn(false);
    setSignOutReason(code);
  }, []);

  const applyUpdate = useCallback((update: ProfileUpdate | null) => {
    if (!update) return;
    setProfile(update.profile);
    setSignedIn(true);
    setFetchedAt(update.fetchedAt);
  }, []);

  // A fetch from the panel now; the main process also does this every 10 minutes by itself.
  const refreshNow = useCallback(
    async (manual: boolean) => {
      setRefreshing(true);
      try {
        const update = await window.dc.refresh();
        applyUpdate(update);
        if (manual && update) showToast(update.error ? t('refreshFailed') : t('refreshed'), update.error ? 'bad' : 'ok');
      } catch (err) {
        signedOut((err as Error).message);
      } finally {
        setRefreshing(false);
      }
    },
    [applyUpdate, showToast, signedOut, t],
  );

  const loadProfile = useCallback(async (force: boolean) => {
    try {
      const p = await window.dc.profile(force);
      setProfile(p);
      setSignedIn(p !== null);
    } catch (err) {
      setProfile(null);
      setSignedIn(false);
      setSignOutReason((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void window.dc.settings().then(setSettings);
    void window.dc.status().then(setStatus);
    void window.dc.activity().then(setActivity);
    void window.dc.session().then((s) => {
      if (!s) {
        setSignedIn(false);
        return;
      }
      void loadProfile(false).then(() => refreshNow(false));
    });
    const offStatus = window.dc.onStatus((s) => {
      setStatus(s);
      void window.dc.activity().then(setActivity);
    });
    const offProfile = window.dc.onProfile(applyUpdate);
    const offSignedOut = window.dc.onSignedOut(signedOut);
    return () => {
      offStatus();
      offProfile();
      offSignedOut();
    };
  }, [loadProfile, applyUpdate, signedOut]);

  // A digicyber:// link the app was opened with: signed out it signs in; signed in to another subscription, it asks first.
  useEffect(() => {
    if (signedIn === null || !settings) return;
    const take = async () => {
      const code = await window.dc.takeSignIn();
      if (!code) return;
      if (signedIn) {
        const session = await window.dc.session();
        if (session && session.subLink.trim() === code.subLink) return;
        if (!window.confirm(translator(settings.language)('switchAccount', { user: session?.username ?? '' }))) return;
        await window.dc.disconnect();
        await window.dc.logout();
        signedOut('');
      }
      setSignInCode(code);
    };
    void take();
    return window.dc.onSignInLink(() => void take());
  }, [signedIn, settings, signedOut]);

  useEffect(() => {
    if (!signedIn) return;
    void refreshPings();
    const timer = setInterval(() => void refreshPings(), 60_000);
    return () => clearInterval(timer);
  }, [signedIn, profile, refreshPings]);

  const log = useMemo(() => (profile ? noticeLog(profile) : []), [profile]);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setSettings(await window.dc.saveSettings(patch));
  }, []);

  if (!settings || signedIn === null) return <div className="splash" />;

  if (!signedIn || !profile) {
    return (
      <Welcome
        t={t}
        settings={settings}
        reason={signOutReason}
        code={signInCode}
        onLanguage={(language) => void saveSettings({ language })}
        onSignedIn={(p) => {
          setSignInCode(null);
          setProfile(p);
          setSignedIn(true);
          setSignOutReason('');
          setFetchedAt(Date.now());
          setPage('home');
        }}
      />
    );
  }

  const connectTo = async (locationId: number | null) => {
    setSettings({ ...settings, locationId });
    if (page !== 'stats') setPage('home');
    setStatus(await window.dc.connect(locationId));
  };
  const disconnect = () => void window.dc.disconnect().then(setStatus);
  const openSettings = (s: Section) => {
    setSection(s);
    setPage('settings');
  };
  const strips = bannerNotices(log, settings.dismissedNotices);
  const unread = unreadNotices(log, { seenId: settings.seenNoticeId, seenAnnounce: settings.seenAnnounce });
  const openNotices = () => {
    setShowNotices(true);
    if (unread > 0) {
      const seenNoticeId = Math.max(settings.seenNoticeId, ...log.map((n) => n.id));
      void saveSettings({ seenNoticeId, seenAnnounce: profile.announce?.trim() ?? '' });
    }
  };
  const closeStrip = (key: string) => void saveSettings({ dismissedNotices: [...settings.dismissedNotices.filter((k) => log.some((n) => n.key === k)), key] });
  const timeFormat = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const refreshTitle = fetchedAt ? `${t('refreshSub')} (${t('updatedAt', { time: timeFormat.format(new Date(fetchedAt)) })})` : t('refreshSub');
  const nav: [Page, () => ReactElement, string][] = [
    ['home', HomeIcon, t('navHome')],
    ['locations', GlobeIcon, t('locations')],
    ['stats', ChartIcon, t('statistics')],
    ['settings', GearIcon, t('settings')],
  ];
  const a = profile.account;
  const withServers = page === 'home' || page === 'stats';

  return (
    <div className="shell">
      <header className="strip">
        <Wordmark />
      </header>

      <nav className="side" aria-label={t('appName')}>
        {nav.map(([key, Icon, label]) => (
          <button key={key} type="button" className={page === key ? 'nav-btn on' : 'nav-btn'} aria-current={page === key ? 'page' : undefined} onClick={() => setPage(key)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
        <button type="button" className="nav-btn" onClick={openNotices}>
          <BellIcon />
          <span>{t('notices')}</span>
          {unread > 0 && <span className="count">{unread > 9 ? '9+' : unread}</span>}
        </button>
        <div className="side-spacer" />
        <div className="side-tools">
          <button type="button" className={refreshing ? 'icon-btn spinning' : 'icon-btn'} aria-label={t('refreshSub')} title={refreshTitle} disabled={refreshing} onClick={() => void refreshNow(true)}>
            <RefreshIcon />
          </button>
          {profile.supportUrl && (
            <button type="button" className="icon-btn" aria-label={t('support')} title={t('support')} onClick={() => void window.dc.openExternal(profile.supportUrl ?? '')}>
              <HelpIcon />
            </button>
          )}
        </div>
        <button type="button" className={page === 'settings' && section === 'account' ? 'me on' : 'me'} title={t('manageAccount')} onClick={() => openSettings('account')}>
          <span className="avatar">{a.username.trim().charAt(0) || '?'}</span>
          <span className="me-text">
            <strong dir="ltr">{a.username}</strong>
            <small>{a.enabled ? t('active') : t('inactive')}</small>
          </span>
        </button>
      </nav>

      <main className="main" style={withServers ? undefined : { gridColumn: '2 / -1' }}>
        <NoticeStrips t={t} notices={strips} onClose={closeStrip} />
        {page === 'home' && (
          <Home
            t={t}
            lang={lang}
            profile={profile}
            status={status}
            settings={settings}
            pings={pings}
            activity={activity}
            onConnect={(id) => void connectTo(id)}
            onDisconnect={disconnect}
            onLocations={() => setPage('locations')}
            onOpenSettings={openSettings}
            onChange={(patch) => void saveSettings(patch)}
          />
        )}
        {page === 'stats' && <Stats t={t} lang={lang} profile={profile} pings={pings} activity={activity} onConnect={(id) => void connectTo(id)} />}
        {page === 'locations' && (
          <Locations
            t={t}
            lang={lang}
            profile={profile}
            pings={pings}
            status={status}
            selected={settings.locationId}
            pinging={pinging}
            onPing={() => void refreshPings()}
            onConnect={(id) => void connectTo(id)}
            onDisconnect={disconnect}
          />
        )}
        {page === 'settings' && (
          <SettingsPage
            t={t}
            settings={settings}
            profile={profile}
            section={section}
            onSection={setSection}
            onChange={(patch) => void saveSettings(patch)}
            onRefresh={() => void refreshNow(true)}
            onLogout={() =>
              void window.dc.logout().then(() => {
                setProfile(null);
                setSignedIn(false);
              })
            }
          />
        )}
      </main>
      {withServers && (
        <Servers
          t={t}
          lang={lang}
          profile={profile}
          pings={pings}
          status={status}
          selected={settings.locationId}
          pinging={pinging}
          onPing={() => void refreshPings()}
          onConnect={(id) => void connectTo(id)}
        />
      )}
      {showNotices && <NoticeDrawer t={t} lang={lang} notices={log} onClose={() => setShowNotices(false)} />}
      {toast && <Toast text={toast.text} kind={toast.kind} />}
    </div>
  );
}
