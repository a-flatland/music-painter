import type { MusicEvent } from "../types";

/** The complete contract for a scene that can be mounted and played by the app. */
export interface MusicPainterScene {
  readonly id: string;
  mount(host: HTMLElement): Promise<void>;
  handle(event: MusicEvent): void;
  reset(): void;
  destroy(): void;
}
