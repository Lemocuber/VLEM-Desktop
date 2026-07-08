export type Mode = 'system' | 'tun';
export type Routing = 'smart' | 'global';
export type RunState = 'stopped' | 'starting' | 'running' | 'stopping';
export type FetchState = 'setup' | 'loading' | 'authorized' | 'unauthorized' | 'error';

export type VlemNode = {
  name: string;
  link: string;
  host: string;
  port: number;
  delay: number | null;
};

export type Subscription = {
  expires: string;
  nodes: VlemNode[];
};

export type PersistedState = {
  apiBase: string;
  clientId: string;
  mode: Mode;
  routing: Routing;
};

export type NativeStartRequest = {
  link: string;
  mode: Mode;
  routing: Routing;
  socksPort: number;
  httpPort: number;
};
