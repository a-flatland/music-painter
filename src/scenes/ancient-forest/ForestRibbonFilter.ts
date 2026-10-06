import { Filter, GlProgram, UniformGroup, type UniformData } from "pixi.js";

const MAX_RIBBONS = 8;
export const NOTES_PER_RIBBON_BAND = 3;
const RELEASE_HOLD_SECONDS = 1.35;
const RELEASE_FADE_RESPONSE = 5.2;

interface Ribbon {
  x: number;
  width: number;
  strength: number;
  rise: number;
  band: number;
  velocity: number;
  releaseAge: number;
}

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vFilterCoord;
out vec2 vUvScale;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vUvScale = uOutputFrame.zw * uInputSize.zw;
  vTextureCoord = aPosition * vUvScale;
  vFilterCoord = aPosition;
}
`;

const ribbonUniforms = Array.from(
  { length: MAX_RIBBONS },
  (_, index) => `uniform vec4 uRibbon${index};`,
).join("\n");

const ribbonFields = Array.from(
  { length: MAX_RIBBONS },
  (_, index) => `  field += ribbonField(vFilterCoord, uRibbon${index});`,
).join("\n");

const fragment = `
in vec2 vTextureCoord;
in vec2 vFilterCoord;
in vec2 vUvScale;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uTime;
uniform float uActivity;
${ribbonUniforms}

vec4 ribbonField(vec2 uv, vec4 ribbon) {
  float halfWidth = max(0.001, ribbon.y);
  float center = ribbon.x
    + sin(uv.y * 15.0 - uTime * 1.15 + ribbon.x * 31.0)
      * (0.005 + uActivity * 0.006)
    + sin(uv.y * 31.0 + uTime * 0.72 + ribbon.x * 17.0) * 0.0025;
  float widthBreath = 1.0 + sin(
    uv.y * 11.0 + uTime * 0.88 + ribbon.x * 43.0
  ) * 0.14;
  float distanceFromCenter = abs(uv.x - center);
  float body = 1.0 - smoothstep(
    halfWidth * 0.62 * widthBreath,
    halfWidth * widthBreath,
    distanceFromCenter
  );
  float softBody = 1.0 - smoothstep(
    halfWidth * 0.72 * widthBreath,
    halfWidth * 1.48 * widthBreath,
    distanceFromCenter
  );
  float edge = smoothstep(
    halfWidth * 0.42,
    halfWidth * 0.78,
    distanceFromCenter
  ) * (1.0 - smoothstep(
    halfWidth * 0.88,
    halfWidth * 1.42,
    distanceFromCenter
  ));

  float front = 1.0 - ribbon.w;
  float risingBody = smoothstep(front - 0.075, front + 0.14, uv.y);
  float strength = ribbon.z * risingBody;
  float ripple = sin(uv.y * 48.0 - uTime * 4.2 + ribbon.x * 29.0) * 0.68
    + sin(uv.y * 79.0 + uTime * 2.7 + ribbon.x * 53.0) * 0.32;
  float horizontalPull = ripple * softBody * strength
    * (0.0045 + uActivity * 0.0065);

  // Sampling farther down the painting makes its colors appear pulled upward.
  float heightFromGrass = max(0.0, 1.0 - uv.y);
  float upwardSmear = heightFromGrass * body * strength
    * (0.032 + uActivity * 0.052);
  upwardSmear += ripple * softBody * strength * 0.0025;

  return vec4(
    softBody * strength,
    edge * strength,
    horizontalPull,
    upwardSmear
  );
}

void main(void) {
  vec4 field = vec4(0.0);
${ribbonFields}

  float body = clamp(field.x, 0.0, 1.0);
  float edge = clamp(field.y, 0.0, 1.0);
  vec2 displacement = vec2(
    clamp(field.z, -0.035, 0.035),
    clamp(field.w, -0.005, 0.13)
  );
  vec2 sampleUv = vTextureCoord + displacement * vUvScale;
  sampleUv = clamp(sampleUv, vec2(0.001), vUvScale - vec2(0.001));

  vec4 color = texture(uTexture, sampleUv);

  // A short vertical blur gives the displacement a wet-paint trail.
  vec2 smearStep = vec2(0.0, (0.008 + uActivity * 0.012) * body) * vUvScale;
  vec4 smear = (
    texture(uTexture, clamp(sampleUv + smearStep, vec2(0.001), vUvScale - vec2(0.001)))
    + texture(uTexture, clamp(sampleUv + smearStep * 2.0, vec2(0.001), vUvScale - vec2(0.001)))
    + texture(uTexture, clamp(sampleUv + smearStep * 3.0, vec2(0.001), vUvScale - vec2(0.001)))
  ) / 3.0;
  color = mix(color, smear, body * (0.28 + uActivity * 0.34));

  // A restrained RGB split catches only the moving ribbon edges.
  float prism = edge * (0.0015 + uActivity * 0.0035);
  vec2 prismOffset = vec2(prism, 0.0) * vUvScale;
  color.r = texture(
    uTexture,
    clamp(sampleUv + prismOffset, vec2(0.001), vUvScale - vec2(0.001))
  ).r;
  color.b = texture(
    uTexture,
    clamp(sampleUv - prismOffset, vec2(0.001), vUvScale - vec2(0.001))
  ).b;
  color.rgb += vec3(0.025, 0.045, 0.05) * edge * (0.5 + uActivity);

  finalColor = color;
}
`;

/** Musical, rising columns that refract and pull the forest painting. */
export class ForestRibbonFilter extends Filter {
  private readonly ribbonUniforms: UniformGroup;
  private readonly ribbons: Ribbon[] = Array.from(
    { length: MAX_RIBBONS },
    () => ({
      x: 0.5,
      width: 0.04,
      strength: 0,
      rise: 0,
      band: 1,
      velocity: 0,
      releaseAge: 0,
    }),
  );
  private heldNoteCount = 0;
  private time = 0;

  constructor() {
    const uniforms: Record<string, UniformData> = {
      uTime: { value: 0, type: "f32" },
      uActivity: { value: 0, type: "f32" },
    };
    for (let index = 0; index < MAX_RIBBONS; index += 1) {
      uniforms[`uRibbon${index}`] = {
        value: new Float32Array([0.5, 0.04, 0, 0]),
        type: "vec4<f32>",
      };
    }

    const ribbonUniforms = new UniformGroup(uniforms);
    super({
      glProgram: GlProgram.from({
        vertex,
        fragment,
        name: "forest-ribbon-filter",
      }),
      resources: { ribbonUniforms },
    });
    this.ribbonUniforms = ribbonUniforms;
  }

  setHeldNoteCount(count: number): void {
    this.heldNoteCount = count;
  }

  trigger(band: number, velocity: number): void {
    const count = Math.random() < 0.42 ? 1 : 2;
    for (let index = 0; index < count; index += 1) {
      const ribbon = this.ribbons.find((candidate) => candidate.strength === 0);
      if (!ribbon) break;
      ribbon.x = 0.08 + Math.random() * 0.84;
      ribbon.width = 0.026 + Math.random() * 0.04;
      ribbon.strength = 0.035;
      ribbon.rise = 0;
      ribbon.band = band;
      ribbon.velocity = velocity;
      ribbon.releaseAge = 0;
    }
    this.sync();
  }

  update(deltaSeconds: number): void {
    const delta = Math.min(deltaSeconds, 1 / 20);
    const activeBand = Math.floor(
      this.heldNoteCount / NOTES_PER_RIBBON_BAND,
    );
    const noteActivity = this.heldNoteCount >= NOTES_PER_RIBBON_BAND
      ? Math.min(
        1,
        0.45 + (this.heldNoteCount - NOTES_PER_RIBBON_BAND) * 0.09,
      )
      : 0;
    const ribbonCount = this.ribbons.filter((ribbon) => ribbon.strength > 0).length;
    const persistentActivity = ribbonCount > 0
      ? Math.min(1, 0.45 + (ribbonCount - 1) * 0.055)
      : 0;
    const activity = Math.max(noteActivity, persistentActivity);
    this.time += delta * (0.72 + activity * 1.15);

    for (const ribbon of this.ribbons) {
      if (ribbon.strength <= 0) continue;

      const chordSustainsRibbon = activeBand >= ribbon.band;
      if (chordSustainsRibbon) ribbon.releaseAge = 0;
      else ribbon.releaseAge += delta;

      const holding = ribbon.releaseAge < RELEASE_HOLD_SECONDS;
      const target = chordSustainsRibbon || holding
        ? 0.68 + ribbon.velocity * 0.32
        : 0;
      const response = target > 0 ? 2.6 : RELEASE_FADE_RESPONSE;
      ribbon.strength += (target - ribbon.strength)
        * (1 - Math.exp(-response * delta));

      if (target > 0) {
        ribbon.rise += (1 - ribbon.rise) * (1 - Math.exp(-1.75 * delta));
      } else if (ribbon.strength < 0.004) {
        ribbon.strength = 0;
        ribbon.rise = 0;
        ribbon.releaseAge = 0;
      }
    }

    this.ribbonUniforms.uniforms.uTime = this.time;
    this.ribbonUniforms.uniforms.uActivity = activity;
    this.sync();
  }

  reset(): void {
    this.heldNoteCount = 0;
    this.time = 0;
    for (const ribbon of this.ribbons) {
      ribbon.strength = 0;
      ribbon.rise = 0;
      ribbon.releaseAge = 0;
    }
    this.ribbonUniforms.uniforms.uTime = 0;
    this.ribbonUniforms.uniforms.uActivity = 0;
    this.sync();
  }

  private sync(): void {
    this.ribbons.forEach((ribbon, index) => {
      const uniform = this.ribbonUniforms.uniforms[
        `uRibbon${index}`
      ] as Float32Array;
      uniform[0] = ribbon.x;
      uniform[1] = ribbon.width;
      uniform[2] = ribbon.strength;
      uniform[3] = ribbon.rise;
    });
  }
}
