// Nothing needs to be bridged into the renderer yet -- screen share is
// fully handled by the main process's display-media handler (see
// display-media-handler.cts), and Dexy's existing web code
// (src/lib/livekit.ts) runs unmodified. contextIsolation/sandbox stay on;
// this file exists as the wiring point for a future contextBridge API
// (e.g. the Phase 2 source picker's IPC).
