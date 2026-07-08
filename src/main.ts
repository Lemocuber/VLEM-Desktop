import QRCode from 'qrcode';
import { Activity, AlertTriangle, Cable, Power, RefreshCw, Save, ShieldCheck, createElement, type IconNode } from 'lucide';
import './styles.css';
import type { FetchState, Mode, Routing, RunState, Subscription, VlemNode } from './types';
import { authUrl, fetchAlert, fetchSubscription, formatExpiry, loadState, modeLabel, ports, routingLabel, saveApiBase, saveMode, saveRouting } from './vlem';
import { native } from './native';

type AppState = ReturnType<typeof loadState> & {
  alert: string;
  error: string;
  fetchState: FetchState;
  runState: RunState;
  subscription: Subscription | null;
  selectedNode: string;
};

const app = document.querySelector<HTMLDivElement>('#app')!;
const state: AppState = {
  ...loadState(),
  alert: '',
  error: '',
  fetchState: 'setup',
  runState: 'stopped',
  subscription: null,
  selectedNode: ''
};

let pollTimer = 0;
let hourlyTimer = 0;

const iconMap = { Activity, AlertTriangle, Cable, Power, RefreshCw, Save, ShieldCheck } satisfies Record<string, IconNode>;
type IconName = keyof typeof iconMap;

const icon = (name: IconName, label: string) => {
  const span = document.createElement('span');
  span.className = 'icon';
  span.ariaHidden = 'true';
  const svg = createElement(iconMap[name]);
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('stroke-width', '2');
  span.append(svg);
  span.title = label;
  return span;
};

const button = (label: string, iconName: IconName, className = '') => {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.append(icon(iconName, label), document.createTextNode(label));
  return el;
};

const setState = (patch: Partial<AppState>) => {
  Object.assign(state, patch);
  render();
};

const refreshSubscription = async (forceStopOnLoss = false) => {
  if (!state.apiBase) return setState({ fetchState: 'setup' });
  setState({ fetchState: 'loading', error: '' });
  try {
    const subscription = await fetchSubscription(state.apiBase, state.clientId);
    if (!subscription) {
      if (forceStopOnLoss) await stopProxy();
      setState({ fetchState: 'unauthorized', subscription: null, selectedNode: '' });
      startAuthPolling();
      return;
    }
    window.clearInterval(pollTimer);
    setState({
      fetchState: 'authorized',
      subscription,
      selectedNode: subscription.nodes[0]?.link || ''
    });
  } catch (error) {
    setState({ fetchState: 'error', error: error instanceof Error ? error.message : 'Fetch failed.' });
  }
};

const launch = async () => {
  if (!state.apiBase) return render();
  setState({ fetchState: 'loading' });
  try {
    const alert = await fetchAlert(state.apiBase);
    if (alert) state.alert = alert;
  } catch {
    state.alert = '';
  }
  await refreshSubscription();
  window.clearInterval(hourlyTimer);
  hourlyTimer = window.setInterval(() => refreshSubscription(true), 60 * 60 * 1000);
};

const startAuthPolling = () => {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => refreshSubscription(false), 10_000);
};

const stopProxy = async () => {
  if (state.runState === 'stopped' || state.runState === 'stopping') return;
  setState({ runState: 'stopping', error: '' });
  try {
    await native.stopProxy();
    setState({ runState: 'stopped' });
  } catch (error) {
    setState({ runState: 'running', error: error instanceof Error ? error.message : 'Stop failed.' });
  }
};

const startProxy = async () => {
  const node = state.subscription?.nodes.find((item) => item.link === state.selectedNode);
  if (!node || state.runState !== 'stopped') return;
  setState({ runState: 'starting', error: '' });
  try {
    await native.startProxy({
      link: node.link,
      mode: state.mode,
      routing: state.routing,
      socksPort: ports.socks,
      httpPort: ports.http
    });
    setState({ runState: 'running' });
  } catch (error) {
    setState({ runState: 'stopped', error: error instanceof Error ? error.message : 'Start failed.' });
  }
};

const measureNodes = async () => {
  const subscription = state.subscription;
  if (!subscription) return;
  setState({ error: '' });
  const nodes = await Promise.all(subscription.nodes.map(async (node) => ({
    ...node,
    delay: await native.measureDelay(node.link)
  })));
  setState({ subscription: { ...subscription, nodes } });
};

const renderSetup = () => {
  const wrap = document.createElement('section');
  wrap.className = 'setup';
  const form = document.createElement('form');
  const h1 = document.createElement('h1');
  h1.textContent = 'VLEM';
  const input = document.createElement('input');
  input.name = 'apiBase';
  input.placeholder = 'https://vlem.example.com';
  input.setAttribute('autocomplete', 'url');
  input.inputMode = 'url';
  input.value = state.apiBase;
  const submit = button('Save', 'Save');
  form.append(h1, input, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const apiBase = new FormData(form).get('apiBase')?.toString() || '';
      const next = saveApiBase(apiBase);
      setState({ apiBase: next, error: '' });
      void launch();
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : 'Invalid URL.' });
    }
  });
  const note = document.createElement('p');
  note.textContent = 'Enter the VLEM backend URL once. This device will generate its own client id.';
  wrap.append(form, note);
  return wrap;
};

const renderAuth = () => {
  const wrap = document.createElement('section');
  wrap.className = 'auth';
  const h2 = document.createElement('h2');
  h2.textContent = 'Let Admin scan to auth';
  const canvas = document.createElement('canvas');
  void QRCode.toCanvas(canvas, authUrl(state.apiBase, state.clientId), { margin: 1, width: 220, color: { dark: '#111615', light: '#f8f3e7' } });
  const id = document.createElement('code');
  id.textContent = state.clientId;
  const retry = button('Check', 'RefreshCw');
  retry.addEventListener('click', () => refreshSubscription(false));
  wrap.append(h2, canvas, id, retry);
  return wrap;
};

const renderSegment = <T extends Mode | Routing>(title: string, value: T, values: T[], labels: Record<T, string>, onPick: (value: T) => void) => {
  const group = document.createElement('div');
  group.className = 'control';
  const label = document.createElement('span');
  label.textContent = title;
  const buttons = document.createElement('div');
  buttons.className = 'segments';
  values.forEach((item) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = labels[item];
    el.className = item === value ? 'active' : '';
    el.addEventListener('click', () => onPick(item));
    buttons.append(el);
  });
  group.append(label, buttons);
  return group;
};

const renderNode = (node: VlemNode) => {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = node.link === state.selectedNode ? 'node selected' : 'node';
  row.addEventListener('click', () => setState({ selectedNode: node.link }));
  const name = document.createElement('strong');
  name.textContent = node.name;
  const meta = document.createElement('span');
  meta.textContent = `${node.host}:${node.port}`;
  const delay = document.createElement('b');
  delay.textContent = node.delay == null ? '--' : `${node.delay}ms`;
  row.append(name, meta, delay);
  return row;
};

const renderApp = () => {
  const shell = document.createElement('section');
  shell.className = 'shell';

  const side = document.createElement('aside');
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.append(icon('ShieldCheck', 'VLEM'), document.createTextNode('VLEM'));
  const status = document.createElement('div');
  status.className = `status ${state.runState}`;
  status.textContent = state.runState;
  const power = button(state.runState === 'running' ? 'Stop' : 'Start', 'Power', 'power');
  power.disabled = state.fetchState !== 'authorized' || state.runState === 'starting' || state.runState === 'stopping';
  power.addEventListener('click', () => state.runState === 'running' ? void stopProxy() : void startProxy());
  side.append(brand, status, power);

  const main = document.createElement('div');
  main.className = 'workspace';
  const top = document.createElement('header');
  const title = document.createElement('div');
  const h1 = document.createElement('h1');
  h1.textContent = 'Desktop Client';
  const sub = document.createElement('p');
  sub.textContent = state.subscription ? `Expires ${formatExpiry(state.subscription.expires)}` : 'Waiting for subscription';
  title.append(h1, sub);
  const refresh = button('Refresh', 'RefreshCw', 'ghost');
  refresh.addEventListener('click', () => refreshSubscription(false));
  top.append(title, refresh);

  const controls = document.createElement('div');
  controls.className = 'controls';
  controls.append(
    renderSegment('Mode', state.mode, ['system', 'tun'], modeLabel, (mode) => {
      saveMode(mode);
      setState({ mode });
    }),
    renderSegment('Routing', state.routing, ['smart', 'global'], routingLabel, (routing) => {
      saveRouting(routing);
      setState({ routing });
    })
  );

  const portsEl = document.createElement('div');
  portsEl.className = 'ports';
  portsEl.append(icon('Cable', 'Ports'), document.createTextNode(`SOCKS 127.0.0.1:${ports.socks}  HTTP 127.0.0.1:${ports.http}`));

  const list = document.createElement('div');
  list.className = 'nodes';
  state.subscription?.nodes.forEach((node) => list.append(renderNode(node)));
  if (!state.subscription) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.fetchState === 'loading' ? 'Fetching nodes...' : 'No usable nodes.';
    list.append(empty);
  }

  const ping = button('Ping', 'Activity', 'ghost');
  ping.disabled = !state.subscription;
  ping.addEventListener('click', () => measureNodes());

  main.append(top, controls, portsEl, list, ping);
  shell.append(side, main);
  return shell;
};

const render = () => {
  app.replaceChildren();
  if (!state.apiBase) app.append(renderSetup());
  else app.append(renderApp());
  if (state.fetchState === 'unauthorized') app.append(renderAuth());
  if (state.alert) {
    const alert = document.createElement('div');
    alert.className = 'alert';
    alert.append(icon('AlertTriangle', 'Alert'), document.createTextNode(state.alert));
    app.append(alert);
  }
  if (state.error) {
    const error = document.createElement('div');
    error.className = 'toast';
    error.textContent = state.error;
    app.append(error);
  }
};

render();
void launch();
