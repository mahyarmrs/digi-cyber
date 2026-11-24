import dns from 'node:dns';

// Looks the names up with the system's resolver, before the tunnel is up: IPv4 when there is one,
// IPv6 otherwise. A name that does not resolve is left out, and Xray tries it itself.
export async function resolveNames(names: string[], timeoutMs = 6000, lookup = dns.promises.lookup): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  await Promise.all(
    names.map(async (name) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        const found = await Promise.race([
          lookup(name, { all: true, verbatim: true }),
          new Promise<never>((_r, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
          }),
        ]);
        const v4 = found.filter((a) => a.family === 4).map((a) => a.address);
        const v6 = found.filter((a) => a.family === 6).map((a) => a.address);
        const ips = [...new Set(v4.length > 0 ? v4 : v6)];
        if (ips.length > 0) out[name] = ips;
      } catch {
        // Unresolved: left to Xray.
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return out;
}
