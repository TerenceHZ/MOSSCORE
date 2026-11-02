"""
550C // MOSS LINE-ART HOLOGRAM

This pass turns the MOSS geometry into a line-only hologram:
- no solid surfaces
- every remaining edge becomes a very thin emissive line
- amber body / white details
- only the eye is solid red
- orbital rings around the body
- a little spatial jitter so lines feel sketched, not CAD

Usage:
  "D:\\Blender\\blender.exe" -b -P "D:\\数据库\\3d\\moss_lineart.py"

Output:
  D:\\数据库\\3d\\moss-lineart-v2.png
"""

import bpy
import math
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
BLEND = os.path.join(ROOT, "moss-v2.blend")
OUT = os.path.join(ROOT, "moss-lineart-v2.png")

if not os.path.exists(BLEND):
    raise SystemExit("moss-v2.blend not found. Run moss_build_v2.py first.")

bpy.ops.wm.open_mainfile(filepath=BLEND)
scene = bpy.context.scene


def emission_mat(name, color, strength):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
    bsdf.inputs["Metallic"].default_value = 0
    bsdf.inputs["Roughness"].default_value = 1
    for key in ("Emission Color", "Emission"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = (*color, 1)
            break
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = strength
    mat.use_backface_culling = False
    return mat


M_AMBER_LINE = emission_mat("Line_Gold", (1.0, 0.56, 0.13), 3.2)
M_WHITE_LINE = emission_mat("Line_White", (0.95, 0.94, 0.86), 2.4)
M_EYE = emission_mat("Eye_Red", (1.0, 0.015, 0.004), 5.0)
M_SOCKET = bpy.data.materials.get("Eye_Socket")
if M_SOCKET is None:
    M_SOCKET = bpy.data.materials.new("Eye_Socket")
    M_SOCKET.use_nodes = True
    bsdf = M_SOCKET.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.4
    bsdf.inputs["Roughness"].default_value = 0.5

# a very small texture for line jitter
noise_tex = bpy.data.textures.new("LineJitter", type="CLOUDS")
noise_tex.noise_scale = 0.18
noise_tex.noise_depth = 2

# hide the solid preview environment
for obj in list(scene.objects):
    if obj.name.startswith("Preview_"):
        obj.hide_render = True
    if obj.name.startswith("BackPanel_"):
        obj.hide_render = True

KEEP = ("Lens_Red_Disc", "Lens_Pupil")

for obj in list(scene.objects):
    if obj.type != "MESH":
        continue
    if any(obj.name.startswith(prefix) for prefix in KEEP):
        obj.data.materials.clear()
        obj.data.materials.append(M_SOCKET)
        continue

    white = (
        obj.name.startswith("Lens_")
        or obj.name.startswith("Cable")
        or obj.name.startswith("Side_Vent")
        or obj.name.startswith("Heatsink")
        or obj.name.startswith("Hologram_Orbit")
    )
    obj.data.materials.clear()
    obj.data.materials.append(M_WHITE_LINE if white else M_AMBER_LINE)

    wire = obj.modifiers.new("LineOnly", "WIREFRAME")
    wire.thickness = 0.0013 if white else 0.0018
    wire.use_replace = True
    wire.use_boundary = True
    wire.use_even_offset = True

    jitter = obj.modifiers.new("LineJitter", "DISPLACE")
    jitter.texture = noise_tex
    jitter.strength = 0.0018 if white else 0.0024
    jitter.mid_level = 0.5

# small T-800-like red eye core
bpy.ops.mesh.primitive_uv_sphere_add(
    segments=32, ring_count=16, radius=0.075,
    location=(0, 1.105, 1.66)
)
eye = bpy.context.object
eye.name = "MOSS_Eye_Core"
eye.data.materials.append(M_EYE)
# orbital line rings around the body
RINGS = [
    (1.05, (0, 0, 0)),
    (1.22, (math.radians(68), 0, math.radians(18))),
    (1.40, (math.radians(-62), math.radians(12), math.radians(-24))),
]
for i, (radius, rot) in enumerate(RINGS):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=radius, minor_radius=0.0022,
        major_segments=96, minor_segments=6,
        location=(0, 0, 1.68), rotation=rot,
    )
    ring = bpy.context.object
    ring.name = "Hologram_Orbit_%s" % i
    ring.data.materials.append(M_WHITE_LINE)

# world black
if scene.world and scene.world.use_nodes:
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0, 0, 0, 1)
        bg.inputs[1].default_value = 0

# render
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = OUT
for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try:
        scene.render.engine = engine
        break
    except Exception:
        continue
try:
    scene.eevee.taa_render_samples = 64
except Exception:
    pass
try:
    scene.view_settings.look = "AgX - Medium High Contrast"
except Exception:
    pass

# bloom
try:
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    rl = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    glare.quality = "HIGH"
    glare.threshold = 0.35
    glare.size = 8
    comp = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], comp.inputs["Image"])
except Exception as exc:
    print("compositor skipped:", exc)

try:
    bpy.ops.render.render(write_still=True)
    print("LINEART:", OUT)
except Exception as exc:
    print("LINEART RENDER FAILED:", exc)
