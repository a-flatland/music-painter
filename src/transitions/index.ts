import type { SceneId } from "../scenes";
import type { MusicPainterScene } from "../scenes/MusicPainterScene";
import { AncientForestScene } from "../scenes/ancient-forest/AncientForestScene";
import { CloudParallaxScene } from "../scenes/cloud-parallax/CloudParallaxScene";
import { SunShimmerScene } from "../scenes/sun-shimmer/SunShimmerScene";
import { CloudToForestTransition } from "./CloudToForestTransition";
import { ForestToCloudCoverTransition } from "./ForestToCloudCoverTransition";
import type { SceneTransition } from "./SceneTransition";
import { SunToCloudTransition } from "./SunToCloudTransition";
import type { RenderQuality } from "../rendering/RenderQuality";

type TransitionFactory = (
  scene: MusicPainterScene,
  host: HTMLElement,
  quality: RenderQuality,
) => SceneTransition | null;

const transitionFactories: Partial<Record<`${SceneId}->${SceneId}`, TransitionFactory>> = {
  "sun-shimmer->cloud-parallax": (scene) => scene instanceof SunShimmerScene
    ? new SunToCloudTransition(scene)
    : null,
  "cloud-parallax->ancient-forest": (scene, host, quality) => scene instanceof CloudParallaxScene
    ? new CloudToForestTransition(host, quality)
    : null,
  "ancient-forest->cloud-parallax-no-kite": (scene, host, quality) =>
    scene instanceof AncientForestScene
      ? new ForestToCloudCoverTransition(host, quality)
      : null,
};

export function createTransition(
  from: MusicPainterScene,
  to: SceneId,
  host: HTMLElement,
  quality: RenderQuality,
): SceneTransition | null {
  const factory = transitionFactories[`${from.id as SceneId}->${to}`];
  return factory?.(from, host, quality) ?? null;
}
