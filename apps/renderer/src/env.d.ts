/// <reference types="vite/client" />
import type { ZCodexApi } from "@zcodex/contracts";

declare global {
  interface Window {
    zcodex: ZCodexApi;
  }
}

export {};
