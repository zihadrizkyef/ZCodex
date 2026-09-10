import type { NeutralEvent } from './events';
import { EventBus } from './bus';
export * from './events';
export * from './bus';
export * from './spawn';

/** Contract every engine connector must implement. */
export interface EngineConnector {
  readonly agentId: string;
  readonly label: string;
  available(): Promise<{ ok: boolean; detail?: string }>;
  /** Start an engine-backed thread rooted at `cwd`. Resolves once the thread is live. */
  startThread(cwd: string, opts?: { title?: string; prompt?: string }): Promise<{ threadId: string }>;
  send(threadId: string, text: string): Promise<void>;
  respondApproval(threadId: string, requestId: string, approve: boolean, text?: string): Promise<void>;
  close(threadId: string): Promise<void>;
  teardown(): Promise<void>;
}