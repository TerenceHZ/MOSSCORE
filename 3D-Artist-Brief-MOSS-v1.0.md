# MOSS-like Hard-Surface 3D Asset — Artist Brief v1.0

**Project:** 550C / MOSS-like command core  
**Use:** Electron + Three.js real-time app  
**Style:** white industrial suspended camera unit, deep red T-800-like eye, black/gold/white holographic line-art  
**Note:** Original design inspired by the references. Not a 1:1 reproduction of the film asset.

---

## 1. What we need

A suspended, industrial camera head with:

- White/off-white armored body, separate panels, panel gaps
- Large central lens: barrel, dark lens well, aperture blades, glass, red eye
- Top gimbal: yoke, crossbar, joints, hydraulic pistons
- Side mechanical arms: shoulder, elbow, forearm
- Exposed cables running from the top mount to the body and side loops
- Details: bolts, service panels, heat sinks, vents, warning strips, sensors, antenna
- Top mount / ceiling rail for suspension

The model will later be rendered as a **thin-line hologram**. That means the underlying geometry must have clean bevels, clear panel breaks, and separate parts. A smooth blockout will not work.

---

## 2. Eye direction

- Small, deep red glowing optical core
- Black socket
- White/metal mechanical ring
- Reference: T-800 eye — small, deep, intense
- The eye is the **only red element** in the final scene

---

## 3. Proportions

- Body height: ~1.6–1.8 m
- Total height with gimbal: ~3.0–3.4 m
- Lens outer diameter: ~0.6–0.7 m
- Vertical silhouette, not a cube
- Must read as a suspended unit at 10% screen size

---

## 4. Technical spec

### Units / orientation

- Meters
- Y-up
- Front facing +Z
- Origin at the top suspension point
- Apply all transforms

### Geometry

- 150k–250k triangles target; 300k acceptable with explanation
- Separate named parts (do not merge everything)
- No ngons; quad-first
- Clean bevels/creases for edge extraction
- Hard-surface paneling, not smooth sci-fi blob

### Naming

```text
MOSS_Root
MOSS_Head
MOSS_Lens_Housing
MOSS_Lens_Barrel
MOSS_Iris
MOSS_Eye
MOSS_Gimbal_Yoke
MOSS_Gimbal_Joint
MOSS_Arm_L
MOSS_Arm_R
MOSS_Cable_01 ... 04
MOSS_Top_Mount
```

### Textures

- PBR: Base Color / Roughness / Metallic / Normal / AO / Emissive
- 4K preferred, 2K acceptable
- Packed, no baked lighting
- Separate emissive for the eye
- Must survive GLB export; avoid exotic Blender-only nodes

### Rig

- Root / Head / Gimbal / Arms / Iris / Eye
- Iris open/close
- Gimbal pan/tilt
- Cables can sway slightly
- No facial rig needed

### Animation (preferred)

- `Idle` 8s: sway, cable motion, eye pulse
- `Scan` 4s: gimbal turn, iris open
- `Lock` 3s: focus, eye brighten
- `Broadcast` 3s: iris close/open

### Export

- GLB / glTF 2.0
- FBX backup
- .blend source
- No cameras, lights, or background
- Named animation clips
- Embedded textures or textures folder

---

## 5. Deliverables

1. `moss.glb`
2. `moss.fbx`
3. `moss.blend`
4. `textures/`
5. 4K stills: front, 3/4, side, eye close-up
6. 10s turntable MP4
7. Wireframe / edge render
8. Part naming list

---

## 6. Art direction

### Reference A — film MOSS still

- White industrial armor, warm white, gray seams
- Large central lens, dark well, red pupil
- Suspended gimbal, top arm, side arms, exposed cables
- Bolts, service panels, vents, warning labels
- Low 3/4 camera, shallow depth of field, strong rim light

### Reference B — HORIZON FORGE line-art

- Engineering sketch, not regular wireframe
- Thick silhouette, thin internal structure
- Concentric rings, gears, central shaft, supports
- Depth fade, hand-drawn jitter, black background

Use these for **density, detail hierarchy, and lighting**. Do not copy the film character 1:1.

---

## 7. Palette

```text
Warm white  #D8D5CC
Gunmetal    #1A1D21
Gold        #C9A35A
White       #F2F0E8
Eye red     #FF1A1A
```

No cyan, purple, or rainbow neon. Red only for the eye.

---

## 8. Acceptance

- Silhouette reads at 10% size
- Real panel breaks, bolts, gimbal, cables
- Lens has internal depth, not a flat disc
- White armor does not look like plastic
- Eye reads as a deep red optical core
- Clean edge/wireframe render provided
- GLB imports cleanly in Three.js

---

## 9. Milestones

1. Blockout / silhouette + wireframe
2. High-poly / part breakdown
3. Low-poly / UV / textures
4. Rig / animation
5. Final GLB + preview

Payment per approved milestone.

---

## 10. Budget / timeline

- Model + textures: $500–1,500
- Rig + basic animation: $300–1,000
- Total: ~$800–2,500
- Timeline: 2–4 weeks

Final quote based on portfolio and scope.

---

## 11. Rights

- Original design, not a 1:1 film replica
- Full buyout of the delivered asset for the project
- Artist may not resell the same asset
- Reference images are for style communication only

---

## 12. First message to the artist

> Hi — I need a hard-surface 3D asset for a sci-fi command cockpit: a suspended white industrial camera unit with a deep red T-800-like eye, gimbal, side arms, exposed cables, and a detailed lens. It will be rendered as a black/gold/white line-art hologram, so clean bevels and separate parts are essential.  
> Deliverables: GLB + PBR textures + rig, 150–250k tris, 4K textures.  
> Please send 2 hard-surface robot/camera pieces, wireframe screenshots, and a quote.  
> Original design; not a 1:1 film replica.
