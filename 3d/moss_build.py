"""
550C // MOSS-LIKE PROCEDURAL BUILD
Blender 4.x script.

Usage (Windows, Blender installed):
  "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe" -b -P "D:\\数据库\\3d\\moss_build.py"

Outputs:
  D:\\数据库\\3d\\moss.glb
  D:\\数据库\\3d\\moss-preview.png
  D:\\数据库\\3d\\moss.blend

This is an original, MOSS-inspired industrial camera unit. It is not a
1:1 reproduction of the film asset.
"""

import bpy
import math
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_GLB = os.path.join(ROOT, "moss.glb")
OUT_PNG = os.path.join(ROOT, "moss-preview.png")
OUT_BLEND = os.path.join(ROOT, "moss.blend")

MODEL = []


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                   bpy.data.lights, bpy.data.cameras):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def material(name, color, metallic=0.0, roughness=0.5,
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


# ----------------------------------------------------------------------------
# build
# ----------------------------------------------------------------------------

clear_scene()

# palette: white industrial armor, dark metal, red lens
M_WHITE = material("Armor_White", (0.78, 0.79, 0.76), metallic=0.22, roughness=0.34)
M_WHITE2 = material("Armor_White_Warm", (0.62, 0.63, 0.60), metallic=0.28, roughness=0.4)
M_DARK = material("Metal_Dark", (0.035, 0.042, 0.05), metallic=0.65, roughness=0.34)
M_BLACK = material("Rubber_Black", (0.008, 0.009, 0.01), metallic=0.05, roughness=0.78)
M_STEEL = material("Steel", (0.38, 0.4, 0.42), metallic=0.9, roughness=0.24)
M_BRASS = material("Brass", (0.55, 0.38, 0.16), metallic=0.9, roughness=0.3)
M_RED = material("Lens_Red", (0.55, 0.01, 0.005), metallic=0.3, roughness=0.15,
                 emission=(1.0, 0.015, 0.005), emission_strength=6.0)
M_RED_DIM = material("Lens_Red_Dim", (0.4, 0.005, 0.002), metallic=0.2, roughness=0.2,
                     emission=(0.8, 0.01, 0.003), emission_strength=2.2)
M_GLASS = material("Lens_Glass", (0.3, 0.34, 0.38), metallic=0.1, roughness=0.05,
                   transmission=0.65, ior=1.48)
M_AMBER = material("Indicator_Amber", (0.7, 0.35, 0.02), metallic=0.2, roughness=0.25,
                   emission=(1.0, 0.45, 0.02), emission_strength=3.0)

# root
root = bpy.data.objects.new("MOSS_Root", None)
bpy.context.collection.objects.link(root)
root.empty_display_type = "PLAIN_AXES"
root.empty_display_size = 0.2

# central body: 1.55 wide, 1.25 deep, 1.65 high
body_z = 1.62
box("Body_Core", (0, 0, body_z), (1.55, 1.25, 1.65), M_WHITE, bevel=0.045)
box("Body_Front_Recess", (0, 0.60, body_z), (1.16, 0.08, 1.22), M_DARK, bevel=0.02)
box("Body_Top", (0, 0, body_z + 0.86), (1.3, 1.05, 0.13), M_WHITE2, bevel=0.025)
box("Body_Bottom", (0, 0, body_z - 0.86), (1.12, 0.95, 0.12), M_DARK, bevel=0.02)

# front corner armor
for sx in (-1, 1):
    box("Front_Pillar_%s" % sx, (sx * 0.66, 0.63, body_z), (0.18, 0.12, 1.5), M_WHITE, bevel=0.02)
box("Front_Brow", (0, 0.645, body_z + 0.62), (1.18, 0.1, 0.18), M_WHITE2, bevel=0.02)
box("Front_Chin", (0, 0.645, body_z - 0.64), (1.02, 0.1, 0.16), M_DARK, bevel=0.015)

# side armor / vents
for sx in (-1, 1):
    box("Side_Panel_%s" % sx, (sx * 0.80, 0, body_z), (0.1, 0.96, 1.32), M_WHITE2, bevel=0.02)
    box("Side_Inset_%s" % sx, (sx * 0.86, -0.05, body_z), (0.035, 0.7, 0.92), M_DARK, bevel=0.012)
    for i in range(5):
        box("Vent_%s_%s" % (sx, i), (sx * 0.885, -0.05, body_z - 0.3 + i * 0.14),
            (0.02, 0.55, 0.04), M_BLACK, bevel=0.006)
    # shoulder joint
    cyl("Shoulder_%s" % sx, (sx * 0.86, -0.05, body_z + 0.72), 0.17, 0.24, M_STEEL,
        rot=(0, math.radians(90), 0), verts=32, bevel=0.012)
    sphere("ShoulderCap_%s" % sx, (sx * 0.99, -0.05, body_z + 0.72), 0.16, M_DARK,
           scale=(0.5, 1, 1))

# back heat sink
for i in range(7):
    box("Heatsink_%s" % i, (0, -0.68, body_z - 0.5 + i * 0.17),
        (0.82, 0.12, 0.045), M_DARK, bevel=0.008)

# lens assembly (front = +Y)
lens_y = 0.64
lens_z = body_z
cyl("Lens_Base", (0, lens_y + 0.04, lens_z), 0.72, 0.22, M_WHITE2,
    rot=(math.radians(90), 0, 0), verts=64, bevel=0.018)
cyl("Lens_Barrel", (0, lens_y + 0.18, lens_z), 0.56, 0.3, M_DARK,
    rot=(math.radians(90), 0, 0), verts=64, bevel=0.018)
cyl("Lens_Inner", (0, lens_y + 0.34, lens_z), 0.44, 0.16, M_BLACK,
    rot=(math.radians(90), 0, 0), verts=64)
torus("Lens_Rim", (0, lens_y + 0.43, lens_z), 0.5, 0.045, M_STEEL,
      rot=(math.radians(90), 0, 0))
torus("Lens_Red_Ring", (0, lens_y + 0.445, lens_z), 0.34, 0.026, M_RED,
      rot=(math.radians(90), 0, 0))
cyl("Lens_Red_Glass", (0, lens_y + 0.44, lens_z), 0.29, 0.025, M_RED,
    rot=(math.radians(90), 0, 0), verts=64)
sphere("Lens_Pupil", (0, lens_y + 0.455, lens_z), 0.11, M_BLACK,
       scale=(1, 0.35, 1), segments=32, rings=16)
torus("Lens_Glass_Rim", (0, lens_y + 0.46, lens_z), 0.43, 0.018, M_GLASS,
      rot=(math.radians(90), 0, 0))

# lens bolts
for i in range(12):
    a = i / 12 * math.tau
    x = math.cos(a) * 0.61
    z = lens_z + math.sin(a) * 0.61
    cyl("Lens_Bolt_%02d" % i, (x, lens_y + 0.46, z), 0.024, 0.026, M_STEEL,
        rot=(math.radians(90), 0, 0), verts=16)

# iris blades
for i in range(8):
    a = i / 8 * math.tau
    x = math.cos(a) * 0.37
    z = lens_z + math.sin(a) * 0.37
    box("Iris_Blade_%02d" % i, (x, lens_y + 0.47, z), (0.2, 0.018, 0.055),
        M_STEEL, bevel=0.004,
        rot=(0, 0, a + math.radians(35)))

# front panel seams and bolts
for sx in (-1, 1):
    box("Front_Seam_%s" % sx, (sx * 0.5, 0.665, body_z + 0.76),
        (0.02, 0.012, 0.26), M_BLACK)
    for j in range(3):
        cyl("Panel_Bolt_%s_%s" % (sx, j),
            (sx * 0.56, 0.675, body_z + 0.42 + j * 0.16),
            0.022, 0.018, M_STEEL, rot=(math.radians(90), 0, 0), verts=12)

# amber status strip + red side lamp
box("Status_Strip", (0, 0.66, body_z + 0.78), (0.42, 0.012, 0.025), M_AMBER, bevel=0.004)
for sx in (-1, 1):
    sph = sphere("Status_Lamp_%s" % sx, (sx * 0.86, 0.52, body_z + 0.5), 0.035, M_RED_DIM,
                 segments=16, rings=8)

# gimbal top
cyl("Gimbal_Post", (0, 0, body_z + 1.15), 0.14, 0.5, M_STEEL, verts=32, bevel=0.012)
sphere("Gimbal_Joint", (0, 0, body_z + 1.42), 0.19, M_DARK, segments=32, rings=16)
box("Gimbal_Yoke_Top", (0, 0, body_z + 1.55), (0.92, 0.3, 0.14), M_WHITE2, bevel=0.02)
for sx in (-1, 1):
    box("Yoke_Arm_%s" % sx, (sx * 0.52, 0, body_z + 1.1), (0.12, 0.2, 0.75), M_WHITE, bevel=0.018)
    cyl("Yoke_Joint_%s" % sx, (sx * 0.58, 0, body_z + 0.73), 0.15, 0.24, M_STEEL,
        rot=(0, math.radians(90), 0), verts=32, bevel=0.01)
    sphere("Yoke_Cap_%s" % sx, (sx * 0.72, 0, body_z + 0.73), 0.13, M_DARK,
           scale=(0.45, 1, 1))

# ceiling rail
box("Ceiling_Rail", (0, 0, body_z + 1.98), (1.35, 0.6, 0.12), M_DARK, bevel=0.02)
box("Ceiling_Plate", (0, 0, body_z + 1.9), (0.55, 0.42, 0.1), M_STEEL, bevel=0.015)
for sx in (-1, 1):
    for sy in (-1, 1):
        cable("Cable_%s_%s" % (sx, sy),
              [(sx * 0.45, sy * 0.22, body_z + 1.88),
               (sx * 0.62, sy * 0.3, body_z + 1.55),
               (sx * 0.5, sy * 0.4, body_z + 1.18),
               (sx * 0.35, sy * 0.44, body_z + 1.02)],
              0.018, M_BLACK)

# side mechanical arms
for sx in (-1, 1):
    box("Arm_Upper_%s" % sx, (sx * 0.98, -0.02, body_z + 0.55),
        (0.16, 0.18, 0.62), M_WHITE, bevel=0.02, rot=(0, math.radians(sx * 8), 0))
    cyl("Arm_Elbow_%s" % sx, (sx * 1.06, -0.02, body_z + 0.2), 0.13, 0.2, M_STEEL,
        rot=(0, math.radians(90), 0), verts=32, bevel=0.01)
    box("Arm_Fore_%s" % sx, (sx * 1.12, -0.02, body_z - 0.12),
        (0.12, 0.14, 0.52), M_WHITE2, bevel=0.015, rot=(0, math.radians(sx * -10), 0))
    sphere("Arm_Tip_%s" % sx, (sx * 1.17, -0.02, body_z - 0.38), 0.09, M_DARK)

# small grille / vents on front chin
for i in range(6):
    box("Chin_Vent_%s" % i, (-0.34 + i * 0.135, 0.665, body_z - 0.48),
        (0.07, 0.018, 0.12), M_BLACK, bevel=0.004)

# antenna / sensor
cyl("Sensor_Stem", (0.46, 0.2, body_z + 0.88), 0.018, 0.22, M_STEEL, verts=12)
sphere("Sensor_Tip", (0.46, 0.2, body_z + 1.0), 0.05, M_RED_DIM, segments=16, rings=8)

# mount all model objects under root
for obj in MODEL:
    obj.parent = root

# subtle animation on root
scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = 120
scene.render.fps = 24
root.rotation_mode = "XYZ"
for frame, rz, dz in [(1, 0.0, 0.0), (60, 0.035, 0.025), (120, 0.0, 0.0)]:
    root.rotation_euler[2] = rz
    root.location[2] = dz
    root.keyframe_insert(data_path="rotation_euler", frame=frame)
    root.keyframe_insert(data_path="location", frame=frame)

# ----------------------------------------------------------------------------
# preview scene
# ----------------------------------------------------------------------------

# backdrop
bpy.ops.mesh.primitive_plane_add(size=20, location=(0, -4.0, 0))
back = bpy.context.object
back.name = "Preview_Backdrop"
back.rotation_euler = (math.radians(90), 0, 0)
back.data.materials.append(material("Backdrop", (0.008, 0.01, 0.014), roughness=0.72))

bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, -0.95))
floor = bpy.context.object
floor.name = "Preview_Floor"
floor.data.materials.append(material("Floor", (0.006, 0.008, 0.011), roughness=0.6))

# camera
bpy.ops.object.camera_add(location=(4.2, 6.8, 3.4))
cam = bpy.context.object
cam.name = "Preview_Camera"
cam.data.lens = 58

target = bpy.data.objects.new("Preview_Target", None)
bpy.context.collection.objects.link(target)
target.location = (0, 0, 1.55)
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
    point_at(obj, (0, 0, 1.55))
    return obj

area("Key_Softbox", (-4.2, 3.8, 5.2), 900, 5.0, (1.0, 0.95, 0.88))
area("Fill_Cool", (4.6, 2.8, 2.4), 280, 4.0, (0.55, 0.78, 1.0))
area("Rim_Warm", (0.0, -3.5, 4.8), 700, 3.0, (1.0, 0.55, 0.25))

bpy.ops.object.light_add(type="POINT", location=(0, 1.25, 1.62))
lens_light = bpy.context.object
lens_light.name = "Lens_Red_Glow"
lens_light.data.energy = 18
lens_light.data.color = (1.0, 0.02, 0.01)
lens_light.data.shadow_soft_size = 0.25

# world
world = bpy.data.worlds.new("MOSS_World")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.006, 0.008, 0.012, 1.0)
bg.inputs[1].default_value = 0.22

# render settings
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
    scene.eevee.taa_render_samples = 64
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
    glare.threshold = 0.75
    glare.size = 7
    comp = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], comp.inputs["Image"])
except Exception as exc:
    print("Compositor setup skipped:", exc)

# ----------------------------------------------------------------------------
# export
# ----------------------------------------------------------------------------

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
