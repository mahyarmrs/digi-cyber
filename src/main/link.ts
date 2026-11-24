// The app API answers under the subscription link itself, on any of its paths.
export function appApiBase(subLink: string): string {
  let url: URL;
  try {
    url = new URL(subLink.trim());
  } catch {
    throw new LinkError();
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new LinkError();
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '' || path.split('/').filter(Boolean).length === 0) throw new LinkError();
  return `${url.protocol}//${url.host}${path}/app/v1`;
}

// The subscription's summary as JSON (Manifold's ?format=info), which names its accounts.
export function subInfoUrl(subLink: string): string {
  appApiBase(subLink);
  const url = new URL(subLink.trim());
  url.searchParams.set('format', 'info');
  return url.toString();
}

export class LinkError extends Error {
  constructor() {
    super('not a subscription link');
    this.name = 'LinkError';
  }
}
