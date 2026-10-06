# Cloud pano v3 reference pack

This folder permanently preserves the native-resolution images used to build the
four-layer cloud panorama. Each panel is 2172 x 724 pixels. The final panos are
8688 x 724 pixels and live in `public/images/cloud-layers-pano-v3/`.

## Left-to-right scene order

The application begins on scene D at the right and scrolls toward scene A at the
left.

| Scene | Background | Far middle | Near middle | Foreground |
| --- | --- | --- | --- | --- |
| A: dark storm | `extension-panels/10-a-storm-background.png` | `extension-panels/01-a-storm-far-middle.png` | `extension-panels/02-a-storm-near-middle.png` | `extension-panels/03-a-storm-foreground.png` |
| B: storm buildup | `extension-panels/11-b-buildup-background.png` | `extension-panels/04-b-buildup-far-middle.png` | `extension-panels/05-b-buildup-near-middle.png` | `extension-panels/06-b-buildup-foreground.png` |
| C: luminous transition | `extension-panels/12-c-transition-background.png` | `extension-panels/07-c-transition-far-middle.png` | `extension-panels/08-c-transition-near-middle.png` | `extension-panels/09-c-transition-foreground.png` |
| D: sun opening | `graded-first-scene/01-background-sky-sun.png` | `graded-first-scene/02-far-middle-clouds.png` | `graded-first-scene/03-near-middle-clouds.png` | `graded-first-scene/04-foreground-clouds.png` |

## Folder contents

- `original-first-scene/`: untouched source sprites for the original sun scene.
- `graded-first-scene/`: color-matched versions used in pano v3.
- `extension-panels/`: the 12 generated scene panels used to extend the pano.
- `seam-repair-patches/`: native-resolution painted bridges for all three joins
  and all four depth layers.

Seam patch layer numbers are:

- `01`: background sky and sun
- `02`: far-middle clouds
- `03`: near-middle clouds
- `04`: foreground clouds

Seam numbers are:

- `seam-1`: scene A to scene B
- `seam-2`: scene B to scene C
- `seam-3`: scene C to scene D

## Rebuild scripts

- `scripts/assemble-cloud-pano-v2.py` assembles and repairs the extended pano.
- `scripts/grade-cloud-first-scene.py` grades scene D, blends its join, and
  writes the active v3 panos.

All transparent layers must retain their alpha channels. Do not resize a panel
before stitching; add future panels at the same 2172 x 724 native resolution.
