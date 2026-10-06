import type { SceneTransition } from "./SceneTransition";
import { getRenderProfile, type RenderQuality } from "../rendering/RenderQuality";
import {
  CLOUD_PARALLAX_LAYERS,
  CLOUD_PARALLAX_SEGMENT_COUNT,
  getCloudParallaxLayers,
} from "../scenes/cloud-parallax/CloudParallaxScene";

const FADE_IN_DURATION_MS = 2200;
const REVEAL_DURATION_MS = 420;

/** Crossfades the cloud painting over the still-live forest composition. */
export class ForestToCloudCoverTransition implements SceneTransition {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly images: HTMLImageElement[];
  private readonly host: HTMLElement;

  constructor(host: HTMLElement, private readonly renderQuality: RenderQuality) {
    this.host = host;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "scene-transition-cloud-cover";
    this.canvas.setAttribute("aria-hidden", "true");
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("Could not create cloud transition canvas");
    this.context = context;

    this.images = getCloudParallaxLayers(renderQuality).map(({ imageUrl }) => {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = "";
      return image;
    });
    host.appendChild(this.canvas);
  }

  async run(signal: AbortSignal): Promise<void> {
    try {
      await Promise.all(this.images.map((image) => image.decode()));
    } catch {
      // The animation can still proceed if the browser decoded during layout.
    }
    await this.animate(
      FADE_IN_DURATION_MS,
      signal,
      (progress) => this.drawRipple(progress),
    );
  }

  reveal(signal: AbortSignal): Promise<void> {
    return this.animate(
      REVEAL_DURATION_MS,
      signal,
      (progress) => {
        this.canvas.style.opacity = String(1 - progress);
      },
    );
  }

  destroy(): void {
    this.canvas.remove();
  }

  private animate(
    duration: number,
    signal: AbortSignal,
    render: (progress: number) => void,
  ): Promise<void> {
    if (signal.aborted) return Promise.resolve();

    return new Promise((resolve) => {
      const startedAt = performance.now();
      let frame = 0;

      const finish = (): void => {
        cancelAnimationFrame(frame);
        signal.removeEventListener("abort", finish);
        resolve();
      };

      const update = (now: number): void => {
        if (signal.aborted) {
          finish();
          return;
        }

        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = progress * progress * (3 - 2 * progress);
        render(eased);

        if (progress >= 1) {
          finish();
          return;
        }
        frame = requestAnimationFrame(update);
      };

      signal.addEventListener("abort", finish, { once: true });
      frame = requestAnimationFrame(update);
    });
  }

  private drawRipple(progress: number): void {
    this.resizeCanvas();
    const { width, height } = this.canvas;
    const context = this.context;
    context.clearRect(0, 0, width, height);
    if (progress <= 0.001) return;

    const foregroundDepth = CLOUD_PARALLAX_LAYERS.at(-1)?.depth ?? 1;
    this.images.forEach((image, index) => {
      const segmentWidth = image.naturalWidth / CLOUD_PARALLAX_SEGMENT_COUNT;
      const scale = Math.max(width / segmentWidth, height / image.naturalHeight);
      const renderedSegmentWidth = segmentWidth * scale;
      const renderedWidth = image.naturalWidth * scale;
      const renderedHeight = image.naturalHeight * scale;
      const originalSceneTravel = Math.max(0, renderedSegmentWidth - width);
      const segmentStart = (CLOUD_PARALLAX_SEGMENT_COUNT - 1)
        * renderedSegmentWidth;
      const depth = CLOUD_PARALLAX_LAYERS[index]?.depth ?? 0;
      const startingOffset = segmentStart
        + originalSceneTravel * (depth / foregroundDepth);

      context.drawImage(
        image,
        -startingOffset,
        (height - renderedHeight) * 0.5,
        renderedWidth,
        renderedHeight,
      );
    });

    const centerX = width * 0.5;
    const centerY = height * 0.52;
    const maxRadius = Math.max(
      Math.hypot(centerX, centerY),
      Math.hypot(width - centerX, centerY),
      Math.hypot(centerX, height - centerY),
      Math.hypot(width - centerX, height - centerY),
    );
    const feather = Math.min(width, height) * 0.13;
    const radius = progress * (maxRadius + feather);
    const innerRadius = Math.max(0, radius - feather);
    const outerRadius = Math.max(1, radius + feather);
    const mask = context.createRadialGradient(
      centerX,
      centerY,
      innerRadius,
      centerX,
      centerY,
      outerRadius,
    );
    mask.addColorStop(0, "rgba(0, 0, 0, 1)");
    mask.addColorStop(0.38, "rgba(0, 0, 0, 1)");
    mask.addColorStop(0.56, "rgba(0, 0, 0, 0.7)");
    mask.addColorStop(0.7, "rgba(0, 0, 0, 0.9)");
    mask.addColorStop(0.84, "rgba(0, 0, 0, 0.24)");
    mask.addColorStop(1, "rgba(0, 0, 0, 0)");

    context.globalCompositeOperation = "destination-in";
    context.fillStyle = mask;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "source-over";
  }

  private resizeCanvas(): void {
    const bounds = this.host.getBoundingClientRect();
    const pixelRatio = getRenderProfile(this.renderQuality).transitionResolution;
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }
}
