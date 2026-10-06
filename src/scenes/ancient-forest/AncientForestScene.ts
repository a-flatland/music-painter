import { Application, Assets, Container, Sprite, Texture } from "pixi.js";
import type { MusicEvent } from "../../types";
import { getRenderProfile, type RenderQuality } from "../../rendering/RenderQuality";
import type { MusicPainterScene } from "../MusicPainterScene";
import {
  ForestRibbonFilter,
  NOTES_PER_RIBBON_BAND,
} from "./ForestRibbonFilter";
import { ForestLeafEffect } from "./ForestLeafEffect";
import { ForestSplashFilter } from "./ForestSplashFilter";

const IMAGE_URL = "/images/ancient-forest-trunk-wide-v4-characters.png";
const CAMERA_OVERSCAN = 1.17;
const CHORD_CONFIRM_SECONDS = 0.12;
const LOUD_NOTE_VELOCITY = 0.62;

interface PendingNoteEffect {
  noteId: string;
  velocity: number;
  elapsed: number;
}

/** A gently drifting forest composition, ready for scene-specific musical behavior. */
export class AncientForestScene implements MusicPainterScene {
  readonly id = "ancient-forest";

  private app = new Application();
  private readonly filteredPainting = new Container();
  private readonly camera = new Container();
  private painting: Sprite | null = null;
  private readonly ribbons = new ForestRibbonFilter();
  private readonly splashes = new ForestSplashFilter();
  private readonly leaves = new ForestLeafEffect();
  private readonly activeNotes = new Set<string>();
  private pendingNoteEffects: PendingNoteEffect[] = [];
  private baseScale = 1;
  private elapsedSeconds = 0;
  private confirmedRibbonBand = 0;
  private chordConfirmElapsed = 0;
  private pendingChordVelocity = 0;

  constructor(private readonly renderQuality: RenderQuality = "high") {}

  async mount(host: HTMLElement): Promise<void> {
    const renderProfile = getRenderProfile(this.renderQuality);
    await this.app.init({
      preference: "webgl",
      resizeTo: host,
      background: "#071d22",
      antialias: renderProfile.antialias,
      autoDensity: true,
      resolution: renderProfile.sceneResolution,
      powerPreference: "high-performance",
    });

    this.app.canvas.className = "paint-canvas";
    this.app.ticker.maxFPS = renderProfile.maxFps;
    this.app.canvas.style.visibility = "hidden";
    host.appendChild(this.app.canvas);

    const texture = await Assets.load<Texture>(IMAGE_URL);
    this.painting = new Sprite(texture);
    this.painting.anchor.set(0.5);
    this.camera.addChild(this.painting);
    this.filteredPainting.addChild(this.camera);
    this.filteredPainting.filters = [this.ribbons, this.splashes];
    this.app.stage.addChild(this.filteredPainting);
    this.app.stage.addChild(this.leaves.container);
    this.resize();
    this.app.render();
    this.app.canvas.style.visibility = "";

    this.app.renderer.on("resize", this.resize, this);
    this.app.ticker.add(this.update, this);
  }

  handle(event: MusicEvent): void {
    if (event.type === "controlChange") return;
    const noteId = `${event.channel}:${event.note}`;

    if (event.type === "noteOn") {
      const isNewNote = !this.activeNotes.has(noteId);
      this.activeNotes.add(noteId);
      if (isNewNote) {
        this.pendingNoteEffects.push({
          noteId,
          velocity: event.velocity,
          elapsed: 0,
        });
      }
      this.pendingChordVelocity = Math.max(
        this.pendingChordVelocity,
        event.velocity,
      );
      this.ribbons.setHeldNoteCount(this.activeNotes.size);
    }

    if (event.type === "noteOff") {
      this.activeNotes.delete(noteId);
      this.ribbons.setHeldNoteCount(this.activeNotes.size);
    }
  }

  reset(): void {
    this.activeNotes.clear();
    this.pendingNoteEffects = [];
    this.ribbons.reset();
    this.splashes.reset();
    this.leaves.reset();
    this.elapsedSeconds = 0;
    this.confirmedRibbonBand = 0;
    this.chordConfirmElapsed = 0;
    this.pendingChordVelocity = 0;
    this.positionCamera();
  }

  destroy(): void {
    this.app.destroy({ removeView: true }, { children: true });
  }

  private resize(): void {
    if (!this.painting) return;

    const { width, height } = this.app.screen;
    const texture = this.painting.texture;
    this.filteredPainting.filterArea = this.app.screen;
    this.splashes.aspect = width / height;
    this.leaves.resize(width, height);
    this.baseScale = Math.max(width / texture.width, height / texture.height)
      * CAMERA_OVERSCAN;
    this.positionCamera();
  }

  private update(): void {
    const deltaSeconds = this.app.ticker.deltaMS / 1000;
    this.elapsedSeconds += deltaSeconds;
    this.updateChordTrigger(deltaSeconds);
    this.updatePendingNoteEffects(deltaSeconds);
    this.ribbons.update(deltaSeconds);
    this.splashes.update(deltaSeconds);
    this.leaves.update(deltaSeconds);
    this.positionCamera();
  }

  private positionCamera(): void {
    if (!this.painting) return;

    const { width, height } = this.app.screen;
    const time = this.elapsedSeconds;

    // Independent long-period motions create a gentle, non-repeating camera orbit.
    const orbit = time * 0.13 + 0.5;
    const driftX = (
      Math.cos(orbit) * 0.016
      + Math.sin(time * 0.052 + 1.8) * 0.006
    ) * width;
    const driftY = (
      Math.sin(orbit) * 0.027
      + Math.sin(time * 0.17 + 2.4) * 0.011
    ) * height;
    const breath = 1
      + Math.sin(time * 0.062 + 0.4) * 0.009
      + Math.sin(time * 0.024 + 1.2) * 0.003;
    const tilt = Math.sin(time * 0.056 + 0.9) * 0.0028
      + Math.sin(time * 0.15 + 2.1) * 0.0012;

    this.camera.scale.set(this.baseScale * breath);
    this.camera.position.set(width * 0.5 + driftX, height * 0.5 + driftY);
    this.camera.rotation = tilt;
  }

  private updateChordTrigger(deltaSeconds: number): void {
    const currentBand = Math.floor(
      this.activeNotes.size / NOTES_PER_RIBBON_BAND,
    );

    if (currentBand < this.confirmedRibbonBand) {
      this.confirmedRibbonBand = currentBand;
      this.chordConfirmElapsed = 0;
      this.pendingChordVelocity = 0;
      return;
    }

    if (currentBand <= this.confirmedRibbonBand) {
      this.chordConfirmElapsed = 0;
      return;
    }

    this.chordConfirmElapsed += Math.min(deltaSeconds, 1 / 20);
    if (this.chordConfirmElapsed < CHORD_CONFIRM_SECONDS) return;

    const velocity = this.pendingChordVelocity || 0.7;
    for (
      let band = this.confirmedRibbonBand + 1;
      band <= currentBand;
      band += 1
    ) {
      this.ribbons.trigger(band, velocity);
    }
    this.pendingNoteEffects = this.pendingNoteEffects.filter(
      (effect) => !this.activeNotes.has(effect.noteId),
    );
    this.confirmedRibbonBand = currentBand;
    this.chordConfirmElapsed = 0;
    this.pendingChordVelocity = 0;
  }

  private updatePendingNoteEffects(deltaSeconds: number): void {
    const delta = Math.min(deltaSeconds, 1 / 20);
    const remaining: PendingNoteEffect[] = [];

    for (const effect of this.pendingNoteEffects) {
      effect.elapsed += delta;
      if (effect.elapsed >= CHORD_CONFIRM_SECONDS) {
        if (effect.velocity >= LOUD_NOTE_VELOCITY) {
          this.splashes.trigger(effect.velocity);
        } else {
          this.leaves.trigger(effect.velocity);
        }
      } else {
        remaining.push(effect);
      }
    }
    this.pendingNoteEffects = remaining;
  }
}
