import { invoke } from '@tauri-apps/api/core';
import type { NativeStartRequest } from './types';

const hasTauri = () => Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export const native = {
  startProxy: async (request: NativeStartRequest) => {
    if (!hasTauri()) throw new Error('Native proxy control is available only in the Tauri app.');
    await invoke('start_proxy', { request });
  },
  stopProxy: async () => {
    if (!hasTauri()) return;
    await invoke('stop_proxy');
  },
  measureDelay: async (link: string) => {
    if (!hasTauri()) return -1;
    return invoke<number>('measure_delay', { link });
  }
};
