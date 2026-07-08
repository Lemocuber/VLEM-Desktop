import { invoke } from '@tauri-apps/api/core';
import type { NativeStartRequest } from './types';

const hasTauri = () => Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
const message = (error: unknown) => error instanceof Error
  ? error.message
  : typeof error === 'string'
    ? error
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Native command failed.';

export const native = {
  startProxy: async (request: NativeStartRequest) => {
    if (!hasTauri()) throw new Error('Native proxy control is available only in the Tauri app.');
    try {
      await invoke('start_proxy', { request });
    } catch (error) {
      throw new Error(message(error));
    }
  },
  stopProxy: async () => {
    if (!hasTauri()) return;
    try {
      await invoke('stop_proxy');
    } catch (error) {
      throw new Error(message(error));
    }
  },
  measureDelay: async (link: string) => {
    if (!hasTauri()) return -1;
    try {
      return await invoke<number>('measure_delay', { link });
    } catch {
      return -1;
    }
  }
};
