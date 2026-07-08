import type { Mode, PersistedState, Routing, Subscription, VlemNode } from './types';

const keys = {
  apiBase: 'vlem.apiBase',
  clientId: 'vlem.clientId',
  mode: 'vlem.mode',
  routing: 'vlem.routing'
};

export const ports = {
  socks: 14508,
  http: 14509
};

export const modeLabel: Record<Mode, string> = {
  system: 'System proxy',
  tun: 'TUN'
};

export const routingLabel: Record<Routing, string> = {
  smart: 'Smart',
  global: 'Global'
};

export const normalizeBaseUrl = (value: string) => {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Enter the backend URL.');
  const url = new URL(trimmed);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an http or https URL.');
  return url.toString().replace(/\/+$/, '');
};

export const newClientId = () =>
  crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');

export const loadState = (): PersistedState => {
  const mode = localStorage.getItem(keys.mode);
  const routing = localStorage.getItem(keys.routing);
  let clientId = localStorage.getItem(keys.clientId);
  if (!clientId) {
    clientId = newClientId();
    localStorage.setItem(keys.clientId, clientId);
  }
  return {
    apiBase: localStorage.getItem(keys.apiBase) || '',
    clientId,
    mode: mode === 'tun' ? 'tun' : 'system',
    routing: routing === 'global' ? 'global' : 'smart'
  };
};

export const saveApiBase = (apiBase: string) => {
  const next = normalizeBaseUrl(apiBase);
  localStorage.setItem(keys.apiBase, next);
  return next;
};
export const saveMode = (mode: Mode) => localStorage.setItem(keys.mode, mode);
export const saveRouting = (routing: Routing) => localStorage.setItem(keys.routing, routing);

export const authUrl = (apiBase: string, clientId: string) =>
  `${normalizeBaseUrl(apiBase)}/auth/${encodeURIComponent(clientId)}`;

export const parseVless = (line: string): VlemNode | null => {
  if (!line.startsWith('vless://')) return null;
  try {
    const url = new URL(line);
    if (url.protocol !== 'vless:' || !url.username || !url.hostname) return null;
    const port = Number(url.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    const name = decodeURIComponent(url.hash.replace(/^#/, '')) || url.hostname;
    return { name, link: line, host: url.hostname, port, delay: null };
  } catch {
    return null;
  }
};

export const parseSubscription = (body: string): Subscription | null => {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const first = lines[0]?.match(/^EXPIRES\s+(.+)$/i);
  if (!first) return null;
  const expires = first[1];
  const nodes = lines.slice(1).map(parseVless).filter((node): node is VlemNode => Boolean(node));
  return nodes.length ? { expires, nodes } : null;
};

export const fetchAlert = async (apiBase: string) => {
  const res = await fetch(`${normalizeBaseUrl(apiBase)}/alert`, { cache: 'no-store' });
  if (!res.ok) return '';
  return (await res.text()).trim();
};

export const fetchSubscription = async (apiBase: string, clientId: string) => {
  const res = await fetch(`${normalizeBaseUrl(apiBase)}/sub/${encodeURIComponent(clientId)}`, { cache: 'no-store' });
  if (res.status === 418) return null;
  if (!res.ok) throw new Error(`Subscription fetch failed with HTTP ${res.status}.`);
  return parseSubscription(await res.text());
};

export const formatExpiry = (expires: string) => {
  const date = new Date(expires);
  return Number.isNaN(date.getTime())
    ? expires
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};
