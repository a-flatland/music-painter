import { BlurFilter, Container, Graphics } from "pixi.js";

const RAY_ANGLES = [-158, -112, -67, -23, 22, 66, 111, 156];

/** Geometry and animation for the glow, beams, and traveling sparkles. */
export class SunShimmerEffect {
  readonly container = new Container();

  private readonly glow = new Graphics();
  private readonly beams = new Graphics();
  private readonly sparkles = new Graphics();
  private x = 0;
  private y = 0;
  private scale = 1;
  private time = 0;
  private energy = 0;
  private heldMotion = 0;
  private heldMotionTarget = 0;
  private lightBeamVisibility = 0;
  private lightBeamVisibilityTarget = 0;
  private sunVisibility = 0;

  constructor() {
    this.glow.blendMode = "screen";
    this.beams.blendMode = "screen";
    this.sparkles.blendMode = "add";
    this.glow.filters = [new BlurFilter({ strength: 22, quality: 2 })];
    this.beams.filters = [new BlurFilter({ strength: 9, quality: 2 })];
    this.sparkles.filters = [new BlurFilter({ strength: 1.2, quality: 1 })];
    this.container.addChild(this.glow, this.beams, this.sparkles);
  }

  setOrigin(x: number, y: number, imageScale: number): void {
    this.x = x;
    this.y = y;
    this.scale = imageScale;
  }

  addImpulse(velocity: number): void {
    this.energy = Math.min(1.4, this.energy + 0.12 + velocity * 0.55);
  }

  setHeldNoteCount(count: number): void {
    this.heldMotionTarget = Math.min(1, count * 0.65);
    this.lightBeamVisibilityTarget = count > 0 ? 1 : 0;
  }

  setSunVisibility(visibility: number): void {
    this.sunVisibility = Math.max(0, Math.min(1, visibility));
  }

  reset(): void {
    this.energy = 0;
    this.heldMotion = 0;
    this.heldMotionTarget = 0;
    this.lightBeamVisibility = 0;
    this.lightBeamVisibilityTarget = 0;
    this.sunVisibility = 0;
  }

  update(deltaSeconds: number): void {
    const response = this.heldMotionTarget > this.heldMotion ? 2.4 : 0.9;
    const easing = 1 - Math.exp(-response * deltaSeconds);
    this.heldMotion += (this.heldMotionTarget - this.heldMotion) * easing;
    if (this.heldMotionTarget === 0 && this.heldMotion < 0.008) {
      this.heldMotion = 0;
    }
    const beamResponse = this.lightBeamVisibilityTarget > this.lightBeamVisibility
      ? 2.4
      : 0.18;
    const beamEasing = 1 - Math.exp(-beamResponse * deltaSeconds);
    this.lightBeamVisibility += (
      this.lightBeamVisibilityTarget - this.lightBeamVisibility
    ) * beamEasing;
    if (this.lightBeamVisibilityTarget === 0 && this.lightBeamVisibility < 0.003) {
      this.lightBeamVisibility = 0;
    }
    this.time += deltaSeconds * this.heldMotion * 2.5;
    this.energy *= Math.exp(-1.25 * deltaSeconds);
    const glowIntensity = (0.42 + this.energy * 0.62) * this.sunVisibility;
    const beamIntensity = (0.55 + this.energy * 0.62) * this.beamVisibility;

    this.drawGlow(glowIntensity);
    this.drawBeams(beamIntensity);
    this.drawSparkles(beamIntensity);
  }

  get intensity(): number {
    return Math.min(1.25, 0.72 + this.energy * 0.5);
  }

  get rippleSpeed(): number {
    return this.energy * 3.5 + this.heldMotion * 2.2;
  }

  get movementSpeed(): number {
    return this.heldMotion;
  }

  get beamVisibility(): number {
    return this.lightBeamVisibility;
  }

  private drawGlow(intensity: number): void {
    const pulse = 0.92 + Math.sin(this.time * 1.15) * 0.08;

    this.glow.clear();
    this.glow
      .circle(this.x, this.y, 64 * this.scale * pulse)
      .fill({ color: 0xffdca0, alpha: 0.095 * intensity });
    this.glow
      .circle(this.x, this.y, 34 * this.scale * pulse)
      .fill({ color: 0xfff4ce, alpha: 0.17 * intensity });
  }

  private drawBeams(intensity: number): void {
    this.beams.clear();

    RAY_ANGLES.forEach((_, index) => {
      const angle = this.rayAngle(index);
      const shimmer = 0.5 + 0.5 * Math.sin(
        this.time * (0.7 + index % 3 * 0.13) + index * 1.83,
      );
      const length = (760 + shimmer * 1080) * this.scale;
      const start = (25 + index % 4 * 5) * this.scale;
      const startHalfWidth = (0.55 + shimmer * 1.15) * this.scale;
      const endHalfWidth = (3.2 + shimmer * 8.2) * this.scale;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const startPerpendicularX = -sin * startHalfWidth;
      const startPerpendicularY = cos * startHalfWidth;
      const endPerpendicularX = -sin * endHalfWidth;
      const endPerpendicularY = cos * endHalfWidth;

      this.beams
        .poly([
          this.x + cos * start + startPerpendicularX,
          this.y + sin * start + startPerpendicularY,
          this.x + cos * length + endPerpendicularX,
          this.y + sin * length + endPerpendicularY,
          this.x + cos * length - endPerpendicularX,
          this.y + sin * length - endPerpendicularY,
          this.x + cos * start - startPerpendicularX,
          this.y + sin * start - startPerpendicularY,
        ], true)
        .fill({
          color: index % 3 === 0 ? 0xffedbd : 0xffd596,
          alpha: (0.05 + shimmer * 0.13) * intensity,
        });
    });
  }

  private drawSparkles(intensity: number): void {
    this.sparkles.clear();

    for (let index = 0; index < 22; index += 1) {
      const rayIndex = (index * 5) % RAY_ANGLES.length;
      const angle = this.rayAngle(rayIndex) + Math.sin(index * 7.13) * 0.025;
      const travel = (this.time * (0.08 + index % 4 * 0.013) + index * 0.173) % 1;
      const radius = (38 + travel * 1360) * this.scale;
      const twinkle = Math.max(0, Math.sin(this.time * 2.4 + index * 2.17));

      if (twinkle < 0.58) continue;

      const size = (0.65 + twinkle * 1.35) * this.scale;
      this.sparkles
        .circle(
          this.x + Math.cos(angle) * radius,
          this.y + Math.sin(angle) * radius,
          size,
        )
        .fill({
          color: 0xfff7dc,
          alpha: (twinkle - 0.58) * 1.35 * intensity,
        });
    }
  }

  private rayAngle(index: number): number {
    const baseAngle = RAY_ANGLES[index] * Math.PI / 180;
    const slowSway = Math.sin(
      this.time * (0.52 + index % 4 * 0.035) + index * 1.37,
    ) * 0.09;
    const fineSway = Math.sin(
      this.time * (1.04 + index % 3 * 0.057) + index * 0.71,
    ) * 0.035;
    const musicalLift = Math.sin(this.time * 0.82 + index * 2.11)
      * this.energy
      * 0.03;

    return baseAngle + slowSway + fineSway + musicalLift;
  }
}
