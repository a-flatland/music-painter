import type { SceneTransition } from "./SceneTransition";
import { getRenderProfile, type RenderQuality } from "../rendering/RenderQuality";

const GATHER_DURATION_MS = 2000;
const REVEAL_DURATION_MS = 1600;

const VERTEX_SHADER = `
attribute vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uDensity;
uniform float uReveal;

float hash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);

  float a = hash(cell);
  float b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0));
  float d = hash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.52;
  mat2 turn = mat2(0.82, 0.57, -0.57, 0.82);
  for (int octave = 0; octave < 5; octave++) {
    value += amplitude * noise(point);
    point = turn * point * 2.03 + vec2(7.3, 3.1);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  uv.x *= uResolution.x / uResolution.y;

  vec2 drift = vec2(-uTime * 0.055, uTime * 0.018);
  float broad = fbm(uv * 2.05 + drift);
  float curl = fbm(uv * 3.8 + vec2(broad * 0.9, -broad * 0.55) + drift * 1.7);
  float mist = fbm(uv * 3.0 + vec2(curl * 0.75, broad * 0.45) + drift);
  mist = mist * 0.72 + broad * 0.28;
  mist += (noise(uv * 58.0 + drift * 3.0) - 0.5) * 0.045;

  float threshold = mix(1.12, -0.12, uDensity);
  float fog = smoothstep(threshold - 0.24, threshold + 0.22, mist);
  float fogOpacity = mix(0.32, 1.0, smoothstep(0.18, 0.84, uDensity));
  fog *= fogOpacity;

  // Droplets cluster around the moving boundary of the larger fog bank.
  vec2 particleSpace = (gl_FragCoord.xy + vec2(-uTime * 28.0, uTime * 11.0)) / 21.0;
  vec2 particleCell = floor(particleSpace);
  vec2 particleLocal = fract(particleSpace);
  vec2 particlePoint = vec2(
    hash(particleCell + 4.7),
    hash(particleCell + 19.2)
  );
  float particleDistance = distance(particleLocal, particlePoint);
  float particulate = 1.0 - smoothstep(0.07, 0.28, particleDistance);
  particulate *= step(0.88, hash(particleCell + 31.8));
  particulate *= 1.0 - smoothstep(0.04, 0.3, abs(mist - threshold));
  particulate *= 1.0 - smoothstep(0.9, 1.0, uDensity);

  float alpha = max(fog, particulate * 0.2);
  alpha = max(alpha, smoothstep(0.91, 1.0, uDensity));

  // Break through the middle first, then let an irregular rim of mist linger.
  vec2 centerOffset = gl_FragCoord.xy / uResolution - 0.5;
  centerOffset.x *= uResolution.x / uResolution.y;
  float cornerRadius = length(vec2(0.5 * uResolution.x / uResolution.y, 0.5));
  float radius = length(centerOffset) / cornerRadius;
  float unevenRadius = clamp(radius + (broad - 0.5) * 0.13 + (curl - 0.5) * 0.07, 0.0, 1.12);
  float fadeStart = 0.01 + unevenRadius * 0.48;
  float fadeEnd = 0.16 + unevenRadius * 0.72;
  alpha *= 1.0 - smoothstep(fadeStart, fadeEnd, uReveal);

  vec3 color = mix(vec3(0.84, 0.92, 0.91), vec3(1.0), mist * 0.72);
  color += particulate * 0.025;

  gl_FragColor = vec4(color * alpha, alpha);
}
`;

/** Animated particulate mist that hides the canvas swap between the scenes. */
export class CloudToForestTransition implements SceneTransition {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext | null;
  private readonly fallback: CanvasRenderingContext2D | null;
  private readonly program: WebGLProgram | null;
  private readonly densityLocation: WebGLUniformLocation | null = null;
  private readonly revealLocation: WebGLUniformLocation | null = null;
  private readonly timeLocation: WebGLUniformLocation | null = null;
  private readonly resolutionLocation: WebGLUniformLocation | null = null;
  private readonly startedAt = performance.now();

  constructor(
    private readonly host: HTMLElement,
    private readonly renderQuality: RenderQuality,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "scene-transition-mist";
    this.canvas.setAttribute("aria-hidden", "true");
    host.appendChild(this.canvas);

    this.gl = this.canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
    });
    this.fallback = this.gl ? null : this.canvas.getContext("2d");
    this.program = this.gl ? this.createProgram(this.gl) : null;

    if (this.gl && this.program) {
      this.densityLocation = this.gl.getUniformLocation(this.program, "uDensity");
      this.revealLocation = this.gl.getUniformLocation(this.program, "uReveal");
      this.timeLocation = this.gl.getUniformLocation(this.program, "uTime");
      this.resolutionLocation = this.gl.getUniformLocation(this.program, "uResolution");
      this.prepareGeometry(this.gl, this.program);
    }

    this.draw(0);
  }

  run(signal: AbortSignal): Promise<void> {
    return this.animateDensity(
      0,
      1,
      GATHER_DURATION_MS,
      (progress) => progress ** 2.15,
      signal,
    );
  }

  reveal(signal: AbortSignal): Promise<void> {
    return this.animateReveal(signal);
  }

  destroy(): void {
    this.canvas.remove();
  }

  private animateDensity(
    from: number,
    to: number,
    duration: number,
    easing: (progress: number) => number,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return Promise.resolve();

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

        const progress = Math.min(1, (now - startedAt) / duration);
        const density = from + (to - from) * easing(progress);
        this.draw(density, 0);

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

  private animateReveal(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();

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

        const progress = Math.min(1, (now - startedAt) / REVEAL_DURATION_MS);
        const reveal = 1 - (1 - progress) ** 2;
        this.draw(1, reveal);

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

  private draw(density: number, reveal = 0): void {
    this.resizeCanvas();
    const time = (performance.now() - this.startedAt) / 1000;
    const blur = density * (1 - reveal) ** 2 * 7;
    this.canvas.style.backdropFilter = `blur(${blur}px)`;

    if (this.gl && this.program) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      this.gl.useProgram(this.program);
      this.gl.uniform1f(this.densityLocation, density);
      this.gl.uniform1f(this.revealLocation, reveal);
      this.gl.uniform1f(this.timeLocation, time);
      this.gl.uniform2f(
        this.resolutionLocation,
        this.canvas.width,
        this.canvas.height,
      );
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
      return;
    }

    this.drawFallback(density, time, reveal);
  }

  private resizeCanvas(): void {
    const bounds = this.host.getBoundingClientRect();
    const pixelRatio = getRenderProfile(this.renderQuality).transitionResolution;
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  private createProgram(gl: WebGLRenderingContext): WebGLProgram {
    const vertex = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error("Could not create mist transition program");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "Could not link mist shader");
    }
    return program;
  }

  private compileShader(
    gl: WebGLRenderingContext,
    type: number,
    source: string,
  ): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Could not create mist shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "Could not compile mist shader");
    }
    return shader;
  }

  private prepareGeometry(gl: WebGLRenderingContext, program: WebGLProgram): void {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  private drawFallback(density: number, time: number, reveal: number): void {
    const context = this.fallback;
    if (!context) return;

    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.fillStyle = `rgba(238, 246, 243, ${density ** 2.2})`;
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (let index = 0; index < 42; index++) {
      const phase = index * 12.9898;
      const x = ((Math.sin(phase) * 0.5 + 0.5 + time * -0.025) % 1.2)
        * this.canvas.width;
      const y = (Math.sin(phase * 2.17) * 0.5 + 0.5) * this.canvas.height;
      const radius = this.canvas.height * (0.08 + (index % 7) * 0.015);
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${density * 0.2})`);
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    if (reveal > 0) {
      const centerX = this.canvas.width * 0.5;
      const centerY = this.canvas.height * 0.5;
      const maxRadius = Math.hypot(this.canvas.width, this.canvas.height) * 0.52;
      const innerRadius = maxRadius * Math.max(0, reveal * 1.12 - 0.08);
      const outerRadius = innerRadius + maxRadius * 0.28;
      const opening = context.createRadialGradient(
        centerX,
        centerY,
        innerRadius,
        centerX,
        centerY,
        outerRadius,
      );
      opening.addColorStop(0, "rgba(0, 0, 0, 1)");
      opening.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.save();
      context.globalCompositeOperation = "destination-out";
      context.fillStyle = opening;
      context.fillRect(0, 0, this.canvas.width, this.canvas.height);
      context.restore();
    }
  }
}
