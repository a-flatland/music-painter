import { isSceneId, sceneOptions, type SceneId } from "../scenes";
import type { MusicEvent } from "../types";

export interface SceneNoteBinding {
  sceneId: SceneId;
  channel: number | null;
  note: number | null;
}

type ChangedListener = (
  bindings: readonly SceneNoteBinding[],
  learningScene: SceneId | null,
) => void;
type SceneRequestListener = (sceneId: SceneId) => void;

const STORAGE_KEY = "music-painter.scene-note-mappings.v2";
const LEGACY_STORAGE_KEY = "music-painter.pad-mappings.v1";

/** Maps one muted MIDI note to each scene and turns note-ons into scene requests. */
export class PadMapper {
  private bindings: SceneNoteBinding[] = this.loadBindings();
  private learningScene: SceneId | null = null;
  private changedListeners = new Set<ChangedListener>();
  private sceneRequestListeners = new Set<SceneRequestListener>();

  get snapshot(): readonly SceneNoteBinding[] {
    return this.bindings;
  }

  get learning(): SceneId | null {
    return this.learningScene;
  }

  learn(sceneId: SceneId): void {
    this.learningScene = this.learningScene === sceneId ? null : sceneId;
    this.emitChanged();
  }

  clearBinding(sceneId: SceneId): void {
    const binding = this.findScene(sceneId);
    if (!binding) return;
    binding.channel = null;
    binding.note = null;
    if (this.learningScene === sceneId) this.learningScene = null;
    this.saveBindings();
    this.emitChanged();
  }

  trigger(sceneId: SceneId): void {
    const binding = this.findScene(sceneId);
    if (binding) this.requestScene(binding);
  }

  /** Returns true for both halves of a mapped note so neither reaches the synth. */
  intercept = (event: MusicEvent): boolean => {
    if (event.type !== "noteOn" && event.type !== "noteOff") return false;

    if (this.learningScene !== null && event.type === "noteOn") {
      const binding = this.findScene(this.learningScene);
      if (!binding) return false;

      // A MIDI note can open only one scene.
      for (const candidate of this.bindings) {
        if (candidate.channel === event.channel && candidate.note === event.note) {
          candidate.channel = null;
          candidate.note = null;
        }
      }

      binding.channel = event.channel;
      binding.note = event.note;
      this.learningScene = null;
      this.saveBindings();
      this.emitChanged();
      this.requestScene(binding);
      return true;
    }

    const binding = this.bindings.find(
      ({ channel, note }) => channel === event.channel && note === event.note,
    );
    if (!binding) return false;

    if (event.type === "noteOn") this.requestScene(binding);
    return true;
  };

  onChanged(listener: ChangedListener): () => void {
    this.changedListeners.add(listener);
    listener(this.bindings, this.learningScene);
    return () => this.changedListeners.delete(listener);
  }

  onSceneRequested(listener: SceneRequestListener): () => void {
    this.sceneRequestListeners.add(listener);
    return () => this.sceneRequestListeners.delete(listener);
  }

  private findScene(sceneId: SceneId): SceneNoteBinding | undefined {
    return this.bindings.find((candidate) => candidate.sceneId === sceneId);
  }

  private requestScene(binding: SceneNoteBinding): void {
    this.sceneRequestListeners.forEach((listener) => listener(binding.sceneId));
  }

  private loadBindings(): SceneNoteBinding[] {
    const defaults = sceneOptions.map(({ id }) => ({
      sceneId: id,
      channel: null,
      note: null,
    }));

    try {
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
      if (Array.isArray(current)) {
        this.applySavedBindings(defaults, current);
        return defaults;
      }

      // Preserve notes already learned with the previous pad-oriented UI.
      const legacy = JSON.parse(
        localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null",
      ) as unknown;
      if (Array.isArray(legacy)) this.applySavedBindings(defaults, legacy);
    } catch {
      // Ignore malformed or unavailable local data and retain safe defaults.
    }

    return defaults;
  }

  private applySavedBindings(
    defaults: SceneNoteBinding[],
    saved: unknown[],
  ): void {
    for (const candidate of saved) {
      if (!candidate || typeof candidate !== "object") continue;
      const value = candidate as Partial<SceneNoteBinding>;
      if (!isSceneId(value.sceneId)) continue;
      const binding = defaults.find(({ sceneId }) => sceneId === value.sceneId);
      if (!binding) continue;
      binding.channel = typeof value.channel === "number" ? value.channel : null;
      binding.note = typeof value.note === "number" ? value.note : null;
    }
  }

  private saveBindings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      // Mappings still work for this session if storage is unavailable.
    }
  }

  private emitChanged(): void {
    this.changedListeners.forEach((listener) =>
      listener(this.bindings, this.learningScene)
    );
  }
}
