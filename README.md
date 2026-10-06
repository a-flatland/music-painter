# Music Painter

vibecoded ++

Turns midi input into scenes. I've programmed 4 scenes already - you can trigger them through the UI or tie the triggers to midi input as well.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL in Chrome and:

1. Select **Connect MIDI** and grant permission.
2. Choose your midi-controller under **In**.
3. Optionally choose your synth under **Out**.*
4. Turn on **Thru** to forward the performance to the synth.

*Some midi-controllers can route input to multiple synths, so you might not need to use midi out through this app. For example, I connected midi-out from an electric keyboard to this app's midi-in. But the electric keyboard already produced its own sound, so I didn't need to route midi to my synth.

You can test without a controller using the computer keys `A W S E D F T G Y H U J K`.

Select **Fullscreen** to expand the canvas and hide all on-screen controls. Press `Esc` to leave fullscreen.

Use **Scene mappings** to assign a MIDI note or drum pad to each scene. Mapped notes switch scenes without being forwarded to the synth. Use **Quality: Performance** to reduce rendering cost for AirPlay or slower displays.

## Build

```bash
npm run build
```

According to Codex, the implementation is divided into:

- `MidiGateway`: input/output access, raw MIDI forwarding, and normalization
- `MusicPainterScene`: shared `mount`, `handle`, `reset`, and `destroy` contract
- `createScene(id, quality)`: constructs a fresh scene by its stable ID
- `Painter`: forwards normalized music events to the active scene
- `src/scenes/sun-shimmer`: self-contained musical shimmer scene
- `src/scenes/cloud-parallax`: finite cloud journey and kite actor
- `src/scenes/cloud-parallax-no-kite`: note-driven clouds that gather over the sun as the painting falls into dusk
- `src/scenes/ancient-forest`: cinematic forest camera and note-driven effects
- `src/transitions`: reusable visual transitions between specific scene pairs
