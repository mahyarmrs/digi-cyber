import type { DcApi } from '../shared/types';

declare global {
  interface Window {
    dc: DcApi;
  }
}

declare global {
  const __APP_VERSION__: string;
}
