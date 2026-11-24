import { useEffect } from 'react';

import type { NoticeEntry } from '../../shared/notices';
import type { Language } from '../../shared/types';
import type { Translate } from '../i18n';
import { AlertIcon, CloseIcon, InfoIcon } from './Icons';

// Notices are written in Persian, so they are laid out right to left in Estedad in either language.
function NoticeText({ body }: { body: string }) {
  return (
    <p className="notice-text" dir="rtl" lang="fa">
      {body}
    </p>
  );
}

function noticeTime(createdAt: number | null, lang: Language): string {
  if (!createdAt) return '';
  return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(createdAt));
}

// Warning and critical notices as strips across the top of every page, until closed.
export function NoticeStrips({ t, notices, onClose }: { t: Translate; notices: NoticeEntry[]; onClose: (key: string) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="strips">
      {notices.map((n) => (
        <div key={n.key} className={`strip-notice ${n.level}`} dir="rtl" lang="fa" role="alert">
          <span className="strip-icon">
            <AlertIcon />
          </span>
          <NoticeText body={n.body} />
          <button type="button" className="icon-btn" aria-label={t('closeNotice')} title={t('closeNotice')} onClick={() => onClose(n.key)}>
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

// The bell's log, as a drawer from the window's edge.
export function NoticeDrawer({ t, lang, notices, onClose }: { t: Translate; lang: Language; notices: NoticeEntry[]; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={t('notices')}>
        <div className="drawer-head">
          <h2>{t('notices')}</h2>
          <button type="button" className="icon-btn" aria-label={t('closeNotice')} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="drawer-body">
          {notices.length === 0 ? (
            <div className="empty">{t('noticesEmpty')}</div>
          ) : (
            notices.map((n) => (
              <div key={n.key} className={`notice ${n.level}`}>
                <div className="notice-meta">
                  <span className={`notice-level ${n.level}`}>
                    {n.level === 'info' ? <InfoIcon /> : <AlertIcon />}
                    {n.key === 'announce' ? t('subscriptionNotice') : t(`level.${n.level}`)}
                  </span>
                  <span className="muted">{noticeTime(n.createdAt, lang)}</span>
                </div>
                <NoticeText body={n.body} />
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}

export function Toast({ text, kind }: { text: string; kind: 'ok' | 'bad' }) {
  return (
    <div className={`toast ${kind}`} role="status">
      {text}
    </div>
  );
}
