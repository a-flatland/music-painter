import { CLOUD_PARALLAX_DEPTHS } from "../scenes/cloud-parallax/CloudParallaxScene";
import { SunShimmerScene } from "../scenes/sun-shimmer/SunShimmerScene";
import type { SceneTransition } from "./SceneTransition";

const DURATION_MS = 3200;

/** Lifts dusk and glides the still composition into parallax's exact start. */
export class SunToCloudTransition implements SceneTransition {
  constructor(private readonly source: SunShimmerScene) {}

  run(signal: AbortSignal): Promise<void> {
    const start = this.source.beginTransition();
    const journeyLength = Math.min(
      ...start.availableTravel.map((travel, index) =>
        travel / CLOUD_PARALLAX_DEPTHS[index],
      ),
    );
    const targetOffsets = start.availableTravel.map((travel, index) => {
      if (travel === 0) return 0;
      return Math.min(travel, journeyLength * CLOUD_PARALLAX_DEPTHS[index]) / travel;
    });

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

        const progress = Math.min(1, (now - startedAt) / DURATION_MS);
        const eased = progress * progress * (3 - 2 * progress);
        const offsets = start.layerOffsets.map((offset, index) =>
          offset + ((targetOffsets[index] ?? offset) - offset) * eased,
        );
        const exposure = start.ambientExposure
          + (1 - start.ambientExposure) * eased;

        this.source.applyTransitionFrame(offsets, exposure, 1 - eased);

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
}
