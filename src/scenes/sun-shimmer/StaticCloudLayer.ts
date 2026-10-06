import { Sprite, Texture } from "pixi.js";

interface StaticCloudLayerConfig {
  texture: Texture;
  horizontalOffset: number;
}

/** A still image plane with a responsive, viewport-relative composition. */
export class StaticCloudLayer {
  readonly sprite: Sprite;

  constructor(private readonly config: StaticCloudLayerConfig) {
    this.sprite = new Sprite(config.texture);
  }

  resize(viewportWidth: number, viewportHeight: number): void {
    const { width, height } = this.config.texture;
    const scale = Math.max(viewportWidth / width, viewportHeight / height);
    const renderedWidth = width * scale;

    this.sprite.scale.set(scale);
    this.sprite.x = -(renderedWidth - viewportWidth) * this.config.horizontalOffset;
    this.sprite.y = (viewportHeight - height * scale) / 2;
  }

  texturePoint(normalizedX: number, normalizedY: number): { x: number; y: number } {
    return {
      x: this.sprite.x + this.sprite.width * normalizedX,
      y: this.sprite.y + this.sprite.height * normalizedY,
    };
  }

  alignTexturePointX(
    normalizedTextureX: number,
    viewportX: number,
    viewportWidth: number,
  ): void {
    const desiredX = viewportX - this.sprite.width * normalizedTextureX;
    const leftmostX = viewportWidth - this.sprite.width;
    this.sprite.x = Math.min(0, Math.max(leftmostX, desiredX));
  }

  horizontalOffset(viewportWidth: number): number {
    const availableTravel = Math.max(0, this.sprite.width - viewportWidth);
    return availableTravel > 0 ? -this.sprite.x / availableTravel : 0;
  }

  setHorizontalOffset(offset: number, viewportWidth: number): void {
    const availableTravel = Math.max(0, this.sprite.width - viewportWidth);
    this.sprite.x = -availableTravel * Math.max(0, Math.min(1, offset));
  }

  availableTravel(viewportWidth: number): number {
    return Math.max(0, this.sprite.width - viewportWidth);
  }
}
