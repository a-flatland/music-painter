/** A directed, temporary choreography between two reusable scenes. */
export interface SceneTransition {
  run(signal: AbortSignal): Promise<void>;
  reveal?(signal: AbortSignal): Promise<void>;
  destroy?(): void;
}
