# Music Painter

A browser-based MIDI canvas that turns a live keyboard performance into animated paintings. It includes a musical sun-and-cloud scene, a finite parallax cloud journey with a pitch-driven kite, and an ancient forest with chord ribbons, ripples, and drifting leaves. Music Painter can also forward the original MIDI messages to a connected synth.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL in Chrome and:

1. Select **Connect MIDI** and grant permission.
2. Choose the Arturia under **In**.
3. Choose the synth under **Out**.
4. Turn on **Thru** to forward the performance to the synth.

You can test without a controller using the computer keys `A W S E D F T G Y H U J K`.

Select **Fullscreen** to expand the canvas and hide all on-screen controls. Press `Esc` to leave fullscreen.

Use **Scene mappings** to assign a MIDI note or drum pad to each scene. Mapped notes switch scenes without being forwarded to the synth. Use **Quality: Performance** to reduce rendering cost for AirPlay or slower displays.

## Build

```bash
npm run build
```

The implementation is divided into:

- `MidiGateway`: input/output access, raw MIDI forwarding, and normalization
- `MusicPainterScene`: shared `mount`, `handle`, `reset`, and `destroy` contract
- `createScene(id, quality)`: constructs a fresh scene by its stable ID
- `Painter`: forwards normalized music events to the active scene
- `src/scenes/sun-shimmer`: self-contained musical shimmer scene
- `src/scenes/cloud-parallax`: finite cloud journey and kite actor
- `src/scenes/cloud-parallax-no-kite`: note-driven clouds that gather over the sun as the painting falls into dusk
- `src/scenes/ancient-forest`: cinematic forest camera and note-driven effects
- `src/transitions`: reusable visual transitions between specific scene pairs
