import type { SdkResult } from "./machine";

export interface EmbeddedHandlers {
  onComplete: (result: SdkResult) => void;
  /** idle | loading | ready | error (the SDK's own states). */
  onState?: (state: string, error?: string) => void;
  onEvent?: (event: { type: string; data?: Record<string, unknown> }) => void;
}

/**
 * Runs a Didit session inside our own container with the Didit Web SDK (embedded mode). The SDK is imported on demand
 * (only the face / extras step downloads it), and the returned function detaches the callbacks and tears the iframe
 * down. `url` is the hosted session URL our server created (never built by hand).
 */
export async function startEmbedded(url: string, containerId: string, handlers: EmbeddedHandlers): Promise<() => void> {
  const { DiditSdk } = await import("@didit-protocol/sdk-web");
  const sdk = DiditSdk.shared;
  let live = true;
  sdk.onComplete = (result) => { if (live) handlers.onComplete(result as SdkResult); };
  sdk.onStateChange = (state, error) => { if (live) handlers.onState?.(state, error); };
  sdk.onEvent = (event) => { if (live) handlers.onEvent?.(event as { type: string; data?: Record<string, unknown> }); };
  await sdk.startVerification({
    url,
    configuration: { embedded: true, embeddedContainerId: containerId, showCloseButton: false, showExitConfirmation: false, closeModalOnComplete: false },
  });
  return () => {
    live = false;
    sdk.onComplete = undefined;
    sdk.onStateChange = undefined;
    sdk.onEvent = undefined;
    try { sdk.destroy(); } catch { /* already torn down */ }
  };
}
