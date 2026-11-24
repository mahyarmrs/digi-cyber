import { createRoot } from 'react-dom/client';

import 'flag-icons/css/flag-icons.min.css';
import './styles/fonts.css';
import './styles/app.css';
import { useOs } from '../shared/engines';
import { App } from './App';

useOs(window.dc.os);
// The window's own errors go to the app's log, for a support report.
window.addEventListener('error', (e) => window.dc.log(`${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => window.dc.log(`unhandled: ${e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : String(e.reason)}`));
document.documentElement.dataset.os = window.dc.os;

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
