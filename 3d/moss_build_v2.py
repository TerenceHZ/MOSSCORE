"""
550C // MOSS-LIKE PROCEDURAL BUILD v2

Blender 4.x / 5.x
Usage:
  "D:\\Blender\\blender.exe" -b -P "D:\\数据库\\3d\\moss_build_v2.py"

Outputs:
  D:\\数据库\\3d\\moss-preview-v2.png
  D:\\数据库\\3d\\moss-v2.glb
  D:\\数据库\\3d\\moss-v2.blend

Original, MOSS-inspired industrial camera unit. Not a 1:1 film asset.
"""

import bpy
import math
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_GLB = os.path.join(ROOT, "moss-v2.glb")
OUT_PNG = os.path.join(ROOT, "moss-preview-v2.png")
OUT_WIRE = os.path.join(ROOT, "moss-wireframe-v2.png")
OUT_BLEND = os.path.join(ROOT, "moss-v2.blend")

MODEL = []


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                   bpy.data.lights, bpy.data.cameras):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def base_material(name, color, metallic=0.0, roughness=0.5,
                  emission=None, emission_strength=0.0,
                  transmission=0.0, ior=1.45):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = ior
    for key in ("Transmission Weight", "Transmission"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = transmission
            break
    if emission is not None:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*emission, 1.0)
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    mat.use_backface_culling = False
    return mat


def armor_material(name, color, roughness=0.42):
    mat = base_material(name, color, metallic=0.18, roughness=roughness)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")

    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 9.0
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Roughness"].default_value = 0.62

    mix = None
    try:
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        fac = mix.inputs["Factor"]
        color_a = mix.inputs["A"]
        color_b = mix.inputs["B"]
        color_out = mix.outputs["Result"]
    except Exception:
        mix = nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MIX"
        fac = mix.inputs["Fac"]
        color_a = mix.inputs["Color1"]
        color_b = mix.inputs["Color2"]
        color_out = mix.outputs["Color"]
    color_a.default_value = (*color, 1.0)
    color_b.default_value = (color[0] * 0.45, color[1] * 0.45, color[2] * 0.43, 1.0)
    links.new(noise.outputs["Fac"], fac)
    links.new(color_out, bsdf.inputs["Base Color"])

    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.22
    bump.inputs["Distance"].default_value = 0.035
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    rough = nodes.new("ShaderNodeMapRange")
    rough.inputs["From Min"].default_value = 0.0
    rough.inputs["From Max"].default_value = 1.0
    rough.inputs["To Min"].default_value = max(0.18, roughness - 0.12)
    rough.inputs["To Max"].default_value = min(0.85, roughness + 0.12)
    links.new(noise.outputs["Fac"], rough.inputs["Value"])
    links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    return mat


def metal_material(name, color, roughness=0.3):
    mat = base_material(name, color, metallic=0.85, roughness=roughness)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 18.0
    noise.inputs["Detail"].default_value = 4.0
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    bump.inputs["Distance"].default_value = 0.012
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def register(obj, mat=None, bevel=0.0):
    if mat:
        obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("EdgeBevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    MODEL.append(obj)
    return obj


def box(name, loc, size, mat, bevel=0.0, rot=(0.0, 0.0, 0.0)):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return register(obj, mat, bevel)


def cyl(name, loc, radius, depth, mat, rot=(0.0, 0.0, 0.0), verts=48, bevel=0.0):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot
    )
    obj = bpy.context.object
    obj.name = name
    return register(obj, mat, bevel)


def sphere(name, loc, radius, mat, scale=(1.0, 1.0, 1.0), segments=32, rings=16):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=radius, location=loc
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return register(obj, mat)


def torus(name, loc, major, minor, mat, rot=(0.0, 0.0, 0.0)):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor,
        major_segments=48, minor_segments=12,
        location=loc, rotation=rot
    )
    obj = bpy.context.object
    obj.name = name
    return register(obj, mat)


def cable(name, points, radius, mat):
    bpy.ops.object.select_all(action="DESELECT")
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 16
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for i, p in enumerate(points):
        bp = spline.bezier_points[i]
        bp.co = Vector(p)
        bp.handle_left_type = "AUTO"
        bp.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    MODEL.append(obj)
    return obj


def point_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


# ---------------------------------------------------------------------------
clear_scene()

M_WHITE = armor_material("Armor_White", (0.62, 0.63, 0.60), roughness=0.46)
M_WHITE2 = armor_material("Armor_White_Warm", (0.46, 0.47, 0.44), roughness=0.52)
M_DARK = metal_material("Metal_Dark", (0.022, 0.026, 0.032), roughness=0.38)
M_BLACK = base_material("Rubber_Black", (0.006, 0.007, 0.008), metallic=0.02, roughness=0.82)
M_STEEL = metal_material("Steel", (0.28, 0.30, 0.32), roughness=0.24)
M_BRASS = metal_material("Brass", (0.46, 0.31, 0.12), roughness=0.3)
M_RED = base_material("Lens_Red", (0.32, 0.005, 0.002), metallic=0.15, roughness=0.22,
                      emission=(1.0, 0.02, 0.005), emission_strength=2.8)
M_RED_DIM = base_material("Lens_Red_Dim", (0.18, 0.003, 0.001), metallic=0.1, roughness=0.3,
                          emission=(0.65, 0.01, 0.002), emission_strength=1.1)
M_GLASS = base_material("Lens_Glass", (0.08, 0.09, 0.10), metallic=0.65, roughness=0.045,
                        transmission=0.2, ior=1.48)
M_AMBER = base_material("Indicator_Amber", (0.52, 0.25, 0.01), metallic=0.2, roughness=0.3,
                        emission=(1.0, 0.42, 0.01), emission_strength=2.0)
M_WIRE = base_material("Wireframe_White", (0.7, 0.82, 0.95), metallic=0.0, roughness=0.3,
                       emission=(0.65, 0.82, 1.0), emission_strength=2.6)

root = bpy.data.objects.new("MOSS_Root", None)
bpy.context.collection.objects.link(root)
root.empty_display_type = "PLAIN_AXES"
root.empty_display_size = 0.2

# proportions: narrower / taller than v1
body_z = 1.68
body_w = 1.32
body_d = 1.0
body_h = 1.82

box("Body_Core", (0, 0, body_z), (body_w, body_d, body_h), M_WHITE, bevel=0.055)
box("Body_Front_Recess", (0, body_d / 2 + 0.018, body_z), (1.04, 0.075, 1.26), M_DARK, bevel=0.02)
box("Body_Top_Cap", (0, 0, body_z + body_h / 2 + 0.04), (1.18, 0.9, 0.12), M_WHITE2, bevel=0.025)
box("Body_Bottom_Cap", (0, 0, body_z - body_h / 2 - 0.04), (1.02, 0.78, 0.11), M_DARK, bevel=0.02)

# front armor pillars / brow / chin
for sx in (-1, 1):
    box("Front_Pillar_%s" % sx, (sx * 0.58, body_d / 2 + 0.025, body_z),
        (0.17, 0.11, 1.6), M_WHITE, bevel=0.022)
box("Front_Brow", (0, body_d / 2 + 0.04, body_z + 0.67), (1.02, 0.1, 0.17), M_WHITE2, bevel=0.02)
box("Front_Chin", (0, body_d / 2 + 0.04, body_z - 0.7), (0.92, 0.1, 0.14), M_DARK, bevel=0.015)

# side pods
for sx in (-1, 1):
    box("Side_Pod_%s" % sx, (sx * 0.77, -0.02, body_z), (0.22, 0.74, 1.38), M_WHITE2, bevel=0.03)
    box("Side_Inset_%s" % sx, (sx * 0.875, -0.08, body_z), (0.035, 0.55, 0.92), M_DARK, bevel=0.012)
    for i in range(6):
        box("Side_Vent_%s_%s" % (sx, i), (sx * 0.90, -0.10, body_z - 0.32 + i * 0.13),
            (0.018, 0.42, 0.035), M_BLACK, bevel=0.004)
    for j in range(4):
        cyl("Side_Bolt_%s_%s" % (sx, j), (sx * 0.895, 0.18, body_z - 0.4 + j * 0.27),
            0.021, 0.016, M_STEEL, rot=(0, math.radians(90), 0), verts=12)
    # shoulder
    cyl("Shoulder_%s" % sx, (sx * 0.82, 0.02, body_z + 0.76), 0.16, 0.2, M_STEEL,
        rot=(0, math.radians(90), 0), verts=32, bevel=0.012)
    sphere("ShoulderCap_%s" % sx, (sx * 0.94, 0.02, body_z + 0.76), 0.15, M_DARK,
           scale=(0.55, 1, 1))

# back heat sink
for i in range(8):
    box("Heatsink_%s" % i, (0, -body_d / 2 - 0.08, body_z - 0.58 + i * 0.17),
        (0.76, 0.13, 0.038), M_DARK, bevel=0.006)
for i in range(4):
    box("Back_Rail_%s" % i, (0, -body_d / 2 - 0.16, body_z - 0.6 + i * 0.38),
        (0.06, 0.04, 1.05), M_STEEL, bevel=0.006)

# lens assembly
lens_y = body_d / 2 + 0.02
lens_z = body_z - 0.02
cyl("Lens_Cowl", (0, lens_y + 0.04, lens_z), 0.68, 0.14, M_WHITE, rot=(math.radians(90), 0, 0), verts=64, bevel=0.02)
cyl("Lens_Housing", (0, lens_y + 0.18, lens_z), 0.58, 0.34, M_DARK, rot=(math.radians(90), 0, 0), verts=64, bevel=0.02)
cyl("Lens_Barrel", (0, lens_y + 0.38, lens_z), 0.48, 0.22, M_DARK, rot=(math.radians(90), 0, 0), verts=64, bevel=0.015)
torus("Lens_Outer_Ring", (0, lens_y + 0.50, lens_z), 0.55, 0.045, M_STEEL, rot=(math.radians(90), 0, 0))
torus("Lens_Inner_Ring", (0, lens_y + 0.515, lens_z), 0.40, 0.026, M_STEEL, rot=(math.radians(90), 0, 0))
cyl("Lens_Recess", (0, lens_y + 0.36, lens_z), 0.39, 0.12, M_BLACK, rot=(math.radians(90), 0, 0), verts=64)
# glass rim + red glow, deep inside
torus("Lens_Glass_Rim", (0, lens_y + 0.54, lens_z), 0.39, 0.012, M_GLASS, rot=(math.radians(90), 0, 0))
cyl("Lens_Red_Disc", (0, lens_y + 0.50, lens_z), 0.21, 0.02, M_RED, rot=(math.radians(90), 0, 0), verts=64)
torus("Lens_Red_Ring", (0, lens_y + 0.55, lens_z), 0.245, 0.018, M_RED, rot=(math.radians(90), 0, 0))
sphere("Lens_Pupil", (0, lens_y + 0.56, lens_z), 0.07, M_BLACK, scale=(1, 0.4, 1), segments=24, rings=12)

# aperture blades: 10 overlapping dark steel blades
for i in range(10):
    a = i / 10 * math.tau
    x = math.cos(a) * 0.325
    z = lens_z + math.sin(a) * 0.325
    box("Aperture_Blade_%02d" % i, (x, lens_y + 0.545, z), (0.22, 0.012, 0.045),
        M_STEEL, bevel=0.003, rot=(0, 0, a + math.radians(42)))

# lens bolts
for i in range(14):
    a = i / 14 * math.tau
    cyl("Lens_Bolt_%02d" % i, (math.cos(a) * 0.605, lens_y + 0.515, lens_z + math.sin(a) * 0.605),
        0.022, 0.022, M_STEEL, rot=(math.radians(90), 0, 0), verts=12)

# front panel seams
for sx in (-1, 1):
    box("Front_Seam_%s" % sx, (sx * 0.48, body_d / 2 + 0.085, body_z + 0.76),
        (0.016, 0.012, 0.3), M_BLACK)
    for j in range(3):
        cyl("Front_Bolt_%s_%s" % (sx, j), (sx * 0.52, body_d / 2 + 0.09, body_z + 0.42 + j * 0.16),
            0.018, 0.014, M_STEEL, rot=(math.radians(90), 0, 0), verts=12)

# amber status strip / red lamps
box("Status_Strip", (0, body_d / 2 + 0.09, body_z + 0.8), (0.36, 0.01, 0.02), M_AMBER, bevel=0.003)
for sx in (-1, 1):
    sphere("Status_Lamp_%s" % sx, (sx * 0.79, 0.44, body_z + 0.52), 0.028, M_RED_DIM,
           segments=16, rings=8)

# gimbal
cyl("Gimbal_Post", (0, 0, body_z + 1.14), 0.13, 0.5, M_STEEL, verts=32, bevel=0.012)
sphere("Gimbal_Joint", (0, 0, body_z + 1.42), 0.18, M_DARK, segments=32, rings=16)
box("Gimbal_Crossbar", (0, 0, body_z + 1.55), (0.95, 0.28, 0.12), M_WHITE2, bevel=0.02)
for sx in (-1, 1):
    box("Yoke_Arm_%s" % sx, (sx * 0.54, 0.0, body_z + 1.12), (0.12, 0.18, 0.72), M_WHITE, bevel=0.018)
    cyl("Yoke_Joint_%s" % sx, (sx * 0.60, 0.0, body_z + 0.74), 0.145, 0.22, M_STEEL,
        rot=(0, math.radians(90), 0), verts=32, bevel=0.01)
    sphere("Yoke_Cap_%s" % sx, (sx * 0.73, 0.0, body_z + 0.74), 0.125, M_DARK,
           scale=(0.45, 1, 1))

# side mechanical arms
for sx in (-1, 1):
    box("Arm_Upper_%s" % sx, (sx * 0.98, -0.04, body_z + 0.5), (0.16, 0.18, 0.7),
        M_WHITE, bevel=0.02, rot=(0, math.radians(sx * 10), 0))
    cyl("Arm_Elbow_%s" % sx, (sx * 1.08, -0.04, body_z + 0.13), 0.13, 0.2, M_STEEL,
        rot=(0, math.radians(90), 0), verts=32, bevel=0.01)
    box("Arm_Fore_%s" % sx, (sx * 1.16, -0.04, body_z - 0.17), (0.12, 0.14, 0.55),
        M_WHITE2, bevel=0.015, rot=(0, math.radians(sx * -12), 0))
    sphere("Arm_Tip_%s" % sx, (sx * 1.22, -0.04, body_z - 0.43), 0.085, M_DARK)
    # hydraulic piston
    cyl("Piston_%s" % sx, (sx * 1.02, 0.12, body_z + 0.24), 0.035, 0.5, M_STEEL,
        rot=(0, math.radians(sx * 18), 0), verts=12)

# overhead rail and cables
box("Ceiling_Rail", (0, 0, body_z + 2.0), (1.4, 0.55, 0.12), M_DARK, bevel=0.02)
box("Ceiling_Plate", (0, 0, body_z + 1.92), (0.55, 0.4, 0.1), M_STEEL, bevel=0.015)
for sx in (-1, 1):
    for sy in (-1, 1):
        cable("Cable_%s_%s" % (sx, sy),
              [(sx * 0.52, sy * 0.2, body_z + 1.9),
               (sx * 0.7, sy * 0.34, body_z + 1.55),
               (sx * 0.6, sy * 0.44, body_z + 1.18),
               (sx * 0.42, sy * 0.46, body_z + 1.02)],
              0.016, M_BLACK)
# side loops
for sx in (-1, 1):
    cable("Cable_Loop_%s" % sx,
          [(sx * 0.84, 0.25, body_z + 0.8),
           (sx * 1.02, 0.4, body_z + 0.4),
           (sx * 0.95, 0.36, body_z - 0.05),
           (sx * 0.8, 0.2, body_z - 0.25)],
          0.012, M_BLACK)

# antenna and sensor
cyl("Antenna_Stem", (0.42, 0.18, body_z + 0.94), 0.018, 0.24, M_STEEL, verts=12)
sphere("Antenna_Tip", (0.42, 0.18, body_z + 1.07), 0.05, M_RED_DIM, segments=16, rings=8)
cyl("Sensor", (-0.44, 0.52, body_z + 0.62), 0.055, 0.08, M_DARK,
    rot=(math.radians(90), 0, 0), verts=24)
sphere("Sensor_Glass", (-0.44, 0.57, body_z + 0.62), 0.035, M_RED_DIM, segments=16, rings=8)

# warning strip on side
for i in range(5):
    box("Warn_%s" % i, (-0.91, 0.32, body_z - 0.5 + i * 0.07),
        (0.012, 0.22, 0.045), M_AMBER if i % 2 == 0 else M_BLACK, bevel=0.002,
        rot=(0, math.radians(90), 0))

for obj in MODEL:
    obj.parent = root

# subtle sway animation
scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = 120
scene.render.fps = 24
root.rotation_mode = "XYZ"
for frame, rz, dz in [(1, 0.0, 0.0), (60, 0.028, 0.018), (120, 0.0, 0.0)]:
    root.rotation_euler[2] = rz
    root.location[2] = dz
    root.keyframe_insert(data_path="rotation_euler", frame=frame)
    root.keyframe_insert(data_path="location", frame=frame)

# ---------------------------------------------------------------------------
# preview environment
# ---------------------------------------------------------------------------

# dark industrial backdrop + white angular panels
bpy.ops.mesh.primitive_plane_add(size=24, location=(0, -4.0, 2.2))
back = bpy.context.object
back.name = "Preview_Backdrop"
back.rotation_euler = (math.radians(90), 0, 0)
back.data.materials.append(base_material("Backdrop", (0.006, 0.008, 0.012), roughness=0.72))

bpy.ops.mesh.primitive_plane_add(size=24, location=(0, 0, -1.05))
floor = bpy.context.object
floor.name = "Preview_Floor"
floor.data.materials.append(base_material("Floor", (0.004, 0.005, 0.008), metallic=0.2, roughness=0.35))

# angular wall panels
for i, (x, z, w, h, rot) in enumerate([
    (-4.2, 3.0, 3.5, 3.2, 0.18),
    (3.8, 3.4, 3.8, 3.0, -0.22),
    (-2.6, 0.8, 2.4, 2.0, 0.35),
    (2.5, 0.5, 2.2, 1.8, -0.3),
]):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -3.85, z), rotation=(0, rot, 0))
    panel = bpy.context.object
    panel.name = "BackPanel_%s" % i
    panel.scale = (w, 0.06, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    panel.data.materials.append(M_WHITE2 if i % 2 == 0 else M_DARK)
    mod = panel.modifiers.new("Bevel", "BEVEL")
    mod.width = 0.025
    mod.segments = 2

# camera
bpy.ops.object.camera_add(location=(3.6, 6.0, 3.0))
cam = bpy.context.object
cam.name = "Preview_Camera"
cam.data.lens = 68

target = bpy.data.objects.new("Preview_Target", None)
bpy.context.collection.objects.link(target)
target.location = (0, 0, 1.72)
con = cam.constraints.new(type="TRACK_TO")
con.target = target
con.track_axis = "TRACK_NEGATIVE_Z"
con.up_axis = "UP_Y"
scene.camera = cam

# lights
def area(name, loc, energy, size, color_value):
    bpy.ops.object.light_add(type="AREA", location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.data.energy = energy
    obj.data.shape = "SQUARE"
    obj.data.size = size
    obj.data.color = color_value
    point_at(obj, (0, 0, 1.65))
    return obj

area("Key_Softbox", (-3.8, 4.2, 5.4), 1100, 4.2, (1.0, 0.93, 0.84))
area("Fill_Cool", (4.8, 2.4, 2.2), 220, 4.0, (0.5, 0.72, 1.0))
area("Rim_Warm", (0.0, -3.8, 4.6), 900, 3.0, (1.0, 0.55, 0.28))

bpy.ops.object.light_add(type="POINT", location=(0, 1.35, 1.66))
lens_light = bpy.context.object
lens_light.name = "Lens_Red_Glow"
lens_light.data.energy = 22
lens_light.data.color = (1.0, 0.02, 0.01)
lens_light.data.shadow_soft_size = 0.24

world = bpy.data.worlds.new("MOSS_World_v2")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.005, 0.007, 0.011, 1.0)
bg.inputs[1].default_value = 0.16

scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = OUT_PNG
for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
    try:
        scene.render.engine = engine
        break
    except Exception:
        continue
try:
    scene.eevee.taa_render_samples = 96
except Exception:
    pass
try:
    scene.eevee.use_gtao = True
except Exception:
    pass
try:
    scene.view_settings.look = "AgX - Medium High Contrast"
except Exception:
    pass

# compositor glow
try:
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    rl = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    glare.quality = "HIGH"
    glare.threshold = 0.9
    glare.size = 7
    comp = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], comp.inputs["Image"])
except Exception as exc:
    print("Compositor setup skipped:", exc)

# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
for obj in MODEL:
    try:
        obj.select_set(True)
    except Exception:
        pass
bpy.context.view_layer.objects.active = root

bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_animations=True,
)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

print("MODEL_OBJECTS:", len(MODEL))
print("GLB:", OUT_GLB)
print("BLEND:", OUT_BLEND)

try:
    bpy.ops.render.render(write_still=True)
    print("PREVIEW:", OUT_PNG)
except Exception as exc:
    print("RENDER FAILED:", exc)


# ---------------------------------------------------------------------------
# optional wireframe preview (550C hologram look)
# ---------------------------------------------------------------------------

def render_wireframe():
    keep_solid = ("Lens_Red_Disc", "Lens_Red_Ring", "Lens_Pupil", "Lens_Glass_Rim")
    for obj in MODEL:
        if obj.type != "MESH":
            continue
        if any(obj.name.startswith(prefix) for prefix in keep_solid):
            continue
        try:
            obj.data.materials.clear()
            obj.data.materials.append(M_WIRE)
            mod = obj.modifiers.new("HologramWire", "WIREFRAME")
            mod.thickness = 0.007
            mod.use_replace = True
            mod.use_boundary = True
            mod.use_even_offset = True
        except Exception as exc:
            print("wireframe skip:", obj.name, exc)

    # hide the solid preview set; keep only the hologram + lights
    for obj in bpy.context.scene.objects:
        if obj.name.startswith("Preview_"):
            obj.hide_render = True
        if obj.name.startswith("BackPanel_"):
            obj.hide_render = True

    try:
        scene.render.filepath = OUT_WIRE
        bpy.ops.render.render(write_still=True)
        print("WIREFRAME PREVIEW:", OUT_WIRE)
    except Exception as exc:
        print("WIREFRAME RENDER FAILED:", exc)


render_wireframe()

