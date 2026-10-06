import { CloudParallaxScene } from "../cloud-parallax/CloudParallaxScene";
import type { RenderQuality } from "../../rendering/RenderQuality";

/** Clouds gather over the sun and pull the painting from daylight into dusk. */
export class CloudParallaxNoKiteScene extends CloudParallaxScene {
  constructor(renderQuality: RenderQuality = "high") {
    super(false, "cloud-parallax-no-kite", "closing", renderQuality);
  }
}
