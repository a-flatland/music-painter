import "./style.css";
import { MidiGateway } from "./midi/MidiGateway";
import { PadMapper } from "./midi/PadMapper";
import { Painter } from "./painter/Painter";
import {
  DEFAULT_RENDER_QUALITY,
  isRenderQuality,
  RENDER_QUALITY_STORAGE_KEY,
  type RenderQuality,
} from "./rendering/RenderQuality";
import { isSceneId, sceneOptions } from "./scenes";
import type { MidiPortInfo, MidiPortsSnapshot, MusicEvent } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App container not found");
}

app.innerHTML = `
  <main class="experience">
    <div class="canvas-host" id="canvas-host"></div>
    <header class="topbar">
      <a class="brand" href="#" aria-label="Music Painter home">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>Music Painter</span>
      </a>
      <div class="controls">
        <button
          class="quality-button"
          id="quality-button"
          type="button"
          aria-label="Switch to performance mode"
          aria-pressed="false"
        >Quality: High</button>
        <button
          class="fullscreen-button"
          id="fullscreen-button"
          type="button"
          aria-label="Enter fullscreen"
          aria-pressed="false"
        >Fullscreen</button>
        <div class="midi-route is-hidden" id="midi-route">
          <label class="device-field">
            <span>In</span>
            <select id="input-select" aria-label="MIDI input"></select>
          </label>
          <span class="route-arrow" aria-hidden="true">→</span>
          <label class="device-field">
            <span>Out</span>
            <select id="output-select" aria-label="Synth MIDI output"></select>
          </label>
          <label class="thru-control" title="Forward MIDI input to the selected synth">
            <input id="thru-toggle" type="checkbox" disabled />
            <span class="switch" aria-hidden="true"></span>
            <span>Thru</span>
          </label>
        </div>
        <button class="connect-button" id="connect-button" type="button">
          <span class="status-dot" aria-hidden="true"></span>
          <span id="connect-label">Connect MIDI</span>
        </button>
      </div>
    </header>
    <section class="pad-mapper" id="pad-mapper" aria-label="MIDI note scene mappings">
      <button
        class="pad-mapper-toggle"
        id="pad-mapper-toggle"
        type="button"
        aria-expanded="false"
        aria-controls="pad-mapper-panel"
      >Scene mappings</button>
      <div class="pad-mapper-panel" id="pad-mapper-panel" hidden>
        <div class="pad-mapper-heading">
          <div>
            <p class="panel-kicker">Scene controls</p>
            <h2>Scene notes</h2>
          </div>
          <p>Assign one MIDI note to each scene. Mapped notes switch scenes and stay silent at the synth.</p>
        </div>
        <div class="pad-mapping-list" id="pad-mapping-list"></div>
      </div>
    </section>
    <footer>
      <button
        class="reset-scene-button"
        id="reset-scene-button"
        type="button"
        aria-label="Reset current scene"
      >Reset scene</button>
      <p id="last-note" aria-live="polite">Waiting for a note</p>
    </footer>
  </main>
`;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

const canvasHost = requiredElement<HTMLElement>("#canvas-host");
const experience = requiredElement<HTMLElement>(".experience");
const qualityButton = requiredElement<HTMLButtonElement>("#quality-button");
const fullscreenButton = requiredElement<HTMLButtonElement>("#fullscreen-button");
const connectButton = requiredElement<HTMLButtonElement>("#connect-button");
const connectLabel = requiredElement<HTMLElement>("#connect-label");
const midiRoute = requiredElement<HTMLElement>("#midi-route");
const inputSelect = requiredElement<HTMLSelectElement>("#input-select");
const outputSelect = requiredElement<HTMLSelectElement>("#output-select");
const thruToggle = requiredElement<HTMLInputElement>("#thru-toggle");
const padMapperToggle = requiredElement<HTMLButtonElement>("#pad-mapper-toggle");
const padMapperPanel = requiredElement<HTMLElement>("#pad-mapper-panel");
const padMappingList = requiredElement<HTMLElement>("#pad-mapping-list");
const resetSceneButton = requiredElement<HTMLButtonElement>("#reset-scene-button");
const lastNote = requiredElement<HTMLElement>("#last-note");

function loadRenderQuality(): RenderQuality {
  try {
    const stored = localStorage.getItem(RENDER_QUALITY_STORAGE_KEY);
    return isRenderQuality(stored) ? stored : DEFAULT_RENDER_QUALITY;
  } catch {
    return DEFAULT_RENDER_QUALITY;
  }
}

function saveRenderQuality(quality: RenderQuality): void {
  try {
    localStorage.setItem(RENDER_QUALITY_STORAGE_KEY, quality);
  } catch {
    // The setting still applies for this session if storage is unavailable.
  }
}

let renderQuality = loadRenderQuality();
const painter = new Painter(canvasHost, renderQuality);
await painter.switchScene("sun-shimmer");
const midi = new MidiGateway();
const padMapper = new PadMapper();

const noteNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const keyboardNotes: Record<string, number> = {
  a: 60,
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72,
};
const pressedKeyboardKeys = new Set<string>();

function renderQualityState(): void {
  const isPerformance = renderQuality === "performance";
  qualityButton.textContent = isPerformance
    ? "Quality: Performance"
    : "Quality: High";
  qualityButton.setAttribute("aria-pressed", String(isPerformance));
  qualityButton.setAttribute(
    "aria-label",
    isPerformance
      ? "Switch to high quality mode"
      : "Switch to performance mode",
  );
  qualityButton.title = isPerformance
    ? "1× rendering for smoother AirPlay"
    : "High-density rendering for the sharpest local display";
}

renderQualityState();

qualityButton.addEventListener("click", async () => {
  renderQuality = renderQuality === "high" ? "performance" : "high";
  saveRenderQuality(renderQuality);
  renderQualityState();
  qualityButton.disabled = true;
  lastNote.textContent = renderQuality === "performance"
    ? "Performance mode on"
    : "High quality mode on";

  try {
    await painter.setRenderQuality(renderQuality);
  } finally {
    qualityButton.disabled = false;
  }
});

function renderFullscreenState(): void {
  const isFullscreen = document.fullscreenElement === experience;
  experience.classList.toggle("is-fullscreen", isFullscreen);
  fullscreenButton.setAttribute("aria-pressed", String(isFullscreen));
  fullscreenButton.setAttribute(
    "aria-label",
    isFullscreen ? "Exit fullscreen" : "Enter fullscreen",
  );
  fullscreenButton.textContent = isFullscreen ? "Exit fullscreen" : "Fullscreen";
}

if (!document.fullscreenEnabled) {
  fullscreenButton.hidden = true;
}

fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement === experience) {
      await document.exitFullscreen();
    } else {
      await experience.requestFullscreen();
    }
  } catch (error) {
    fullscreenButton.title = error instanceof Error
      ? error.message
      : "Fullscreen is unavailable";
  }
});

document.addEventListener("fullscreenchange", renderFullscreenState);

padMappingList.innerHTML = sceneOptions.map(({ id, label }) => `
  <div class="pad-mapping" data-scene="${id}">
    <div class="pad-identity">
      <strong>${label}</strong>
      <span class="pad-binding">Not learned</span>
    </div>
    <button class="pad-learn-button" type="button">Learn note</button>
    <button class="pad-clear-button" type="button" aria-label="Clear MIDI note for ${label}">Clear</button>
  </div>
`).join("");

function renderPadMappings(): void {
  for (const binding of padMapper.snapshot) {
    const row = padMappingList.querySelector<HTMLElement>(
      `[data-scene="${binding.sceneId}"]`,
    );
    if (!row) continue;
    const label = requiredElementFrom<HTMLElement>(row, ".pad-binding");
    const learn = requiredElementFrom<HTMLButtonElement>(row, ".pad-learn-button");
    const clear = requiredElementFrom<HTMLButtonElement>(row, ".pad-clear-button");
    const isLearning = padMapper.learning === binding.sceneId;

    label.textContent = isLearning
      ? "Press a MIDI note…"
      : binding.channel !== null && binding.note !== null
        ? `Ch ${binding.channel} · note ${binding.note}`
        : "No note assigned";
    row.classList.add("is-triggerable");
    row.title = "Open scene";
    learn.textContent = isLearning ? "Cancel" : "Learn note";
    learn.classList.toggle("is-learning", isLearning);
    clear.disabled = binding.channel === null;
  }
}

function requiredElementFrom<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

padMappingList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const row = target.closest<HTMLElement>(".pad-mapping");
  const sceneId = row?.dataset.scene;
  if (!isSceneId(sceneId)) return;

  const button = target.closest<HTMLButtonElement>("button");
  if (button?.classList.contains("pad-learn-button")) {
    padMapper.learn(sceneId);
    return;
  }
  if (button?.classList.contains("pad-clear-button")) {
    padMapper.clearBinding(sceneId);
    return;
  }
  padMapper.trigger(sceneId);
});

padMapperToggle.addEventListener("click", () => {
  const open = padMapperPanel.hidden === true;
  padMapperPanel.hidden = !open;
  padMapperToggle.setAttribute("aria-expanded", String(open));
  padMapperToggle.classList.toggle("is-open", open);
});

padMapper.onChanged(() => renderPadMappings());
padMapper.onSceneRequested((sceneId) => {
  const sceneLabel = sceneOptions.find(({ id }) => id === sceneId)?.label ?? sceneId;
  lastNote.textContent = `Mapped note · ${sceneLabel}`;
  void painter.switchScene(sceneId);
});
midi.intercept(padMapper.intercept);

function handleMusicEvent(event: MusicEvent): void {
  painter.handle(event);

  if (event.type === "noteOn") {
    lastNote.textContent = `${noteNames[event.note % 12]} · velocity ${Math.round(event.velocity * 127)}`;
  }
}

function createPortOptions(ports: MidiPortInfo[]): HTMLOptionElement[] {
  return ports.map((port) => {
      const option = document.createElement("option");
      option.value = port.id;
      option.textContent = port.name;
      return option;
  });
}

function updatePorts(snapshot: MidiPortsSnapshot): void {
  inputSelect.replaceChildren(...createPortOptions(snapshot.inputs));

  const outputPlaceholder = document.createElement("option");
  outputPlaceholder.value = "";
  outputPlaceholder.textContent = snapshot.outputs.length > 0 ? "Choose synth…" : "No outputs";
  outputSelect.replaceChildren(outputPlaceholder, ...createPortOptions(snapshot.outputs));

  inputSelect.value = snapshot.selectedInputId ?? "";
  outputSelect.value = snapshot.selectedOutputId ?? "";
  thruToggle.checked = snapshot.thruEnabled;
  thruToggle.disabled = snapshot.selectedOutputId === null;

  midiRoute.classList.toggle("is-hidden", snapshot.inputs.length === 0);
  connectButton.classList.toggle("is-connected", snapshot.inputs.length > 0);
  connectLabel.textContent = snapshot.inputs.length > 0 ? "MIDI connected" : "No MIDI inputs";
}

midi.subscribe(handleMusicEvent);
midi.onPortsChanged(updatePorts);

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  connectLabel.textContent = "Connecting…";

  try {
    await midi.connect();
  } catch (error) {
    connectButton.classList.add("is-error");
    connectButton.title = error instanceof Error ? error.message : "Could not connect MIDI";
    connectLabel.textContent = "MIDI access unavailable";
  } finally {
    connectButton.disabled = false;
  }
});

inputSelect.addEventListener("change", () => {
  midi.selectInput(inputSelect.value);
});

outputSelect.addEventListener("change", () => {
  midi.selectOutput(outputSelect.value || null);
});

thruToggle.addEventListener("change", () => {
  midi.setThruEnabled(thruToggle.checked);
});

resetSceneButton.addEventListener("click", () => {
  painter.resetScene();
  lastNote.textContent = "Scene reset";
});

window.addEventListener("keydown", (event) => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  const note = keyboardNotes[key];
  if (note === undefined) return;

  pressedKeyboardKeys.add(key);

  handleMusicEvent({
    type: "noteOn",
    note,
    velocity: 0.72,
    channel: 1,
    time: performance.now(),
  });
});

window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  const note = keyboardNotes[key];
  if (note === undefined || !pressedKeyboardKeys.delete(key)) return;

  handleMusicEvent({
    type: "noteOff",
    note,
    velocity: 0,
    channel: 1,
    time: performance.now(),
  });
});

window.addEventListener("blur", () => {
  for (const key of pressedKeyboardKeys) {
    const note = keyboardNotes[key];
    handleMusicEvent({
      type: "noteOff",
      note,
      velocity: 0,
      channel: 1,
      time: performance.now(),
    });
  }
  pressedKeyboardKeys.clear();
});
