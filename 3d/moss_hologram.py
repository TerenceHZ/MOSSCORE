"""
550C // MOSS HOLOGRAM RENDER

Loads moss-v2.blend, strips the solid armor to black, keeps the red lens,
and renders a thin-line hologram in 550C amber + cyan with Freestyle.

Usage:
  "D:\\Blender\\blender.exe" -b -P "D:\\数据库\\3d\\moss_hologram.py"

Output:
  D:\\数据库\\3d\\moss-hologram-v2.png
"""

import bpy
import math
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
BLEND = os.path.join(ROOT, "moss-v2.blend")
OUT = os.path.join(ROOT, "moss-hologram-v2.png")

if not os.path.exists(BLEND):
    raise SystemExit("moss-v2.blend not found. Run moss_build_v2.py first.")

bpy.ops.wm.open_mainfile(filepath=BLEND)
scene = bpy.context.scene


def black_material():
    mat = bpy.data.materials.get("Hologram_Black")
    if mat:
        return mat
    mat = bpy.data.materials.new("Hologram_Black")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    return mat


BLACK = black_material()
KEEP_SOLID = ("Lens_Red_Disc", "Lens_Red_Ring", "Lens_Pupil", "Lens_Glass_Rim")

for obj in list(scene.objects):
    if obj.name.startswith("Preview_"):
        obj.hide_render = True
    if obj.name.startswith("BackPanel_"):
        obj.hide_render = True
    if obj.type != "MESH":
        continue
    if any(obj.name.startswith(prefix) for prefix in KEEP_SOLID):
        continue
    obj.data.materials.clear()
    obj.data.materials.append(BLACK)

# black world
if scene.world and scene.world.use_nodes:
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.0, 0.0, 0.0, 1.0)
        bg.inputs[1].default_value = 0.0

# render engine: Cycles is reliable with Freestyle
try:
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
except Exception:
    pass

scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = OUT

# Freestyle
scene.render.use_freestyle = True
scene.render.line_thickness_mode = "ABSOLUTE"
scene.render.line_thickness = 1.0

view_layer = scene.view_layers[0]
fs = view_layer.freestyle_settings
for ls in list(fs.linesets):
    fs.linesets.remove(ls)

# outer silhouette: amber
ls1 = fs.linesets.new("MOSS_SILHOUETTE")
ls1.select_silhouette = True
ls1.select_border = True
ls1.select_crease = False
ls1.select_edge_mark = False
style1 = bpy.data.linestyles.new("Holo_Amber")
style1.color = (1.0, 0.52, 0.08)
style1.thickness = 1.8
ls1.linestyle = style1

# structural creases: cyan
ls2 = fs.linesets.new("MOSS_CREASES")
ls2.select_silhouette = False
ls2.select_border = False
ls2.select_crease = True
ls2.select_edge_mark = False
style2 = bpy.data.linestyles.new("Holo_Cyan")
style2.color = (0.18, 0.85, 0.88)
style2.thickness = 0.9
ls2.linestyle = style2

fs.crease_angle = math.radians(135)

# glow
try:
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    rl = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    glare.quality = "HIGH"
    glare.threshold = 0.2
    glare.size = 7
    comp = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], comp.inputs["Image"])
except Exception as exc:
    print("compositor skipped:", exc)

try:
    scene.render.filepath = OUT
    bpy.ops.render.render(write_still=True)
    print("HOLOGRAM:", OUT)
except Exception as exc:
    print("HOLOGRAM RENDER FAILED:", exc)
