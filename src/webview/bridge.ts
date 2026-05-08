// Typed wrapper around acquireVsCodeApi().
// All webview→extension messages go through sendMessage().
// All extension→webview messages come through onMessage().

import { isInboundMessage, type InboundMessage } from './internals/messageGuard';

export type { InboundMessage };

interface VSCodeAPI {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

const vscode: VSCodeAPI = acquireVsCodeApi();

export function sendMessage(command: string, payload?: Record<string, unknown>): void {
  vscode.postMessage({ command, ...payload });
}

type MessageHandler = (msg: InboundMessage) => void;

export function onMessage(handler: MessageHandler): () => void {
  const listener = (event: MessageEvent<unknown>) => {
    if (!isInboundMessage(event.data)) return;
    try {
      handler(event.data);
    } catch (err) {
      // Don't let one bad message break the listener
      console.error('[bridge] handler threw on message', event.data, err);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
