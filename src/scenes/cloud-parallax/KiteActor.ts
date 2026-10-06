import { Container, Sprite, Texture } from "pixi.js";

export interface KiteTextures {
  steepClimb: Texture;
  gentleClimb: Texture;
  level: Texture;
  gentleDive: Texture;
  steepDive: Texture;
}

const LOW_NOTE = 36;
const HIGH_NOTE = 96;
const TOP_FLIGHT_LINE = 0.1;
const BOTTOM_FLIGHT_LINE = 0.86;
const PITCH_IMPULSE = 1.45;
const AIR_DRAG = 1.45;
const MAX_VERTICAL_SPEED = 0.9;
const BOUNDARY_RESTITUTION = 0.28;
const RESTING_X = 0.84;
const FORWARD_IMPULSE = 0.13;
const BACKWARD_PULL = 0.72;
const HORIZONTAL_DRAG = 1.05;
const MAX_HORIZONTAL_SPEED = 0.42;
const LEFT_BOUNDARY = 0.07;
const RIGHT_BOUNDARY = 0.93;
const ENTRY_DELAY_SECONDS = 5;
const ENTRY_START_X = 1.16;
const ENTRY_VELOCITY = -0.34;
const MAX_FLIGHT_ROTATION = 0.2;
const ROTATION_RESPONSE = 4.5;
const GENTLE_POSE_ANGLE = 0.03;
const STEEP_POSE_ANGLE = 0.12;
const POSE_BLEND_SECONDS = 0.22;

type KitePose = keyof KiteTextures;

/** A self-contained cloud-scene actor whose altitude responds to note pitch. */
export class KiteActor {
  readonly view = new Container();

  private activeSprite: Sprite;
  private incomingSprite: Sprite;
  private activePose: KitePose = "level";
  private incomingPose: KitePose | null = null;
  private poseBlendProgress = 0;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private horizontalProgress = ENTRY_START_X;
  private horizontalVelocity = 0;
  private entryElapsed = 0;
  private hasLaunched = false;
  private hasEntered = false;
  private targetY = 0.48;
  private y = 0;
  private verticalVelocity = 0;
  private time = 0;

  constructor(private readonly textures: KiteTextures) {
    this.activeSprite = new Sprite(textures.level);
    this.incomingSprite = new Sprite(textures.level);
    this.activeSprite.anchor.set(0.5);
    this.incomingSprite.anchor.set(0.5);
    this.incomingSprite.alpha = 0;
    this.view.addChild(this.activeSprite, this.incomingSprite);
    this.view.visible = false;
  }

  flyToPitch(note: number, velocity: number): void {
    const pitch = Math.max(0, Math.min(1, (note - LOW_NOTE) / (HIGH_NOTE - LOW_NOTE)));
    const previousTarget = this.targetY;
    const velocityStrength = 0.65 + Math.max(0, Math.min(1, velocity)) * 0.7;

    this.targetY = BOTTOM_FLIGHT_LINE
      + (TOP_FLIGHT_LINE - BOTTOM_FLIGHT_LINE) * pitch;

    // A pitch interval acts like a physical impulse: changing pitch changes
    // vertical velocity immediately, while the forces below shape the arc.
    this.verticalVelocity += (this.targetY - previousTarget)
      * this.viewportHeight
      * PITCH_IMPULSE
      * velocityStrength;
    const speedLimit = this.viewportHeight * MAX_VERTICAL_SPEED;
    this.verticalVelocity = Math.max(
      -speedLimit,
      Math.min(speedLimit, this.verticalVelocity),
    );

    // The kite faces left, so negative velocity is forward. Each note adds
    // thrust while the wind-like restoring force in update() draws it back.
    this.horizontalVelocity -= FORWARD_IMPULSE * velocityStrength;
    this.horizontalVelocity = Math.max(
      -MAX_HORIZONTAL_SPEED,
      Math.min(MAX_HORIZONTAL_SPEED, this.horizontalVelocity),
    );
  }

  resize(width: number, height: number): void {
    const previousHeight = this.viewportHeight;
    this.viewportWidth = width;
    this.viewportHeight = height;

    if (this.y === 0) {
      this.y = this.targetY * height;
    } else {
      this.y *= height / previousHeight;
    }

    const scale = Math.min(
      width * 0.23 / this.textures.level.width,
      height * 0.28 / this.textures.level.height,
    );
    this.view.scale.set(scale);
    this.positionView();
  }

  update(deltaSeconds: number): void {
    const physicsStep = Math.min(deltaSeconds, 0.05);
    this.time += physicsStep;

    if (!this.hasLaunched) {
      this.entryElapsed += physicsStep;
      this.horizontalProgress = ENTRY_START_X;
      if (this.entryElapsed >= ENTRY_DELAY_SECONDS) {
        this.hasLaunched = true;
        this.view.visible = true;
        this.horizontalVelocity = Math.min(
          this.horizontalVelocity,
          ENTRY_VELOCITY,
        );
      }
    } else {
      const horizontalAcceleration = (RESTING_X - this.horizontalProgress)
        * BACKWARD_PULL
        - this.horizontalVelocity * HORIZONTAL_DRAG;
      this.horizontalVelocity += horizontalAcceleration * physicsStep;
      this.horizontalProgress += this.horizontalVelocity * physicsStep;

      if (!this.hasEntered && this.horizontalProgress <= RIGHT_BOUNDARY) {
        this.hasEntered = true;
      }

      if (this.horizontalProgress < LEFT_BOUNDARY) {
        this.horizontalProgress = LEFT_BOUNDARY;
        this.horizontalVelocity = Math.abs(this.horizontalVelocity)
          * BOUNDARY_RESTITUTION;
      } else if (this.hasEntered && this.horizontalProgress > RIGHT_BOUNDARY) {
        this.horizontalProgress = RIGHT_BOUNDARY;
        this.horizontalVelocity = -Math.abs(this.horizontalVelocity)
          * BOUNDARY_RESTITUTION;
      }
    }

    // Pitch affects the kite once, in flyToPitch(). After that initial push,
    // drag lets it coast to rest instead of continuously pulling toward a
    // sustained pitch target.
    const acceleration = -this.verticalVelocity * AIR_DRAG;
    this.verticalVelocity += acceleration * physicsStep;
    this.y += this.verticalVelocity * physicsStep;

    const topBoundary = this.viewportHeight * 0.1;
    const bottomBoundary = this.viewportHeight * 0.9;
    if (this.y < topBoundary) {
      this.y = topBoundary;
      this.verticalVelocity = Math.abs(this.verticalVelocity) * BOUNDARY_RESTITUTION;
    } else if (this.y > bottomBoundary) {
      this.y = bottomBoundary;
      this.verticalVelocity = -Math.abs(this.verticalVelocity) * BOUNDARY_RESTITUTION;
    }

    this.updateFlightRotation(physicsStep);
    this.selectPoseFromRotation();
    this.updatePoseBlend(physicsStep);
    this.positionView();
  }

  reset(): void {
    this.horizontalProgress = ENTRY_START_X;
    this.horizontalVelocity = 0;
    this.entryElapsed = 0;
    this.hasLaunched = false;
    this.hasEntered = false;
    this.targetY = 0.48;
    this.y = this.targetY * this.viewportHeight;
    this.verticalVelocity = 0;
    this.time = 0;
    this.view.rotation = 0;
    this.activePose = "level";
    this.incomingPose = null;
    this.poseBlendProgress = 0;
    this.activeSprite.texture = this.textures.level;
    this.activeSprite.alpha = 1;
    this.incomingSprite.texture = this.textures.level;
    this.incomingSprite.alpha = 0;
    this.view.visible = false;
    this.positionView();
  }

  private updateFlightRotation(deltaSeconds: number): void {
    const normalizedVelocity = this.verticalVelocity / this.viewportHeight;
    const trajectoryRotation = Math.max(
      -MAX_FLIGHT_ROTATION,
      Math.min(MAX_FLIGHT_ROTATION, -normalizedVelocity * 1.1),
    );
    const windWobble = Math.sin(this.time * 0.81) * 0.012;
    const targetRotation = trajectoryRotation + windWobble;
    this.view.rotation += (targetRotation - this.view.rotation)
      * (1 - Math.exp(-ROTATION_RESPONSE * deltaSeconds));
  }

  private selectPoseFromRotation(): void {
    const rotation = this.view.rotation;
    let pose: KitePose;
    if (rotation > STEEP_POSE_ANGLE) {
      pose = "steepClimb";
    } else if (rotation > GENTLE_POSE_ANGLE) {
      pose = "gentleClimb";
    } else if (rotation < -STEEP_POSE_ANGLE) {
      pose = "steepDive";
    } else if (rotation < -GENTLE_POSE_ANGLE) {
      pose = "gentleDive";
    } else {
      pose = "level";
    }
    this.transitionToPose(pose);
  }

  private transitionToPose(pose: KitePose): void {
    if (pose === this.incomingPose || (pose === this.activePose && !this.incomingPose)) {
      return;
    }

    if (this.incomingPose) {
      if (pose === this.activePose || this.activeSprite.alpha >= this.incomingSprite.alpha) {
        this.cancelPoseBlend();
      } else {
        this.finishPoseBlend();
      }
    }
    if (pose === this.activePose) return;

    this.incomingPose = pose;
    this.poseBlendProgress = 0;
    this.incomingSprite.texture = this.textures[pose];
    this.incomingSprite.alpha = 0;
  }

  private cancelPoseBlend(): void {
    this.incomingPose = null;
    this.poseBlendProgress = 0;
    this.activeSprite.alpha = 1;
    this.incomingSprite.alpha = 0;
  }

  private updatePoseBlend(deltaSeconds: number): void {
    if (!this.incomingPose) return;

    this.poseBlendProgress = Math.min(
      1,
      this.poseBlendProgress + deltaSeconds / POSE_BLEND_SECONDS,
    );
    const eased = this.poseBlendProgress * this.poseBlendProgress
      * (3 - 2 * this.poseBlendProgress);
    this.activeSprite.alpha = 1 - eased;
    this.incomingSprite.alpha = eased;

    if (this.poseBlendProgress >= 1) this.finishPoseBlend();
  }

  private finishPoseBlend(): void {
    if (!this.incomingPose) return;

    const previousSprite = this.activeSprite;
    this.activeSprite = this.incomingSprite;
    this.incomingSprite = previousSprite;
    this.activePose = this.incomingPose;
    this.incomingPose = null;
    this.poseBlendProgress = 0;
    this.activeSprite.alpha = 1;
    this.incomingSprite.alpha = 0;
  }

  private positionView(): void {
    const horizontalWeave = Math.sin(this.time * 0.72) * this.viewportWidth * 0.012;
    const verticalWeave = Math.sin(this.time * 1.35) * 7
      + Math.sin(this.time * 0.43) * 10;
    this.view.x = this.horizontalProgress * this.viewportWidth + horizontalWeave;
    this.view.y = this.y + verticalWeave;
  }
}
