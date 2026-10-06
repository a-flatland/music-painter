import { Application, Assets, Container, Texture } from "pixi.js";
import type { MusicEvent } from "../../types";
import { getRenderProfile, type RenderQuality } from "../../rendering/RenderQuality";
import type { MusicPainterScene } from "../MusicPainterScene";
import { StaticCloudLayer } from "./StaticCloudLayer";
import { SunShimmerEffect } from "./SunShimmerEffect";
import { SunWarpFilter } from "./SunWarpFilter";

export interface SunTransitionSnapshot {
  layerOffsets: number[];
  availableTravel: number[];
  ambientExposure: number;
}

const LAYERS = [
  { imageUrl: "/images/cloud-layers/01-background-sky-sun.png", horizontalOffset: 0.044 },
  { imageUrl: "/images/cloud-layers/02-far-middle-clouds.png", horizontalOffset: 0.23 },
  { imageUrl: "/images/cloud-layers/03-near-middle-clouds.png", horizontalOffset: 0.16 },
  { imageUrl: "/images/cloud-layers/04-foreground-clouds.png", horizontalOffset: 1 },
];

const PERFORMANCE_LAYERS = LAYERS.map((layer) => ({
  ...layer,
  imageUrl: layer.imageUrl.replace(
    "/cloud-layers/",
    "/cloud-layers-performance/",
  ),
}));

// The visible yellow focal point, expressed in the source composition.
const SUN_TEXTURE_POSITION = { x: 0.3, y: 0.52 };

/** Complete, reusable still-cloud scene with a musical sun shimmer. */
export class SunShimmerScene implements MusicPainterScene {
  readonly id = "sun-shimmer";

  private app = new Application();
  private stage = new Container();
  private painting = new Container();
  private layers: StaticCloudLayer[] = [];
  private shimmer = new SunShimmerEffect();
  private sunWarp = new SunWarpFilter();
  private rippleTime = 0;
  private smudgeTime = 0;
  private starTime = 0;
  private beamTravel = 0;
  private ambientExposure = 0;
  private sunGrowth = 0;
  private sunGrowthTarget = 0;
  private transitionExposure: number | null = null;
  private transitionVisualFade = 1;
  private activeNotes = new Set<string>();

  constructor(private readonly renderQuality: RenderQuality = "high") {}

  async mount(host: HTMLElement): Promise<void> {
    const renderProfile = getRenderProfile(this.renderQuality);
    await this.app.init({
      preference: "webgl",
      resizeTo: host,
      background: "#08090d",
      antialias: renderProfile.antialias,
      autoDensity: true,
      resolution: renderProfile.sceneResolution,
      powerPreference: "high-performance",
    });

    this.app.canvas.className = "paint-canvas";
    this.app.ticker.maxFPS = renderProfile.maxFps;
    this.app.canvas.style.visibility = "hidden";
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.stage);

    const layerDefinitions = this.renderQuality === "performance"
      ? PERFORMANCE_LAYERS
      : LAYERS;
    const textures = await Promise.all(
      layerDefinitions.map(({ imageUrl }) => Assets.load<Texture>(imageUrl)),
    );
    this.layers = layerDefinitions.map((definition, index) =>
      new StaticCloudLayer({
        texture: textures[index],
        horizontalOffset: definition.horizontalOffset,
      }),
    );
    this.painting.addChild(
      this.layers[0].sprite,
      this.layers[1].sprite,
      this.layers[2].sprite,
      this.shimmer.container,
      this.layers[3].sprite,
    );
    this.painting.filters = [this.sunWarp];
    this.stage.addChild(this.painting);
    this.resize();
    this.app.render();
    this.app.canvas.style.visibility = "";

    this.app.renderer.on("resize", this.resize, this);
    this.app.ticker.add(this.update, this);
  }

  handle(event: MusicEvent): void {
    if (event.type === "noteOn") {
      this.activeNotes.add(this.noteId(event.channel, event.note));
      // Reveal a small bright seed immediately so the outgoing ripple never
      // precedes the sun; the remainder continues to grow smoothly.
      this.sunGrowth = Math.max(this.sunGrowth, 0.18);
      this.sunGrowthTarget = Math.min(
        1,
        this.sunGrowthTarget + 0.3 + event.velocity * 0.25,
      );
      this.shimmer.addImpulse(event.velocity);
      this.shimmer.setHeldNoteCount(this.activeNotes.size);
      this.sunWarp.triggerPulse(event.velocity);
    }

    if (event.type === "noteOff") {
      this.activeNotes.delete(this.noteId(event.channel, event.note));
      this.shimmer.setHeldNoteCount(this.activeNotes.size);
    }
  }

  reset(): void {
    this.activeNotes.clear();
    this.beamTravel = 0;
    this.ambientExposure = 0;
    this.sunGrowth = 0;
    this.sunGrowthTarget = 0;
    this.transitionExposure = null;
    this.transitionVisualFade = 1;
    this.shimmer.container.alpha = 1;
    this.shimmer.reset();
    this.sunWarp.resetPulses();
  }

  destroy(): void {
    this.app.destroy({ removeView: true }, { children: true });
  }

  beginTransition(): SunTransitionSnapshot {
    this.activeNotes.clear();
    this.shimmer.setHeldNoteCount(0);
    const viewportWidth = this.app.screen.width;
    const visibleExposure = this.transitionExposure ?? this.ambientExposure;
    this.transitionExposure = visibleExposure;
    this.transitionVisualFade = 1;

    return {
      layerOffsets: this.layers.map((layer) => layer.horizontalOffset(viewportWidth)),
      availableTravel: this.layers.map((layer) => layer.availableTravel(viewportWidth)),
      ambientExposure: visibleExposure,
    };
  }

  applyTransitionFrame(
    layerOffsets: readonly number[],
    ambientExposure: number,
    visualFade: number,
  ): void {
    const viewportWidth = this.app.screen.width;
    this.layers.forEach((layer, index) => {
      layer.setHorizontalOffset(layerOffsets[index] ?? 0, viewportWidth);
    });
    this.transitionExposure = Math.max(0, Math.min(1, ambientExposure));
    this.transitionVisualFade = Math.max(0, Math.min(1, visualFade));
    this.shimmer.container.alpha = this.transitionVisualFade;
  }

  private resize(): void {
    if (this.layers.length === 0) return;

    const { width, height } = this.app.screen;
    this.painting.filterArea = this.app.screen;
    for (const layer of this.layers) layer.resize(width, height);

    const sky = this.layers[0];
    sky.alignTexturePointX(SUN_TEXTURE_POSITION.x, width * 0.5, width);
    const sun = sky.texturePoint(SUN_TEXTURE_POSITION.x, SUN_TEXTURE_POSITION.y);
    this.shimmer.setOrigin(sun.x, sun.y, sky.sprite.scale.x);
    this.sunWarp.origin = { x: sun.x / width, y: sun.y / height };
    this.sunWarp.aspect = width / height;
  }

  private update(): void {
    const deltaSeconds = this.app.ticker.deltaMS / 1000;
    this.shimmer.update(deltaSeconds);
    this.sunWarp.updatePulses(deltaSeconds);
    this.starTime += deltaSeconds;
    this.rippleTime += deltaSeconds * this.shimmer.rippleSpeed;
    this.smudgeTime += deltaSeconds * this.shimmer.movementSpeed * 1.2;
    this.beamTravel += deltaSeconds * this.shimmer.movementSpeed * 0.9;
    if (this.activeNotes.size > 0) {
      this.sunGrowthTarget = Math.min(
        1,
        this.sunGrowthTarget
          + deltaSeconds * (0.1 + Math.min(4, this.activeNotes.size) * 0.035),
      );
      const exposureChargeRate = 0.05
        + Math.min(4, this.activeNotes.size) * 0.02;
      this.ambientExposure = Math.min(
        1,
        this.ambientExposure + deltaSeconds * exposureChargeRate,
      );
    } else {
      this.sunGrowthTarget *= Math.exp(-0.045 * deltaSeconds);
      this.ambientExposure *= Math.exp(-0.07 * deltaSeconds);
      if (this.ambientExposure < 0.003) this.ambientExposure = 0;
    }
    const sunGrowthResponse = this.sunGrowthTarget > this.sunGrowth ? 1.8 : 0.28;
    this.sunGrowth += (this.sunGrowthTarget - this.sunGrowth)
      * (1 - Math.exp(-sunGrowthResponse * deltaSeconds));
    if (this.sunGrowthTarget < 0.002 && this.sunGrowth < 0.002) {
      this.sunGrowth = 0;
      this.sunGrowthTarget = 0;
    }
    this.shimmer.setSunVisibility(this.sunGrowth);
    this.sunWarp.time = this.rippleTime;
    this.sunWarp.smudgeTime = this.smudgeTime;
    this.sunWarp.starTime = this.starTime;
    this.sunWarp.beamTravel = this.beamTravel;
    this.sunWarp.intensity = this.shimmer.intensity * this.transitionVisualFade;
    this.sunWarp.smudgeIntensity = 0.72
      * this.shimmer.beamVisibility
      * this.transitionVisualFade;
    this.sunWarp.ambientExposure = this.transitionExposure ?? this.ambientExposure;
    this.sunWarp.sunGrowth = this.sunGrowth;
  }

  private noteId(channel: number, note: number): string {
    return `${channel}:${note}`;
  }
}
