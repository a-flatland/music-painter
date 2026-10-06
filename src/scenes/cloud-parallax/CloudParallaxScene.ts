import { Application, Assets, Container, Texture } from "pixi.js";
import type { MusicEvent } from "../../types";
import { getRenderProfile, type RenderQuality } from "../../rendering/RenderQuality";
import type { MusicPainterScene } from "../MusicPainterScene";
import { SunWarpFilter } from "../sun-shimmer/SunWarpFilter";
import { KiteActor, type KiteTextures } from "./KiteActor";
import { ParallaxLayer } from "./ParallaxLayer";

export const CLOUD_PARALLAX_DEPTHS = [0.06, 0.18, 0.38, 1.35] as const;

export const CLOUD_PARALLAX_LAYERS = [
  {
    imageUrl: "/images/cloud-layers-pano-v3/01-background-sky-sun-pano.png",
    depth: CLOUD_PARALLAX_DEPTHS[0],
  },
  {
    imageUrl: "/images/cloud-layers-pano-v3/02-far-middle-clouds-pano.png",
    depth: CLOUD_PARALLAX_DEPTHS[1],
  },
  {
    imageUrl: "/images/cloud-layers-pano-v3/03-near-middle-clouds-pano.png",
    depth: CLOUD_PARALLAX_DEPTHS[2],
  },
  {
    imageUrl: "/images/cloud-layers-pano-v3/04-foreground-clouds-pano.png",
    depth: CLOUD_PARALLAX_DEPTHS[3],
  },
];

const CLOUD_PARALLAX_PERFORMANCE_LAYERS = CLOUD_PARALLAX_LAYERS.map(
  (layer) => ({
    ...layer,
    imageUrl: layer.imageUrl.replace(
      "/cloud-layers-pano-v3/",
      "/cloud-layers-pano-v3-performance/",
    ),
  }),
);

export function getCloudParallaxLayers(quality: RenderQuality) {
  return quality === "performance"
    ? CLOUD_PARALLAX_PERFORMANCE_LAYERS
    : CLOUD_PARALLAX_LAYERS;
}

const FOREGROUND_DEPTH = CLOUD_PARALLAX_DEPTHS.at(-1) ?? 1;
export const CLOUD_PARALLAX_SEGMENT_COUNT = 4;

const KITE_IMAGES = {
  steepClimb: "/images/kite-sprites/kite-steep-climb-rtl.png",
  gentleClimb: "/images/kite-sprites/kite-gentle-climb-rtl.png",
  level: "/images/kite-sprites/kite-level-rtl.png",
  gentleDive: "/images/kite-sprites/kite-gentle-dive-rtl.png",
  steepDive: "/images/kite-sprites/kite-steep-dive-rtl.png",
} as const satisfies Record<keyof KiteTextures, string>;

const MOMENTUM_DRAG = 0.55;
const MOMENTUM_RESPONSE = 2.2;
const MAX_SPEED = 90;
const STOP_SPEED = 0.5;
const MIN_NOTE_IMPULSE = 1.5;
const NOTE_IMPULSE_RANGE = 28;
const VELOCITY_CURVE = 1.7;
const CLOSING_TARGET_OFFSETS = [0, 0.3, 0.08, 0.9] as const;
const CLOSING_RESPONSE = 0.85;
const CLOSING_NOTE_IMPULSE = 0.08;
const CLOSING_VELOCITY_IMPULSE = 0.06;
const CLOSING_CHORD_WINDOW_MS = 90;
const CLOSING_ADDITIONAL_CHORD_NOTE_SCALE = 0.3;

type CloudMotion = "journey" | "closing";

/** Shared layered-cloud renderer for traveling and inward-closing motion. */
export class CloudParallaxScene implements MusicPainterScene {
  readonly id: string;
  private app = new Application();
  private stage = new Container();
  private layers: ParallaxLayer[] = [];
  private kite: KiteActor | null = null;
  private journeyPosition = 0;
  private journeyLength = 0;
  private speed = 0;
  private pendingMomentum = 0;
  private closingProgress = 0;
  private closingTarget = 0;
  private lastClosingNoteTime = Number.NEGATIVE_INFINITY;
  private duskTime = 0;
  private duskFilter: SunWarpFilter | null = null;
  private readonly kiteHeldNotes = new Set<string>();

  constructor(
    private readonly showKite = true,
    id = "cloud-parallax",
    private readonly motion: CloudMotion = "journey",
    private readonly renderQuality: RenderQuality = "high",
  ) {
    this.id = id;
    if (motion === "closing") {
      this.duskFilter = new SunWarpFilter();
      this.duskFilter.intensity = 0;
      this.duskFilter.smudgeIntensity = 0;
      this.duskFilter.sunGrowth = 0;
      this.duskFilter.ambientExposure = 1;
      this.duskFilter.emissiveStars = true;
    }
  }

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

    const layerDefinitions = getCloudParallaxLayers(this.renderQuality);
    const [textures, kiteTextureEntries] = await Promise.all([
      Promise.all(
        layerDefinitions.map(({ imageUrl }) => Assets.load<Texture>(imageUrl)),
      ),
      this.showKite
        ? Promise.all(
          Object.entries(KITE_IMAGES).map(async ([pose, imageUrl]) => [
            pose,
            await Assets.load<Texture>(imageUrl),
          ] as const),
        )
        : Promise.resolve([]),
    ]);

    this.layers = layerDefinitions.map((definition, index) =>
      new ParallaxLayer({
        texture: textures[index],
        depth: definition.depth,
        startingOffsetFraction: definition.depth / FOREGROUND_DEPTH,
        segmentCount: CLOUD_PARALLAX_SEGMENT_COUNT,
      }),
    );
    this.stage.addChild(this.layers[0].view, this.layers[1].view);
    if (this.showKite) {
      this.kite = new KiteActor(
        Object.fromEntries(kiteTextureEntries) as unknown as KiteTextures,
      );
      this.stage.addChild(this.kite.view);
    }
    this.stage.addChild(this.layers[2].view, this.layers[3].view);
    if (this.duskFilter) this.stage.filters = [this.duskFilter];
    this.resize();
    this.app.render();
    this.app.canvas.style.visibility = "";

    this.app.renderer.on("resize", this.resize, this);
    this.app.ticker.add(this.update, this);
  }

  addMomentum(worldPixelsPerSecond: number): void {
    const availableMomentum = Math.max(
      0,
      MAX_SPEED - this.speed - this.pendingMomentum,
    );
    this.pendingMomentum += Math.min(
      availableMomentum,
      Math.max(0, worldPixelsPerSecond),
    );
  }

  handle(event: MusicEvent): void {
    if (this.motion === "closing") {
      if (event.type !== "noteOn") return;
      if (this.closingProgress >= 0.97) {
        this.duskFilter?.triggerStarPulse(event.note, event.velocity);
      }
      const isAdditionalChordNote = event.time - this.lastClosingNoteTime
        <= CLOSING_CHORD_WINDOW_MS;
      const chordScale = isAdditionalChordNote
        ? CLOSING_ADDITIONAL_CHORD_NOTE_SCALE
        : 1;
      this.lastClosingNoteTime = event.time;
      this.closingTarget = Math.min(
        1,
        this.closingTarget
          + (
            CLOSING_NOTE_IMPULSE
            + event.velocity * CLOSING_VELOCITY_IMPULSE
          ) * chordScale,
      );
      return;
    }

    if (event.type === "noteOff") {
      this.kiteHeldNotes.delete(`${event.channel}:${event.note}`);
      return;
    }
    if (event.type !== "noteOn") return;

    const noteId = `${event.channel}:${event.note}`;
    if (!this.kiteHeldNotes.has(noteId)) {
      this.kiteHeldNotes.add(noteId);
      this.kite?.flyToPitch(event.note, event.velocity);
    }

    // Cloud momentum intentionally retains its existing behavior, including
    // any repeated note-on messages emitted by the controller.
    const velocityStrength = event.velocity ** VELOCITY_CURVE;
    this.addMomentum(
      MIN_NOTE_IMPULSE + velocityStrength * NOTE_IMPULSE_RANGE,
    );
  }

  reset(): void {
    if (this.motion === "closing") {
      this.closingProgress = 0;
      this.closingTarget = 0;
      this.lastClosingNoteTime = Number.NEGATIVE_INFINITY;
      this.duskTime = 0;
      if (this.duskFilter) {
        this.duskFilter.starTime = 0;
        this.duskFilter.ambientExposure = 1;
        this.duskFilter.resetStarPulses();
      }
      this.positionLayers();
      return;
    }

    this.journeyPosition = 0;
    this.speed = 0;
    this.pendingMomentum = 0;
    this.kiteHeldNotes.clear();
    this.kite?.reset();
    this.positionLayers();
  }

  destroy(): void {
    this.app.destroy({ removeView: true }, { children: true });
  }

  private resize(): void {
    if (this.layers.length === 0) return;

    const oldProgress = this.journeyLength > 0
      ? this.journeyPosition / this.journeyLength
      : 0;
    const { width, height } = this.app.screen;

    for (const layer of this.layers) layer.resize(width, height);
    this.kite?.resize(width, height);

    if (this.duskFilter) {
      this.stage.filterArea = this.app.screen;
      this.duskFilter.origin = { x: 0.5, y: 0.52 };
      this.duskFilter.aspect = width / height;
    }

    if (this.motion === "closing") {
      this.positionLayers();
      return;
    }

    this.journeyLength = Math.min(
      ...this.layers.map((layer) => layer.maxWorldTravel),
    );
    this.journeyPosition = oldProgress * this.journeyLength;
    this.positionLayers();
  }

  private update(): void {
    const deltaSeconds = this.app.ticker.deltaMS / 1000;

    if (this.motion === "closing") {
      this.closingProgress += (this.closingTarget - this.closingProgress)
        * (1 - Math.exp(-CLOSING_RESPONSE * deltaSeconds));
      if (Math.abs(this.closingTarget - this.closingProgress) < 0.0001) {
        this.closingProgress = this.closingTarget;
      }
      this.duskTime += deltaSeconds;
      if (this.duskFilter) {
        this.duskFilter.starTime = this.duskTime;
        this.duskFilter.ambientExposure = 1 - this.closingProgress;
        this.duskFilter.updateStarPulses(deltaSeconds);
      }
      this.positionLayers();
      return;
    }

    this.kite?.update(deltaSeconds);

    if (this.journeyPosition >= this.journeyLength) {
      this.speed = 0;
      this.pendingMomentum = 0;
      return;
    }

    const momentumTransfer = this.pendingMomentum
      * (1 - Math.exp(-MOMENTUM_RESPONSE * deltaSeconds));
    this.pendingMomentum -= momentumTransfer;
    this.speed = Math.min(MAX_SPEED, this.speed + momentumTransfer);
    this.journeyPosition = Math.min(
      this.journeyLength,
      this.journeyPosition + this.speed * deltaSeconds,
    );
    this.speed *= Math.exp(-MOMENTUM_DRAG * deltaSeconds);

    if (this.speed < STOP_SPEED && this.pendingMomentum < STOP_SPEED) {
      this.speed = 0;
      this.pendingMomentum = 0;
    }

    this.positionLayers();
  }

  private positionLayers(): void {
    this.layers.forEach((layer, index) => {
      if (this.motion === "closing") {
        layer.setClosingProgress(
          this.closingProgress,
          CLOSING_TARGET_OFFSETS[index] ?? 0,
        );
      } else {
        layer.setJourneyPosition(this.journeyPosition);
      }
    });
  }
}
