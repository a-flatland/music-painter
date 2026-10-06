export type RenderQuality = "high" | "performance";

export const DEFAULT_RENDER_QUALITY: RenderQuality = "high";
export const RENDER_QUALITY_STORAGE_KEY = "music-painter.render-quality.v1";

export interface RenderProfile {
  antialias: boolean;
  maxFps: number;
  sceneResolution: number;
  transitionResolution: number;
}

/** Keeps every scene and transition on the same rendering-quality policy. */
export function getRenderProfile(quality: RenderQuality): RenderProfile {
  if (quality === "performance") {
    return {
      antialias: false,
      maxFps: 30,
      sceneResolution: 1,
      transitionResolution: 1,
    };
  }

  return {
    antialias: true,
    maxFps: 0,
    sceneResolution: Math.min(window.devicePixelRatio, 2),
    transitionResolution: Math.min(window.devicePixelRatio, 1.5),
  };
}

export function isRenderQuality(value: unknown): value is RenderQuality {
  return value === "high" || value === "performance";
}
