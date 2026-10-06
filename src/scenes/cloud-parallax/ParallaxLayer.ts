import { Sprite, Texture } from "pixi.js";

interface ParallaxLayerConfig {
  texture: Texture;
  depth: number;
  startingOffsetFraction: number;
  segmentCount: number;
}

/** One geometry-only visual plane in the parallax scene. */
export class ParallaxLayer {
  readonly view: Sprite;
  private startingOffset = 0;
  private segmentStart = 0;
  private originalSceneTravel = 0;

  constructor(private readonly config: ParallaxLayerConfig) {
    this.view = new Sprite(config.texture);
  }

  get maxWorldTravel(): number {
    return this.config.depth > 0
      ? this.startingOffset / this.config.depth
      : Number.POSITIVE_INFINITY;
  }

  resize(viewportWidth: number, viewportHeight: number): void {
    const { width, height } = this.config.texture;
    const segmentWidth = width / this.config.segmentCount;
    const scale = Math.max(viewportWidth / segmentWidth, viewportHeight / height);
    this.originalSceneTravel = Math.max(
      0,
      segmentWidth * scale - viewportWidth,
    );
    this.segmentStart = (this.config.segmentCount - 1) * segmentWidth * scale;

    this.view.scale.set(scale);
    this.view.y = (viewportHeight - height * scale) / 2;
    // The rightmost segment is the original scene. Begin inside it at the
    // original parallax offset, then travel through the new sections at left.
    this.startingOffset = this.segmentStart
      + this.originalSceneTravel * this.config.startingOffsetFraction;
  }

  setJourneyPosition(position: number): void {
    const offset = Math.max(
      0,
      this.startingOffset - position * this.config.depth,
    );
    this.view.x = -offset;
  }

  setClosingProgress(progress: number, targetOffsetFraction: number): void {
    const targetOffset = this.segmentStart
      + this.originalSceneTravel * targetOffsetFraction;
    const easedProgress = progress * progress * (3 - 2 * progress);
    this.view.x = -(
      this.startingOffset
      + (targetOffset - this.startingOffset) * easedProgress
    );
  }
}
