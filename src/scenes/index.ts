import type { MusicPainterScene } from "./MusicPainterScene";
import { AncientForestScene } from "./ancient-forest/AncientForestScene";
import { CloudParallaxScene } from "./cloud-parallax/CloudParallaxScene";
import { CloudParallaxNoKiteScene } from "./cloud-parallax-no-kite/CloudParallaxNoKiteScene";
import { SunShimmerScene } from "./sun-shimmer/SunShimmerScene";
import type { RenderQuality } from "../rendering/RenderQuality";

const sceneFactories = {
  "ancient-forest": (quality: RenderQuality) => new AncientForestScene(quality),
  "cloud-parallax": (quality: RenderQuality) => new CloudParallaxScene(true, "cloud-parallax", "journey", quality),
  "cloud-parallax-no-kite": (quality: RenderQuality) => new CloudParallaxNoKiteScene(quality),
  "sun-shimmer": (quality: RenderQuality) => new SunShimmerScene(quality),
} satisfies Record<string, (quality: RenderQuality) => MusicPainterScene>;

export type SceneId = keyof typeof sceneFactories;

export const sceneOptions: ReadonlyArray<{ id: SceneId; label: string }> = [
  { id: "sun-shimmer", label: "Sun Shimmer" },
  { id: "cloud-parallax", label: "Cloud Parallax" },
  { id: "ancient-forest", label: "Ancient Forest" },
  { id: "cloud-parallax-no-kite", label: "Cloud Cover" },
];

export function isSceneId(value: unknown): value is SceneId {
  return typeof value === "string" && value in sceneFactories;
}

/** Creates a fresh, isolated scene instance by its stable ID. */
export function createScene(id: SceneId, quality: RenderQuality): MusicPainterScene {
  return sceneFactories[id](quality);
}
