import type { Os } from '../../shared/platform';

export interface TunOptions {
  os: Os;
  // macOS names its tunnels utunN itself.
  interfaceName?: string;
  socksPort: number;
  strictRoute: boolean;
  dns?: string;
  // Program names whose traffic leaves directly (split tunneling).
  bypassApps?: string[];
}

// The engines' own sockets leave directly, or the tunnel would carry itself.
function engineProcesses(os: Os): string[] {
  return os === 'windows' ? ['xray.exe', 'sing-box.exe'] : ['xray', 'sing-box'];
}

export function singboxTunConfig(opts: TunOptions): Record<string, unknown> {
  return {
    log: { level: 'warn', timestamp: true },
    dns: {
      servers: [
        { type: 'tcp', tag: 'remote', server: opts.dns ?? '1.1.1.1', detour: 'proxy' },
        { type: 'local', tag: 'local' },
      ],
      final: 'remote',
      strategy: 'ipv4_only',
    },
    inbounds: [
      {
        type: 'tun',
        tag: 'tun-in',
        ...(opts.interfaceName ? { interface_name: opts.interfaceName } : {}),
        address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
        mtu: 9000,
        auto_route: true,
        strict_route: opts.strictRoute,
        stack: 'mixed',
      },
    ],
    outbounds: [
      { type: 'socks', tag: 'proxy', server: '127.0.0.1', server_port: opts.socksPort, version: '5' },
      { type: 'direct', tag: 'direct' },
    ],
    route: {
      rules: [
        { action: 'sniff' },
        { protocol: 'dns', action: 'hijack-dns' },
        { process_name: [...engineProcesses(opts.os), ...(opts.bypassApps ?? [])], outbound: 'direct' },
        { ip_is_private: true, outbound: 'direct' },
      ],
      final: 'proxy',
      auto_detect_interface: true,
      default_domain_resolver: 'local',
    },
  };
}
