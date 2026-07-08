import { describe, expect, it, vi } from 'vitest';
import { authUrl, normalizeBaseUrl, parseSubscription, parseVless } from './vlem';

describe('VLEM parsing', () => {
  it('normalizes backend URLs', () => {
    expect(normalizeBaseUrl(' https://example.com/// ')).toBe('https://example.com');
    expect(() => normalizeBaseUrl('file:///tmp/sub')).toThrow(/http/);
  });

  it('builds admin auth URLs', () => {
    expect(authUrl('https://example.com/', 'id one')).toBe('https://example.com/auth/id%20one');
  });

  it('parses VLESS Reality links', () => {
    const node = parseVless('vless://uuid@example.com:443?type=tcp&security=reality&flow=xtls-rprx-vision&pbk=abc&fp=chrome&sni=www.cloudflare.com&sid=01#Tokyo%201');
    expect(node).toMatchObject({ name: 'Tokyo 1', host: 'example.com', port: 443, delay: null });
  });

  it('drops unsupported or malformed subscription lines', () => {
    const sub = parseSubscription([
      'EXPIRES 2026-08-01T12:00:00.000Z',
      'trojan://ignored',
      'vless://uuid@host.test:8443?type=tcp&security=reality#Node'
    ].join('\n'));
    expect(sub?.expires).toBe('2026-08-01T12:00:00.000Z');
    expect(sub?.nodes).toHaveLength(1);
  });

  it('requires an expiry header and at least one node', () => {
    expect(parseSubscription('vless://uuid@host.test:443#Node')).toBeNull();
    expect(parseSubscription('EXPIRES 2026-08-01T12:00:00.000Z')).toBeNull();
  });
});
