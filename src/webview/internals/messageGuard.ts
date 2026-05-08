// Pure runtime guard for messages received from the extension host.
// Lives outside bridge.ts so it can be unit-tested without acquireVsCodeApi.

export interface InboundMessage {
  command: string;
  data?: unknown;
  [key: string]: unknown;
}

export function isInboundMessage(value: unknown): value is InboundMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { command?: unknown }).command === 'string'
  );
}
