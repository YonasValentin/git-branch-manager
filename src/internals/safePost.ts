// Disposed-panel postMessage guard.
//
// VS Code webview panels can be closed by the user while async tasks (PR fetch,
// branch comparison, timeline) are still in flight. Calling
// `panel.webview.postMessage()` on a disposed panel throws
// "Webview is disposed". This factory returns a wrapper that drops messages
// once the disposed flag has been flipped.

export interface DisposalState {
  disposed: boolean;
}

export function createSafePost(
  rawPost: (msg: unknown) => void,
  state: DisposalState,
): (msg: unknown) => void {
  return (msg) => {
    if (state.disposed) return;
    rawPost(msg);
  };
}
