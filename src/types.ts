export type MusicEvent =
  | {
      type: "noteOn";
      note: number;
      velocity: number;
      channel: number;
      time: number;
    }
  | {
      type: "noteOff";
      note: number;
      velocity: number;
      channel: number;
      time: number;
    }
  | {
      type: "controlChange";
      controller: number;
      value: number;
      channel: number;
      time: number;
    };

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer: string;
}

export interface MidiPortsSnapshot {
  inputs: MidiPortInfo[];
  outputs: MidiPortInfo[];
  selectedInputId: string | null;
  selectedOutputId: string | null;
  thruEnabled: boolean;
}
