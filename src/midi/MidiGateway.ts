import type { MidiPortInfo, MidiPortsSnapshot, MusicEvent } from "../types";

type MusicEventListener = (event: MusicEvent) => void;
type MusicEventInterceptor = (event: MusicEvent) => boolean;
type PortsChangedListener = (snapshot: MidiPortsSnapshot) => void;

const OUTPUT_STORAGE_KEY = "music-painter-midi-output";

interface SavedOutput {
  id: string;
  name: string;
  manufacturer: string;
}

export class MidiGateway {
  private access: MIDIAccess | null = null;
  private selectedInput: MIDIInput | null = null;
  private selectedOutput: MIDIOutput | null = null;
  private thruEnabled = true;
  private listeners = new Set<MusicEventListener>();
  private interceptors = new Set<MusicEventInterceptor>();
  private portsChangedListeners = new Set<PortsChangedListener>();

  static isSupported(): boolean {
    return "requestMIDIAccess" in navigator;
  }

  async connect(): Promise<void> {
    if (!MidiGateway.isSupported()) {
      throw new Error("Web MIDI is not supported in this browser. Try Chrome.");
    }

    if (this.access) {
      this.emitPortsChanged();
      return;
    }

    this.access = await navigator.requestMIDIAccess();
    this.access.addEventListener("statechange", this.handleStateChange);

    const firstInput = this.access.inputs.values().next().value;
    if (firstInput) this.selectInput(firstInput.id);

    this.restoreSavedOutput();

    this.emitPortsChanged();
  }

  listInputs(): MidiPortInfo[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map(this.toPortInfo);
  }

  listOutputs(): MidiPortInfo[] {
    if (!this.access) return [];
    return [...this.access.outputs.values()].map(this.toPortInfo);
  }

  selectInput(id: string): void {
    if (!this.access) return;

    this.selectedInput?.removeEventListener("midimessage", this.handleMessage);
    this.selectedInput = this.access.inputs.get(id) ?? null;
    this.selectedInput?.addEventListener("midimessage", this.handleMessage);
    this.emitPortsChanged();
  }

  selectOutput(id: string | null): void {
    if (!this.access) return;

    this.selectedOutput = id ? (this.access.outputs.get(id) ?? null) : null;
    this.saveSelectedOutput();
    this.emitPortsChanged();
  }

  setThruEnabled(enabled: boolean): void {
    this.thruEnabled = enabled;
    this.emitPortsChanged();
  }

  subscribe(listener: MusicEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  intercept(interceptor: MusicEventInterceptor): () => void {
    this.interceptors.add(interceptor);
    return () => this.interceptors.delete(interceptor);
  }

  onPortsChanged(listener: PortsChangedListener): () => void {
    this.portsChangedListeners.add(listener);
    return () => this.portsChangedListeners.delete(listener);
  }

  disconnect(): void {
    this.selectedInput?.removeEventListener("midimessage", this.handleMessage);
    this.access?.removeEventListener("statechange", this.handleStateChange);
    this.selectedInput = null;
    this.selectedOutput = null;
    this.thruEnabled = true;
    this.access = null;
    this.emitPortsChanged();
  }

  private handleMessage = (event: MIDIMessageEvent): void => {
    if (!event.data) return;
    const [status = 0, data1 = 0, data2 = 0] = event.data;
    const messageType = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    let musicEvent: MusicEvent | null = null;

    if (messageType === 0x90 && data2 > 0) {
      musicEvent = {
        type: "noteOn",
        note: data1,
        velocity: data2 / 127,
        channel,
        time: event.timeStamp,
      };
    } else if (messageType === 0x80 || (messageType === 0x90 && data2 === 0)) {
      musicEvent = {
        type: "noteOff",
        note: data1,
        velocity: data2 / 127,
        channel,
        time: event.timeStamp,
      };
    } else if (messageType === 0xb0) {
      musicEvent = {
        type: "controlChange",
        controller: data1,
        value: data2 / 127,
        channel,
        time: event.timeStamp,
      };
    }

    const consumed = musicEvent
      ? [...this.interceptors].some((interceptor) => interceptor(musicEvent!))
      : false;

    if (this.thruEnabled && this.selectedOutput && !consumed) {
      this.selectedOutput.send(event.data);
    }

    if (musicEvent && !consumed) this.emit(musicEvent);
  };

  private handleStateChange = (): void => {
    if (this.selectedInput?.state === "disconnected") {
      this.selectedInput = null;
    }
    if (this.selectedOutput?.state === "disconnected") {
      this.selectedOutput = null;
    }
    if (!this.selectedOutput) this.restoreSavedOutput();
    this.emitPortsChanged();
  };

  private restoreSavedOutput(): void {
    if (!this.access) return;

    const saved = this.loadSavedOutput();
    if (!saved) return;

    const outputs = [...this.access.outputs.values()].filter(
      (output) => output.state === "connected",
    );
    this.selectedOutput = outputs.find((output) => output.id === saved.id)
      ?? outputs.find((output) =>
        (output.name ?? "") === saved.name
        && (output.manufacturer ?? "") === saved.manufacturer
      )
      ?? null;

    // Refresh the stored ID if the same named port was assigned a new one.
    if (this.selectedOutput) this.saveSelectedOutput();
  }

  private loadSavedOutput(): SavedOutput | null {
    try {
      const parsed = JSON.parse(localStorage.getItem(OUTPUT_STORAGE_KEY) ?? "null") as unknown;
      if (!parsed || typeof parsed !== "object") return null;

      const candidate = parsed as Partial<SavedOutput>;
      if (
        typeof candidate.id !== "string"
        || typeof candidate.name !== "string"
        || typeof candidate.manufacturer !== "string"
      ) {
        return null;
      }

      return {
        id: candidate.id,
        name: candidate.name,
        manufacturer: candidate.manufacturer,
      };
    } catch {
      return null;
    }
  }

  private saveSelectedOutput(): void {
    try {
      if (!this.selectedOutput) {
        localStorage.removeItem(OUTPUT_STORAGE_KEY);
        return;
      }

      const saved: SavedOutput = {
        id: this.selectedOutput.id,
        name: this.selectedOutput.name ?? "",
        manufacturer: this.selectedOutput.manufacturer ?? "",
      };
      localStorage.setItem(OUTPUT_STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // MIDI routing still works when browser storage is unavailable.
    }
  }

  private toPortInfo(port: MIDIInput | MIDIOutput): MidiPortInfo {
    return {
      id: port.id,
      name: port.name ?? "Unknown MIDI port",
      manufacturer: port.manufacturer ?? "Unknown manufacturer",
    };
  }

  private emit(event: MusicEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private emitPortsChanged(): void {
    const snapshot: MidiPortsSnapshot = {
      inputs: this.listInputs(),
      outputs: this.listOutputs(),
      selectedInputId: this.selectedInput?.id ?? null,
      selectedOutputId: this.selectedOutput?.id ?? null,
      thruEnabled: this.thruEnabled,
    };
    this.portsChangedListeners.forEach((listener) => listener(snapshot));
  }
}
