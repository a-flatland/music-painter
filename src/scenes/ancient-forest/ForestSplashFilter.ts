import { Filter, GlProgram, UniformGroup, type UniformData } from "pixi.js";

const MAX_SPLASHES = 12;

interface Splash {
  x: number;
  y: number;
  radius: number;
  strength: number;
  speed: number;
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

const splashUniforms = Array.from(
  { length: MAX_SPLASHES },
  (_, index) => `uniform vec4 uSplash${index};`,
).join("\n");

const splashFields = Array.from(
  { length: MAX_SPLASHES },
  (_, index) => `  field += splashField(vFilterCoord, uSplash${index});`,
).join("\n");

const fragment = `
in vec2 vTextureCoord;
in vec2 vFilterCoord;
in vec2 vUvScale;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uAspect;
${splashUniforms}

vec3 splashField(vec2 uv, vec4 splash) {
  vec2 delta = uv - splash.xy;
  vec2 metric = vec2(delta.x * uAspect, delta.y);
  float distanceFromDrop = length(metric);
  vec2 direction = distanceFromDrop > 0.0001
    ? metric / distanceFromDrop
    : vec2(0.0);

  float distanceToRing = distanceFromDrop - splash.z;
  float primary = sin(distanceToRing * 112.0)
    * exp(-abs(distanceToRing) * 42.0);
  float wakeDistance = max(0.0, splash.z - distanceFromDrop);
  float wake = sin(wakeDistance * 78.0 + 0.7)
    * exp(-wakeDistance * 15.0)
    * step(distanceFromDrop, splash.z);
  float wave = (primary + wake * 0.34) * splash.w;
  float displacement = wave * 0.018;

  return vec3(
    direction.x * displacement / uAspect,
    direction.y * displacement,
    primary * splash.w
  );
}

void main(void) {
  vec3 field = vec3(0.0);
${splashFields}

  vec2 displacement = clamp(field.xy, vec2(-0.035), vec2(0.035));
  vec2 sampleUv = vTextureCoord + displacement * vUvScale;
  sampleUv = clamp(sampleUv, vec2(0.001), vUvScale - vec2(0.001));
  vec4 color = texture(uTexture, sampleUv);

  float caustic = clamp(field.z, -1.0, 1.0);
  color.rgb += vec3(0.075, 0.105, 0.115) * caustic * color.a;
  finalColor = color;
}
`;

/** Expanding image-space ripples made by individual, non-chord notes. */
export class ForestSplashFilter extends Filter {
  private readonly splashUniformGroup: UniformGroup;
  private readonly splashes: Splash[] = Array.from(
    { length: MAX_SPLASHES },
    () => ({ x: 0.5, y: 0.5, radius: -2, strength: 0, speed: 0.2 }),
  );

  constructor() {
    const uniforms: Record<string, UniformData> = {
      uAspect: { value: 1, type: "f32" },
    };
    for (let index = 0; index < MAX_SPLASHES; index += 1) {
      uniforms[`uSplash${index}`] = {
        value: new Float32Array([0.5, 0.5, -2, 0]),
        type: "vec4<f32>",
      };
    }

    const splashUniformGroup = new UniformGroup(uniforms);
    super({
      glProgram: GlProgram.from({
        vertex,
        fragment,
        name: "forest-splash-filter",
      }),
      resources: { splashUniformGroup },
    });
    this.splashUniformGroup = splashUniformGroup;
  }

  set aspect(value: number) {
    this.splashUniformGroup.uniforms.uAspect = value;
  }

  trigger(velocity: number): void {
    const splash = this.splashes.reduce((quietest, candidate) =>
      candidate.strength < quietest.strength ? candidate : quietest
    );
    splash.x = 0.08 + Math.random() * 0.84;
    splash.y = 0.1 + Math.random() * 0.76;
    splash.radius = 0.006;
    splash.strength = 0.75 + velocity * 0.65;
    splash.speed = 0.2 + velocity * 0.11 + Math.random() * 0.04;
    this.sync();
  }

  update(deltaSeconds: number): void {
    const delta = Math.min(deltaSeconds, 1 / 20);
    for (const splash of this.splashes) {
      if (splash.strength <= 0) continue;

      splash.radius += splash.speed * delta;
      splash.strength *= Math.exp(-0.68 * delta);
      if (splash.radius > 0.48 || splash.strength < 0.025) {
        splash.radius = -2;
        splash.strength = 0;
      }
    }
    this.sync();
  }

  reset(): void {
    for (const splash of this.splashes) {
      splash.radius = -2;
      splash.strength = 0;
    }
    this.sync();
  }

  private sync(): void {
    this.splashes.forEach((splash, index) => {
      const uniform = this.splashUniformGroup.uniforms[
        `uSplash${index}`
      ] as Float32Array;
      uniform[0] = splash.x;
      uniform[1] = splash.y;
      uniform[2] = splash.radius;
      uniform[3] = splash.strength;
    });
  }
}
