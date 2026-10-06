import { Filter, GlProgram, UniformGroup } from "pixi.js";

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

const fragment = `
in vec2 vTextureCoord;
in vec2 vFilterCoord;
in vec2 vUvScale;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uTime;
uniform float uSmudgeTime;
uniform float uStarTime;
uniform float uBeamTravel;
uniform float uIntensity;
uniform float uSmudgeIntensity;
uniform float uAmbientExposure;
uniform float uSunGrowth;
uniform float uAspect;
uniform float uEmissiveStars;
uniform vec2 uSun;
uniform vec2 uPulse0;
uniform vec2 uPulse1;
uniform vec2 uPulse2;
uniform vec2 uPulse3;
uniform vec4 uStarPulse0;
uniform vec4 uStarPulse1;
uniform vec4 uStarPulse2;
uniform vec4 uStarPulse3;

float pulseEnvelope(float radius, vec2 pulse) {
  float distanceToFront = (radius - pulse.x) / 0.19;
  return exp(-distanceToFront * distanceToFront * 0.48) * pulse.y;
}

float bulgeEnvelope(float radius, vec2 pulse) {
  float distanceToFront = (radius - pulse.x) / 0.07;
  return exp(-distanceToFront * distanceToFront * 0.9) * pulse.y;
}

float starHash(vec2 point) {
  vec3 value = fract(vec3(point.xyx) * 0.1031);
  value += dot(value, value.yzx + 33.33);
  return fract((value.x + value.y) * value.z);
}

float starPulseEnvelope(vec2 position, vec4 pulse) {
  vec2 delta = position - pulse.xy;
  delta.x *= uAspect;
  float distanceToFront = (length(delta) - pulse.z) / 0.155;
  return exp(-distanceToFront * distanceToFront) * pulse.w;
}

void main(void) {
  vec2 delta = vFilterCoord - uSun;
  vec2 metric = vec2(delta.x * uAspect, delta.y);
  float distanceFromSun = length(metric);
  float angle = atan(metric.y, metric.x);

  // Sustained-note motion rotates the two interleaved water/light groups
  // smoothly in opposite directions.
  float beamSway = sin(uSmudgeTime * 0.42) * 0.075
    + sin(uSmudgeTime * 0.67 + distanceFromSun * 2.4) * 0.028;
  float rightAngle = angle + beamSway + uBeamTravel * 0.24;
  float leftAngle = angle - beamSway * 0.72 - uBeamTravel * 0.19;
  float rightBeams = pow(abs(cos(rightAngle * 3.0 + 0.12)), 32.0);
  float leftBeams = pow(abs(cos(leftAngle * 2.0 + 0.46)), 38.0) * 0.82;
  float beamMask = max(rightBeams, leftBeams);

  float pulse = min(1.6,
    pulseEnvelope(distanceFromSun, uPulse0)
    + pulseEnvelope(distanceFromSun, uPulse1)
    + pulseEnvelope(distanceFromSun, uPulse2)
    + pulseEnvelope(distanceFromSun, uPulse3)
  );
  float bulgePulse = min(1.0,
    bulgeEnvelope(distanceFromSun, uPulse0)
    + bulgeEnvelope(distanceFromSun, uPulse1)
    + bulgeEnvelope(distanceFromSun, uPulse2)
    + bulgeEnvelope(distanceFromSun, uPulse3)
  );

  // A note widens only the compact section intersected by its pulse front.
  // The broader angular masks turn that traveling section into a soft oval
  // bulge without expanding the full length of either ray family.
  float rightBulge = pow(abs(cos(rightAngle * 3.0 + 0.12)), 10.0);
  float leftBulge = pow(abs(cos(leftAngle * 2.0 + 0.46)), 12.0) * 0.82;
  float bulgedBeamMask = max(rightBulge, leftBulge) * bulgePulse;
  float streamMask = max(beamMask, bulgedBeamMask);
  streamMask *= smoothstep(0.018, 0.09, distanceFromSun);

  // Interfering traveling waves create creek-bed refraction within each stream.
  float rippleA = sin(distanceFromSun * 62.0 - uTime * 3.25 + angle * 2.2);
  float rippleB = sin(distanceFromSun * 96.0 - uTime * 4.45 - angle * 3.5);
  float rippleC = sin(distanceFromSun * 42.0 - uTime * 2.05 + angle * 6.0);
  float ripple = rippleA * 0.52 + rippleB * 0.28 + rippleC * 0.2;

  vec2 direction = distanceFromSun > 0.0001
    ? metric / distanceFromSun
    : vec2(0.0);
  vec2 acrossStream = vec2(-direction.y, direction.x);

  // Pull luminous paint from the sun's rim into the beams while leaving the
  // round white core untouched. The soft annular onset avoids a pointed sun.
  float smudgeMask = pow(beamMask, 0.42);
  float edgeRise = smoothstep(0.09, 0.135, distanceFromSun);
  float distancePastRim = max(0.0, distanceFromSun - 0.1);
  float outwardFalloff = exp(-distancePastRim * 3.8);
  float rawSmudgeDistance = 0.032
    * edgeRise
    * outwardFalloff
    * smudgeMask
    * uSmudgeIntensity;
  float smudgeDistance = min(
    rawSmudgeDistance,
    max(0.0, distanceFromSun - 0.025)
  );
  vec2 smudgedUv = vTextureCoord - vec2(
    direction.x * smudgeDistance / uAspect,
    direction.y * smudgeDistance
  ) * vUvScale;

  // The creek-bed ripples are a separate layer over the smudged painting.
  // Only this layer receives the traveling note pulses.
  float softStreamMask = pow(streamMask, 0.68);
  float refractionStrength = (0.0032 + pulse * 0.007) * uIntensity;
  vec2 refraction = (
    acrossStream * ripple
    + direction * rippleB * 0.28
  ) * softStreamMask * refractionStrength;
  vec2 sampleUv = smudgedUv
    + vec2(refraction.x / uAspect, refraction.y) * vUvScale;
  vec4 color = texture(
    uTexture,
    clamp(sampleUv, vec2(0.001), vUvScale - vec2(0.001))
  );

  // Carry the white/yellow paint sampled at the sun's rim outward. Unlike the
  // displacement above, this can create a strong luminous pull without
  // geometrically stretching the sun or the nearby clouds into points.
  vec2 rimOffset = vec2(
    direction.x * 0.06 / uAspect,
    direction.y * 0.06
  );
  vec2 rimUv = (uSun + rimOffset) * vUvScale;
  vec4 rimColor = texture(
    uTexture,
    clamp(rimUv, vec2(0.001), vUvScale - vec2(0.001))
  );
  float sustainedRimSmear = 0.9
    * edgeRise
    * outwardFalloff
    * pow(beamMask, 0.3)
    * uSmudgeIntensity;
  float pulseRimSmear = 0.3
    * edgeRise
    * outwardFalloff
    * pow(bulgedBeamMask, 0.45);
  float rimSmear = clamp(sustainedRimSmear + pulseRimSmear, 0.0, 1.0);
  color.rgb = mix(color.rgb, rimColor.rgb, rimSmear * rimColor.a);

  float caustic = pow(0.5 + 0.5 * ripple, 7.0)
    * softStreamMask * (0.016 + pulse * 0.032) * uIntensity;
  color.rgb += vec3(1.0, 0.88, 0.66) * caustic * color.a;

  // Grade the resting painting completely into a cool dusk. Light is revealed
  // only by stars or musical activity below.
  float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 softlyDesaturated = mix(vec3(luminance), color.rgb, 0.7);
  vec3 duskColor = softlyDesaturated * vec3(0.22, 0.28, 0.46);

  // Procedural star masks are literal punctures through the dusk grade. Their
  // cores restore the true painting, while their halos restore only part of
  // it. As ambient exposure reaches daylight, the punctures disappear because
  // there is no longer any difference between the dusk and source colors.
  vec2 starGridSize = vec2(32.0, 32.0 / uAspect);
  vec2 starGridPosition = vFilterCoord * starGridSize;
  vec2 starCell = floor(starGridPosition);
  vec2 starPoint = vec2(
    starHash(starCell + vec2(1.7, 9.2)),
    starHash(starCell + vec2(8.3, 2.4))
  );
  vec2 starOffset = fract(starGridPosition) - starPoint;
  float starSeed = starHash(starCell + vec2(4.1, 6.8));
  float starPulse = max(
    max(
      starPulseEnvelope(vFilterCoord, uStarPulse0),
      starPulseEnvelope(vFilterCoord, uStarPulse1)
    ),
    max(
      starPulseEnvelope(vFilterCoord, uStarPulse2),
      starPulseEnvelope(vFilterCoord, uStarPulse3)
    )
  );
  float starPulseVariation = 0.28
    + 0.72 * starHash(starCell + vec2(23.7, 11.4));
  starPulse *= starPulseVariation;
  float starDensity = smoothstep(0.12, 0.9, distanceFromSun);
  float starThreshold = mix(0.985, 0.82, starDensity);
  float starSkyMask = 1.0 - smoothstep(0.56, 0.68, vFilterCoord.y);
  float starExists = step(starThreshold, starSeed)
    * starSkyMask;
  float energizedStarExists = step(0.76, starSeed)
    * smoothstep(0.08, 0.38, starPulse)
    * starSkyMask;
  starExists = max(starExists, energizedStarExists);
  float starPhase = starHash(starCell + vec2(12.7, 3.6)) * 6.2831853;
  float starSpeed = 1.4 + starHash(starCell + vec2(5.5, 14.2)) * 3.2;
  float twinkleWave = 0.68 * sin(uStarTime * starSpeed + starPhase)
    + 0.32 * sin(uStarTime * starSpeed * 1.61 + starPhase * 1.7);
  float starTwinkle = clamp(
    0.55 + 0.45 * (0.5 + 0.5 * twinkleWave) + starPulse * 1.15,
    0.0,
    1.45
  );
  float haloSpeed = 0.45 + starHash(starCell + vec2(9.4, 18.2)) * 0.8;
  float haloPhase = starHash(starCell + vec2(21.3, 4.7)) * 6.2831853;
  float haloBreath = 0.85 + 0.3 * (
    0.5 + 0.5 * sin(uStarTime * haloSpeed + haloPhase)
  );
  float starAngle = atan(starOffset.y, starOffset.x);
  float irregularEdge = 1.0
    + sin(starAngle * 3.0 + uStarTime * starSpeed + starPhase) * 0.12
    + sin(starAngle * 5.0 - starPhase) * 0.055;
  float starDistance = length(starOffset) * irregularEdge;
  float haloDistance = length(starOffset) * (
    1.0 + sin(starAngle * 2.0 + uStarTime * starSpeed * 0.35 + starPhase) * 0.025
  );
  float baseStarRadius = 0.032
    + starHash(starCell + vec2(17.1, 7.9)) * 0.045;
  float starRadius = baseStarRadius * (
    1.0 + starPulse * 2.4 * (1.0 - uEmissiveStars)
  );
  float starCore = (1.0 - smoothstep(
    starRadius * 0.42,
    starRadius,
    starDistance
  )) * starExists;
  float starHalo = max(0.0, (
    1.0 - smoothstep(starRadius, starRadius * 1.65 * haloBreath, haloDistance)
  ) * starExists - starCore);
  float starExposure = clamp(
    starCore * starTwinkle + starHalo * starTwinkle * 0.34,
    0.0,
    1.0
  );

  // Cloud Cover uses true points of emitted light instead of puncturing the
  // dusk grade and revealing enlarged pieces of the daylight painting.
  float emissiveRadius = baseStarRadius
    * (1.0 + min(1.0, starPulse) * 0.18);
  float emissiveEdge = 0.012;
  float emissiveCore = (
    1.0 - smoothstep(
      emissiveRadius - emissiveEdge,
      emissiveRadius + emissiveEdge,
      starDistance
    )
  ) * starExists;
  float emissiveHalo = max(0.0, (
    1.0 - smoothstep(
      emissiveRadius + emissiveEdge,
      emissiveRadius * 3.1,
      haloDistance
    )
  ) * starExists - emissiveCore);
  float emissiveBrightness = clamp(
    0.35 + starTwinkle * 0.48 + starPulse * 0.65,
    0.0,
    1.8
  );
  vec3 emissiveColor = mix(
    vec3(0.72, 0.84, 1.0),
    vec3(1.0, 0.9, 0.72),
    starHash(starCell + vec2(31.2, 2.8))
  );
  vec3 emissiveLight = emissiveColor
    * (emissiveCore + emissiveHalo * 0.2)
    * emissiveBrightness;

  // The sun begins fully hidden. Notes grow a round source-color opening from
  // its center while their pulse fronts reveal outward-moving ripple paths.
  float easedSunGrowth = smoothstep(0.0, 1.0, uSunGrowth);
  float sunRadius = mix(0.012, 0.27, sqrt(easedSunGrowth));
  float sunExposure = (
    1.0 - smoothstep(sunRadius * 0.32, sunRadius, distanceFromSun)
  ) * smoothstep(0.0, 0.1, easedSunGrowth);
  float beamActivity = clamp(uSmudgeIntensity / 0.72, 0.0, 1.0);
  float pulseActivity = clamp(pulse / 1.6, 0.0, 1.0);
  float musicalExposure = clamp(
    rimSmear * 1.65
      + pow(softStreamMask, 0.38)
        * (beamActivity * 0.88 + pulseActivity * 0.95),
    0.0,
    1.0
  );
  float lightExposure = max(
    sunExposure,
    max(starExposure * (1.0 - uEmissiveStars), musicalExposure)
  );
  vec3 ambientColor = mix(duskColor, color.rgb, uAmbientExposure);
  color.rgb = mix(ambientColor, color.rgb, lightExposure);
  color.rgb += emissiveLight
    * uEmissiveStars
    * (1.0 - uAmbientExposure);
  finalColor = color;
}
`;

export class SunWarpFilter extends Filter {
  private readonly sunUniforms: UniformGroup;
  private readonly pulses = Array.from({ length: 4 }, () => ({
    radius: -2,
    strength: 0,
  }));
  private nextPulse = 0;
  private readonly starPulses = Array.from({ length: 4 }, () => ({
    x: 0.5,
    y: 0.3,
    radius: -2,
    strength: 0,
    speed: 0,
  }));
  private nextStarPulse = 0;
  private starPulseSequence = 0;

  constructor() {
    const sunUniforms = new UniformGroup({
      uTime: { value: 0, type: "f32" },
      uSmudgeTime: { value: 0, type: "f32" },
      uStarTime: { value: 0, type: "f32" },
      uBeamTravel: { value: 0, type: "f32" },
      uIntensity: { value: 0.72, type: "f32" },
      uSmudgeIntensity: { value: 0, type: "f32" },
      uAmbientExposure: { value: 0, type: "f32" },
      uSunGrowth: { value: 0, type: "f32" },
      uAspect: { value: 1, type: "f32" },
      uEmissiveStars: { value: 0, type: "f32" },
      uSun: { value: new Float32Array([0.5, 0.5]), type: "vec2<f32>" },
      uPulse0: { value: new Float32Array([-2, 0]), type: "vec2<f32>" },
      uPulse1: { value: new Float32Array([-2, 0]), type: "vec2<f32>" },
      uPulse2: { value: new Float32Array([-2, 0]), type: "vec2<f32>" },
      uPulse3: { value: new Float32Array([-2, 0]), type: "vec2<f32>" },
      uStarPulse0: { value: new Float32Array([0.5, 0.3, -2, 0]), type: "vec4<f32>" },
      uStarPulse1: { value: new Float32Array([0.5, 0.3, -2, 0]), type: "vec4<f32>" },
      uStarPulse2: { value: new Float32Array([0.5, 0.3, -2, 0]), type: "vec4<f32>" },
      uStarPulse3: { value: new Float32Array([0.5, 0.3, -2, 0]), type: "vec4<f32>" },
    });

    super({
      glProgram: GlProgram.from({ vertex, fragment, name: "sun-warp-filter" }),
      resources: { sunUniforms },
    });
    this.sunUniforms = sunUniforms;
  }

  set time(value: number) {
    this.sunUniforms.uniforms.uTime = value;
  }

  set smudgeTime(value: number) {
    this.sunUniforms.uniforms.uSmudgeTime = value;
  }

  set starTime(value: number) {
    this.sunUniforms.uniforms.uStarTime = value;
  }

  set beamTravel(value: number) {
    this.sunUniforms.uniforms.uBeamTravel = value;
  }

  set intensity(value: number) {
    this.sunUniforms.uniforms.uIntensity = value;
  }

  set smudgeIntensity(value: number) {
    this.sunUniforms.uniforms.uSmudgeIntensity = value;
  }

  set ambientExposure(value: number) {
    this.sunUniforms.uniforms.uAmbientExposure = value;
  }

  set sunGrowth(value: number) {
    this.sunUniforms.uniforms.uSunGrowth = value;
  }

  set aspect(value: number) {
    this.sunUniforms.uniforms.uAspect = value;
  }

  set emissiveStars(enabled: boolean) {
    this.sunUniforms.uniforms.uEmissiveStars = enabled ? 1 : 0;
  }

  set origin(value: { x: number; y: number }) {
    const sun = this.sunUniforms.uniforms.uSun as Float32Array;
    sun[0] = value.x;
    sun[1] = value.y;
  }

  triggerPulse(velocity: number): void {
    const pulse = this.pulses[this.nextPulse];
    pulse.radius = 0.025;
    pulse.strength = 0.42 + velocity * 0.58;
    this.nextPulse = (this.nextPulse + 1) % this.pulses.length;
    this.syncPulses();
  }

  updatePulses(deltaSeconds: number): void {
    for (const pulse of this.pulses) {
      if (pulse.strength <= 0) continue;

      pulse.radius += deltaSeconds * 0.72;
      pulse.strength *= Math.exp(-0.2 * deltaSeconds);

      if (pulse.radius > 1.55) {
        pulse.radius = -2;
        pulse.strength = 0;
      }
    }

    this.syncPulses();
  }

  resetPulses(): void {
    for (const pulse of this.pulses) {
      pulse.radius = -2;
      pulse.strength = 0;
    }
    this.nextPulse = 0;
    this.syncPulses();
  }

  triggerStarPulse(note: number, velocity: number): void {
    const pulse = this.starPulses[this.nextStarPulse];
    const sequence = this.starPulseSequence++;
    pulse.x = 0.08 + this.hash(note * 0.73 + sequence * 4.17) * 0.84;
    pulse.y = 0.05 + this.hash(note * 1.31 + sequence * 7.91) * 0.58;
    pulse.radius = 0;
    pulse.strength = 0.34 + velocity * 0.3;
    pulse.speed = 0.34 + velocity * 0.07;
    this.nextStarPulse = (this.nextStarPulse + 1) % this.starPulses.length;
    this.syncStarPulses();
  }

  updateStarPulses(deltaSeconds: number): void {
    for (const pulse of this.starPulses) {
      if (pulse.strength <= 0) continue;

      pulse.radius += deltaSeconds * pulse.speed;
      pulse.speed *= Math.exp(-0.025 * deltaSeconds);
      pulse.strength *= Math.exp(-0.11 * deltaSeconds);
      if (pulse.radius > 1.55 || pulse.strength < 0.025) {
        pulse.radius = -2;
        pulse.strength = 0;
        pulse.speed = 0;
      }
    }
    this.syncStarPulses();
  }

  resetStarPulses(): void {
    for (const pulse of this.starPulses) {
      pulse.radius = -2;
      pulse.strength = 0;
      pulse.speed = 0;
    }
    this.nextStarPulse = 0;
    this.starPulseSequence = 0;
    this.syncStarPulses();
  }

  private syncPulses(): void {
    this.pulses.forEach((pulse, index) => {
      const uniform = this.sunUniforms.uniforms[`uPulse${index}`] as Float32Array;
      uniform[0] = pulse.radius;
      uniform[1] = pulse.strength;
    });
  }

  private syncStarPulses(): void {
    this.starPulses.forEach((pulse, index) => {
      const uniform = this.sunUniforms.uniforms[`uStarPulse${index}`] as Float32Array;
      uniform[0] = pulse.x;
      uniform[1] = pulse.y;
      uniform[2] = pulse.radius;
      uniform[3] = pulse.strength;
    });
  }

  private hash(value: number): number {
    const sine = Math.sin(value * 12.9898) * 43758.5453;
    return sine - Math.floor(sine);
  }
}
