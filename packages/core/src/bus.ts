import type { NeutralEvent } from './events';

type Handler = (event: NeutralEvent) => void;

/** Minimal typed event bus. Connectors emit neutral events; server relays them to the GUI. */
export class EventBus {
  private handlers = new Set<Handler>();

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  emit(event: NeutralEvent): void {
    for (const h of [...this.handlers]) h(event);
  }
}