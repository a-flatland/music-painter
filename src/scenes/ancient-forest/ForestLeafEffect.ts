import { Container, Graphics } from "pixi.js";

const MAX_LEAVES = 120;
const LEAF_COLORS = [0xc8efad, 0xb4e49a, 0x9bd884, 0xd4f1b4];

interface Leaf {
  view: Graphics;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  landingY: number;
  rotation: number;
  restingRotation: number;
  angularVelocity: number;
  phase: number;
  phaseSpeed: number;
  settled: boolean;
}

/** Windblown petals created by quiet notes and collected along the grass. */
export class ForestLeafEffect {
  readonly container = new Container();

  private leaves: Leaf[] = [];
  private width = 1;
  private height = 1;

  resize(width: number, height: number): void {
    const scaleX = this.width > 1 ? width / this.width : 1;
    const scaleY = this.height > 1 ? height / this.height : 1;
    for (const leaf of this.leaves) {
      leaf.x *= scaleX;
      leaf.y *= scaleY;
      leaf.landingY *= scaleY;
    }
    this.width = width;
    this.height = height;
  }

  trigger(velocity: number): void {
    if (this.leaves.length >= MAX_LEAVES) {
      const removableIndex = this.leaves.findIndex((leaf) => leaf.settled);
      const index = removableIndex >= 0 ? removableIndex : 0;
      this.leaves[index].view.destroy();
      this.leaves.splice(index, 1);
    }

    const size = (6.5 + Math.random() * 6 + (1 - velocity) * 3)
      * Math.min(1.35, this.height / 720);
    const view = this.createLeaf(size);
    const direction = Math.random() < 0.5 ? 1 : -1;
    const x = direction > 0 ? -size * 2 : this.width + size * 2;
    const y = this.height * (0.04 + Math.random() * 0.4);
    const rotation = Math.random() * Math.PI * 2;
    const phase = Math.random() * Math.PI * 2;

    view.position.set(x, y);
    view.rotation = rotation;
    this.container.addChild(view);
    this.leaves.push({
      view,
      x,
      y,
      velocityX: direction * this.width * (0.065 + Math.random() * 0.035),
      velocityY: this.height * (0.055 + Math.random() * 0.035),
      landingY: this.height * (0.89 + Math.random() * 0.075),
      rotation,
      restingRotation: (Math.random() - 0.5) * 0.8,
      angularVelocity: direction * (0.55 + Math.random() * 1.15),
      phase,
      phaseSpeed: 1.2 + Math.random() * 1.4,
      settled: false,
    });
  }

  update(deltaSeconds: number): void {
    const delta = Math.min(deltaSeconds, 1 / 20);

    for (const leaf of this.leaves) {
      leaf.phase += leaf.phaseSpeed * delta;

      if (!leaf.settled) {
        const crosswind = Math.sin(leaf.phase) * this.width * 0.018;
        const lift = Math.cos(leaf.phase * 0.73) * this.height * 0.012;
        leaf.x += (leaf.velocityX + crosswind) * delta;
        leaf.y += (leaf.velocityY + lift) * delta;
        leaf.rotation += (
          leaf.angularVelocity + Math.sin(leaf.phase * 1.3) * 0.65
        ) * delta;

        if (leaf.y >= leaf.landingY) {
          leaf.y = leaf.landingY;
          leaf.x = Math.max(8, Math.min(this.width - 8, leaf.x));
          leaf.settled = true;
        }
      } else {
        leaf.rotation += (leaf.restingRotation - leaf.rotation)
          * (1 - Math.exp(-4 * delta));
        leaf.rotation += Math.sin(leaf.phase * 0.42) * 0.0015;
      }

      leaf.view.position.set(leaf.x, leaf.y);
      leaf.view.rotation = leaf.rotation;
    }
  }

  reset(): void {
    for (const leaf of this.leaves) leaf.view.destroy();
    this.leaves = [];
  }

  private createLeaf(size: number): Graphics {
    const leaf = new Graphics();
    const color = LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)];

    leaf
      .moveTo(-size, 0)
      .bezierCurveTo(-size * 0.34, -size * 0.58, size * 0.48, -size * 0.5, size, 0)
      .bezierCurveTo(size * 0.42, size * 0.52, -size * 0.4, size * 0.56, -size, 0)
      .fill({ color, alpha: 0.88 });
    leaf
      .moveTo(-size * 0.72, 0)
      .lineTo(size * 0.72, 0)
      .stroke({ color: 0xe7f7cf, width: Math.max(0.55, size * 0.07), alpha: 0.68 });

    return leaf;
  }
}
