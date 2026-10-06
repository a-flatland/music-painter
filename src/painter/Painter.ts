import type { MusicEvent } from "../types";
import { createScene, type SceneId } from "../scenes";
import type { MusicPainterScene } from "../scenes/MusicPainterScene";
import { createTransition } from "../transitions";
import type { SceneTransition } from "../transitions/SceneTransition";
import type { RenderQuality } from "../rendering/RenderQuality";

export class Painter {
  private scene: MusicPainterScene | null = null;
  private switchVersion = 0;
  private transitionAbort: AbortController | null = null;
  private transitioning = false;
  private transitionTarget: SceneId | null = null;

  constructor(
    private readonly host: HTMLElement,
    private renderQuality: RenderQuality,
  ) {}

  handle(event: MusicEvent): void {
    if (!this.transitioning) this.scene?.handle(event);
  }

  /** Reset whichever reusable scene is currently active. */
  resetScene(): void {
    this.scene?.reset();
  }

  /** Atomically mounts a fresh scene and tears down the previous one. */
  async switchScene(id: SceneId): Promise<void> {
    if (this.transitioning && this.transitionTarget === id) return;

    const version = ++this.switchVersion;
    this.transitionAbort?.abort();
    this.transitionAbort = null;
    if (this.scene?.id === id) {
      this.transitioning = false;
      this.transitionTarget = null;
      this.scene.reset();
      return;
    }

    this.transitioning = true;
    this.transitionTarget = id;
    let transition: SceneTransition | null = null;
    if (this.scene) {
      transition = createTransition(this.scene, id, this.host, this.renderQuality);
      if (transition) {
        const controller = new AbortController();
        this.transitionAbort = controller;
        await transition.run(controller.signal);
        if (version !== this.switchVersion) {
          transition.destroy?.();
          return;
        }
      }
    }

    const nextScene = createScene(id, this.renderQuality);
    await nextScene.mount(this.host);

    if (version !== this.switchVersion) {
      nextScene.destroy();
      transition?.destroy?.();
      return;
    }

    const previousScene = this.scene;
    this.scene = nextScene;
    previousScene?.destroy();

    if (transition?.reveal && this.transitionAbort) {
      await transition.reveal(this.transitionAbort.signal);
      if (version !== this.switchVersion) {
        transition.destroy?.();
        return;
      }
    }

    transition?.destroy?.();
    this.transitioning = false;
    this.transitionTarget = null;
    this.transitionAbort = null;
  }

  /** Rebuilds the current scene at a new pixel density without a scene transition. */
  async setRenderQuality(quality: RenderQuality): Promise<void> {
    if (quality === this.renderQuality) return;
    this.renderQuality = quality;

    const currentId = this.scene?.id as SceneId | undefined;
    if (!currentId) return;

    const version = ++this.switchVersion;
    this.transitionAbort?.abort();
    this.transitionAbort = null;
    this.transitioning = true;
    this.transitionTarget = currentId;

    const nextScene = createScene(currentId, this.renderQuality);
    await nextScene.mount(this.host);

    if (version !== this.switchVersion) {
      nextScene.destroy();
      return;
    }

    const previousScene = this.scene;
    this.scene = nextScene;
    previousScene?.destroy();
    this.transitioning = false;
    this.transitionTarget = null;
  }
}
