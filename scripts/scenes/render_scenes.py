"""Procedural "sample room" scenes for the slab visualiser (kitchen + bathroom).

Run with the Blender-as-a-module Python (bpy 5.0.x, Cycles CPU + OpenImageDenoise):

    export SCENES_WORK=/some/tmp/dir                      # EXRs + metadata go here
    python scripts/scenes/render_scenes.py --scene kitchen  --samples 80 --threshold 0.02
    python scripts/scenes/render_scenes.py --scene bathroom --samples 80 --threshold 0.02
    python scripts/scenes/postprocess.py                  # -> public/scenes/* + data/scenes.json

    --preview          quick low-res beauty (+ passes) for look development
    --meta-only        rebuild the scene and only recompute the projected surface quads

View transform is "Standard" (plain sRGB, exposure 0): the web compositor rebuilds a
replaced surface as  albedo * diffuse + gloss  in linear and sRGB-encodes it, so the
beauty must use the same pipeline. Light levels are set so the replaceable surfaces
stay below 1.0 except right next to the windows.

Every scene is rendered three times with identical light transport. Only what
*camera rays* see changes between the renders (Light Path "Is Camera Ray" mix
inserted into every material, see add_overrides / set_mode):

  beauty   normal materials (+ Cryptomatte object pass for the masks and the raw
           light passes, used by postprocess.py to verify the other two)
  diffuse  camera rays see a white (albedo 1) Lambertian surface, so the
           denoised Combined equals Diffuse Direct + Diffuse Indirect
  gloss    replaceable surfaces show only their specular lobe (Principled with a
           black base colour, same roughness/IOR) = Glossy Color * (Glossy
           Direct + Glossy Indirect); everything else is black

Doing it this way (instead of reading the raw light passes) means OIDN denoises
the lighting/gloss passes too. Each replaceable surface is its own object with the
neutral placeholder material (Principled, base 0.78, roughness 0.35); the slab
objects include their visible 30-40 mm edges.
"""
import argparse
import json
import math
import os
import sys
import time

import bpy  # noqa: E402  (bpy must be imported before bmesh/mathutils)
import bmesh
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_WORK = os.environ.get("SCENES_WORK", os.path.join("/tmp", "fervital-scenes-work"))

PLACEHOLDER_ALBEDO = 0.78
PLACEHOLDER_ROUGHNESS = 0.35

# --------------------------------------------------------------------------------------
# scene / geometry helpers
# --------------------------------------------------------------------------------------


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
        for item in list(coll):
            coll.remove(item)


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


HEX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def bm_hexa(bm, pts):
    """8 points: bottom (x0y0, x1y0, x1y1, x0y1) then top in the same order."""
    vs = [bm.verts.new(p) for p in pts]
    for f in HEX_FACES:
        bm.faces.new([vs[i] for i in f])
    return vs


def box_pts(x0, x1, y0, y1, z0, z1):
    return [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]


def bm_box(bm, x0, x1, y0, y1, z0, z1):
    return bm_hexa(bm, box_pts(x0, x1, y0, y1, z0, z1))


def make_obj(name, bm, mat, bevel=0.0, segments=2, smooth=False, harden=True, sharp_deg=50.0):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    if smooth or bevel > 0:
        # keep flat caps / hard creases flat under smooth shading
        lim = math.radians(sharp_deg)
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > lim:
                e.smooth = False
    bm.to_mesh(me)
    bm.free()
    if smooth or bevel > 0:
        me.shade_smooth()
    ob = link(bpy.data.objects.new(name, me))
    if isinstance(mat, (list, tuple)):
        for m in mat:
            me.materials.append(m)
    elif mat is not None:
        me.materials.append(mat)
    if bevel > 0:
        md = ob.modifiers.new("Bevel", "BEVEL")
        md.width = bevel
        md.segments = segments
        md.limit_method = "ANGLE"
        md.angle_limit = math.radians(35)
        md.harden_normals = harden
        md.use_clamp_overlap = True
    return ob


def box(name, x0, x1, y0, y1, z0, z1, mat, bevel=0.0, segments=2):
    bm = bmesh.new()
    bm_box(bm, x0, x1, y0, y1, z0, z1)
    return make_obj(name, bm, mat, bevel=bevel, segments=segments)


def hexa(name, pts, mat, bevel=0.0, segments=2):
    bm = bmesh.new()
    bm_hexa(bm, pts)
    return make_obj(name, bm, mat, bevel=bevel, segments=segments)


def rounded_rect_prism(name, cx, cy, sx, sy, z0, z1, r, mat, segs=6, bevel=0.0):
    """Vertical prism with a rounded-rectangle footprint (used as boolean cutter etc.)."""
    bm = bmesh.new()
    pts = []
    hx, hy = sx / 2 - r, sy / 2 - r
    for (ox, oy, a0) in ((hx, hy, 0), (-hx, hy, 90), (-hx, -hy, 180), (hx, -hy, 270)):
        for i in range(segs + 1):
            a = math.radians(a0 + 90.0 * i / segs)
            pts.append((cx + ox + r * math.cos(a), cy + oy + r * math.sin(a)))
    bot = [bm.verts.new((x, y, z0)) for x, y in pts]
    top = [bm.verts.new((x, y, z1)) for x, y in pts]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([bot[i], bot[j], top[j], top[i]])
    return make_obj(name, bm, mat, bevel=bevel)


def lathe(name, profile, mat, loc=(0, 0, 0), segs=64, smooth=True):
    """Revolve a (radius, z) polyline around the local Z axis."""
    bm = bmesh.new()
    vs = [bm.verts.new((max(r, 0.0), 0.0, z)) for r, z in profile]
    es = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1),
                   angle=2 * math.pi, steps=segs, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = make_obj(name, bm, mat, smooth=smooth)
    ob.location = loc
    return ob


def cylinder(name, x, y, z0, z1, r, mat, segs=32, smooth=True, axis="Z"):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r, radius2=r, depth=(z1 - z0))
    ob = make_obj(name, bm, mat, smooth=smooth)
    if axis == "Z":
        ob.location = (x, y, (z0 + z1) / 2)
    return ob


def tube_curve(name, pts, radius, mat, res=6):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, c in zip(sp.points, pts):
        p.co = (c[0], c[1], c[2], 1.0)
    sp.use_smooth = True
    ob = link(bpy.data.objects.new(name, cu))
    cu.materials.append(mat)
    return ob


def boolean_cut(ob, cutter):
    md = ob.modifiers.new("Cut", "BOOLEAN")
    md.operation = "DIFFERENCE"
    md.solver = "EXACT"
    md.object = cutter
    cutter.hide_render = True
    cutter.hide_viewport = True
    # boolean must come before bevel
    if len(ob.modifiers) > 1:
        ob.modifiers.move(len(ob.modifiers) - 1, 0)


def kelvin(t):
    """Approximate linear-Rec709 colour of a blackbody, normalised to max channel 1."""
    t = t / 100.0
    if t <= 66:
        r = 255.0
        g = 99.4708025861 * math.log(t) - 161.1195681661
        b = 0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    else:
        r = 329.698727446 * ((t - 60) ** -0.1332047592)
        g = 288.1221695283 * ((t - 60) ** -0.0755148492)
        b = 255.0
    c = [min(max(v, 0.0), 255.0) / 255.0 for v in (r, g, b)]
    lin = [((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c]
    m = max(lin)
    return tuple(v / m for v in lin)


def light(name, kind, loc, rot=(0, 0, 0), energy=10.0, color=(1, 1, 1), size=0.1, size_y=None,
          shape="RECTANGLE", spread=None, spot_size=None, spot_blend=None, radius=None,
          specular=1.0):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    ld.specular_factor = specular
    if kind == "AREA":
        ld.shape = shape
        ld.size = size
        ld.size_y = size_y if size_y is not None else size
        if spread is not None:
            ld.spread = spread
    if kind in ("POINT", "SPOT"):
        ld.shadow_soft_size = radius if radius is not None else 0.05
    if kind == "SPOT":
        ld.spot_size = spot_size or math.radians(90)
        ld.spot_blend = spot_blend if spot_blend is not None else 0.5
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    ob.rotation_euler = rot
    ob.visible_camera = False
    return ob


# --------------------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------------------

REPLACEABLE_MATS = set()


def _new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (900, 0)
    return m, nt, out


def _noise(nt, scale, detail=4.0, rough=0.55, coords=None, dim="3D", w_scale=None):
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.noise_dimensions = dim
    tex.inputs["Scale"].default_value = scale
    tex.inputs["Detail"].default_value = detail
    tex.inputs["Roughness"].default_value = rough
    if coords is None:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        coords = tc.outputs["Object"]
    if w_scale is not None:
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = w_scale
        nt.links.new(coords, mp.inputs["Vector"])
        coords = mp.outputs["Vector"]
    nt.links.new(coords, tex.inputs["Vector"])
    return tex


def _map_range(nt, src, a, b, lo=0.0, hi=1.0):
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.clamp = True
    mr.inputs["From Min"].default_value = lo
    mr.inputs["From Max"].default_value = hi
    mr.inputs["To Min"].default_value = a
    mr.inputs["To Max"].default_value = b
    nt.links.new(src, mr.inputs["Value"])
    return mr.outputs["Result"]


def _mix_rgb(nt, fac, c1, c2):
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.blend_type = "MIX"
    nt.links.new(fac, mx.inputs["Factor"])
    mx.inputs[6].default_value = (*c1, 1.0)
    mx.inputs[7].default_value = (*c2, 1.0)
    return mx.outputs[2]


def mat_principled(name, base, rough=0.5, metallic=0.0, spec=0.5, rough_var=0.0, rough_scale=6.0,
                   color_var=0.0, color_scale=3.0, bump=0.0, bump_scale=200.0, coat=0.0,
                   coat_rough=0.1, aniso=0.0, emission=None, emission_strength=0.0,
                   stretch=None):
    m, nt, out = _new_mat(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (400, 0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Specular IOR Level"].default_value = spec
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = coat_rough
    bsdf.inputs["Anisotropic"].default_value = aniso
    if color_var > 0:
        n = _noise(nt, color_scale, 5.0, 0.6, w_scale=stretch)
        c1 = tuple(max(0.0, v * (1 - color_var)) for v in base)
        c2 = tuple(min(1.0, v * (1 + color_var)) for v in base)
        nt.links.new(_mix_rgb(nt, _map_range(nt, n.outputs["Fac"], 0, 1, 0.3, 0.7), c1, c2),
                     bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    if rough_var > 0:
        n = _noise(nt, rough_scale, 6.0, 0.6, w_scale=stretch)
        nt.links.new(_map_range(nt, n.outputs["Fac"], rough - rough_var, rough + rough_var, 0.3, 0.7),
                     bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = rough
    if bump > 0:
        n = _noise(nt, bump_scale, 8.0, 0.65, w_scale=stretch)
        bp = nt.nodes.new("ShaderNodeBump")
        bp.inputs["Strength"].default_value = bump
        bp.inputs["Distance"].default_value = 0.0005
        nt.links.new(n.outputs["Fac"], bp.inputs["Height"])
        nt.links.new(bp.outputs["Normal"], bsdf.inputs["Normal"])
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return m


def mat_placeholder():
    m, nt, out = _new_mat("M_placeholder")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    a = PLACEHOLDER_ALBEDO
    bsdf.inputs["Base Color"].default_value = (a, a, a, 1.0)
    bsdf.inputs["Roughness"].default_value = PLACEHOLDER_ROUGHNESS
    bsdf.inputs["Specular IOR Level"].default_value = 0.5
    bsdf.inputs["IOR"].default_value = 1.5
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    REPLACEABLE_MATS.add(m.name)
    return m


def mat_plaster(name, base, var=0.06, rough=0.9, bump=0.08):
    """Warm lime plaster: large soft clouding + fine trowel texture."""
    m, nt, out = _new_mat(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    big = _noise(nt, 0.9, 6.0, 0.62, coords=tc.outputs["Object"])
    mid = _noise(nt, 7.0, 4.0, 0.5, coords=tc.outputs["Object"])
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY_ADD"
    nt.links.new(mid.outputs["Fac"], mul.inputs[0])
    mul.inputs[1].default_value = 0.35
    nt.links.new(big.outputs["Fac"], mul.inputs[2])
    c1 = tuple(v * (1 - var) for v in base)
    c2 = tuple(min(1.0, v * (1 + var)) for v in base)
    nt.links.new(_mix_rgb(nt, _map_range(nt, mul.outputs[0], 0, 1, 0.45, 0.95), c1, c2),
                 bsdf.inputs["Base Color"])
    nt.links.new(_map_range(nt, mid.outputs["Fac"], rough - 0.06, rough + 0.04, 0.3, 0.7),
                 bsdf.inputs["Roughness"])
    fine = _noise(nt, 90.0, 8.0, 0.7, coords=tc.outputs["Object"])
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = bump
    bp.inputs["Distance"].default_value = 0.0008
    nt.links.new(fine.outputs["Fac"], bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Specular IOR Level"].default_value = 0.35
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return m


def mat_wood(name, dark, light_, rough=0.55, vertical=True, scale=1.0):
    """Smoked oak: fine stretched noise grain + soft low-frequency clouding (procedural)."""
    m, nt, out = _new_mat(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    s = scale
    mp.inputs["Scale"].default_value = (140 * s, 140 * s, 2.0 * s) if vertical else (2.0 * s, 140 * s, 140 * s)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    grain = nt.nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 1.0
    grain.inputs["Detail"].default_value = 6.0
    grain.inputs["Roughness"].default_value = 0.6
    nt.links.new(mp.outputs["Vector"], grain.inputs["Vector"])
    cloud = _noise(nt, 2.5, 3.0, 0.5, coords=tc.outputs["Object"])
    mix = nt.nodes.new("ShaderNodeMath")
    mix.operation = "MULTIPLY_ADD"
    nt.links.new(grain.outputs["Fac"], mix.inputs[0])
    mix.inputs[1].default_value = 0.75
    nt.links.new(cloud.outputs["Fac"], mix.inputs[2])
    fac = _map_range(nt, mix.outputs[0], 0.0, 1.0, 0.55, 1.35)
    nt.links.new(_mix_rgb(nt, fac, dark, light_), bsdf.inputs["Base Color"])
    nt.links.new(_map_range(nt, grain.outputs["Fac"], rough + 0.06, rough - 0.08, 0.35, 0.65),
                 bsdf.inputs["Roughness"])
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.08
    bp.inputs["Distance"].default_value = 0.0003
    nt.links.new(grain.outputs["Fac"], bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Specular IOR Level"].default_value = 0.45
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return m


def mat_emission(name, color, strength, camera_only=False):
    m, nt, out = _new_mat(name)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1.0)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def mat_exterior(name, strength=6.0, hedge=None):
    """Blown-out daylight seen through windows (camera-visible only).

    hedge=(z_top, rgb, brightness) adds a soft, over-exposed garden band below z_top."""
    m, nt, out = _new_mat(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    grad = _map_range(nt, sep.outputs["Z"], 0.55, 1.0, -0.5, 3.5)
    col = _mix_rgb(nt, grad, (0.80, 0.82, 0.78), (0.94, 0.97, 1.0))
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    sky = nt.nodes.new("ShaderNodeVectorMath")
    sky.operation = "SCALE"
    nt.links.new(col, sky.inputs[0])
    sky.inputs["Scale"].default_value = strength
    if hedge is None:
        nt.links.new(sky.outputs[0], em.inputs["Color"])
    else:
        z_top, hcol, hbright = hedge
        leaf = _noise(nt, 2.2, 8.0, 0.68, coords=tc.outputs["Object"])
        edge = _noise(nt, 0.9, 3.0, 0.5, coords=tc.outputs["Object"])
        # ragged top edge of the hedge
        add = nt.nodes.new("ShaderNodeMath")
        add.operation = "MULTIPLY_ADD"
        nt.links.new(edge.outputs["Fac"], add.inputs[0])
        add.inputs[1].default_value = 0.6
        add.inputs[2].default_value = z_top - 0.3
        diff = nt.nodes.new("ShaderNodeMath")
        diff.operation = "SUBTRACT"
        nt.links.new(sep.outputs["Z"], diff.inputs[0])
        nt.links.new(add.outputs[0], diff.inputs[1])
        fac = _map_range(nt, diff.outputs[0], 0.0, 1.0, -0.12, 0.12)
        lo = tuple(c * hbright * 0.72 for c in hcol)
        hi = tuple(c * hbright * 1.15 for c in hcol)
        hedge_col = _mix_rgb(nt, _map_range(nt, leaf.outputs["Fac"], 0, 1, 0.3, 0.7), lo, hi)
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        nt.links.new(fac, mx.inputs["Factor"])
        nt.links.new(hedge_col, mx.inputs[6])
        nt.links.new(sky.outputs[0], mx.inputs[7])
        nt.links.new(mx.outputs[2], em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def add_overrides():
    """Insert the camera-ray override mix into every material (see module docstring)."""
    for m in bpy.data.materials:
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        if not out.inputs["Surface"].links:
            continue
        lk = out.inputs["Surface"].links[0]
        src = lk.from_socket
        nt.links.remove(lk)
        lp = nt.nodes.new("ShaderNodeLightPath")
        fac = nt.nodes.new("ShaderNodeMath")
        fac.name = "OVR_FAC"
        fac.operation = "MULTIPLY"
        fac.inputs[1].default_value = 0.0
        nt.links.new(lp.outputs["Is Camera Ray"], fac.inputs[0])
        diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
        diff.name = "OVR_DIFF"
        diff.inputs["Color"].default_value = (1, 1, 1, 1)
        diff.inputs["Roughness"].default_value = 0.0
        gl = nt.nodes.new("ShaderNodeBsdfPrincipled")
        gl.name = "OVR_GLOSS"
        gl.inputs["Base Color"].default_value = (0, 0, 0, 1)
        gl.inputs["Roughness"].default_value = PLACEHOLDER_ROUGHNESS
        gl.inputs["Specular IOR Level"].default_value = 0.5
        gl.inputs["IOR"].default_value = 1.5
        sel = nt.nodes.new("ShaderNodeMixShader")
        sel.name = "OVR_SEL"
        sel.inputs[0].default_value = 0.0
        nt.links.new(diff.outputs[0], sel.inputs[1])
        nt.links.new(gl.outputs[0], sel.inputs[2])
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(fac.outputs[0], mix.inputs[0])
        nt.links.new(src, mix.inputs[1])
        nt.links.new(sel.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])


def set_mode(mode):
    for m in bpy.data.materials:
        nodes = m.node_tree.nodes
        if "OVR_FAC" not in nodes:
            continue
        rep = m.name in REPLACEABLE_MATS
        nodes["OVR_FAC"].inputs[1].default_value = 0.0 if mode == "beauty" else 1.0
        if mode == "diffuse":
            nodes["OVR_SEL"].inputs[0].default_value = 0.0
            nodes["OVR_DIFF"].inputs["Color"].default_value = (1, 1, 1, 1)
        elif mode == "gloss":
            nodes["OVR_SEL"].inputs[0].default_value = 1.0 if rep else 0.0
            nodes["OVR_DIFF"].inputs["Color"].default_value = (0, 0, 0, 1)


# --------------------------------------------------------------------------------------
# camera
# --------------------------------------------------------------------------------------


def level_camera(loc, yaw_deg, lens, shift_x=0.0, shift_y=0.0, pitch_deg=0.0):
    cd = bpy.data.cameras.new("Camera")
    cd.lens = lens
    cd.sensor_width = 36.0
    cd.sensor_fit = "HORIZONTAL"
    cd.shift_x = shift_x
    cd.shift_y = shift_y
    cd.clip_start = 0.05
    cd.clip_end = 100.0
    ob = link(bpy.data.objects.new("Camera", cd))
    ob.location = loc
    ob.rotation_euler = (math.radians(90 + pitch_deg), 0.0, math.radians(yaw_deg))
    bpy.context.scene.camera = ob
    return ob


def project(scene, cam, p):
    v = world_to_camera_view(scene, cam, Vector(p))
    w = scene.render.resolution_x
    h = scene.render.resolution_y
    return [v.x * w, (1.0 - v.y) * h, v.z]


# --------------------------------------------------------------------------------------
# KITCHEN
# --------------------------------------------------------------------------------------


def build_kitchen():
    """Room: x 0..6.0 (left wall with garden window at x=0), y -0.8..5.0 (back wall), z 0..2.75."""
    H = 2.75
    WALL_T = 0.25
    m_ph = mat_placeholder()
    m_plaster = mat_plaster("M_plaster", (0.47, 0.43, 0.375))
    m_ceiling = mat_plaster("M_ceiling", (0.62, 0.60, 0.565), var=0.03, bump=0.03)
    m_charcoal = mat_principled("M_charcoal", (0.030, 0.030, 0.029), rough=0.42, rough_var=0.06,
                                color_var=0.06, color_scale=2.0, spec=0.45)
    m_oak = mat_wood("M_smoked_oak", (0.040, 0.030, 0.023), (0.085, 0.066, 0.050), rough=0.5)
    m_black = mat_principled("M_black_steel", (0.018, 0.018, 0.018), rough=0.45, rough_var=0.08, spec=0.5)
    m_kick = mat_principled("M_kick", (0.01, 0.01, 0.01), rough=0.7)
    m_brass = mat_principled("M_brass", (0.72, 0.53, 0.30), rough=0.27, rough_var=0.05,
                             metallic=1.0, aniso=0.4, stretch=(1, 1, 30))
    m_sink = mat_principled("M_sink", (0.035, 0.035, 0.034), rough=0.55, rough_var=0.05)
    m_glaze = mat_principled("M_glaze_oxblood", (0.20, 0.040, 0.034), rough=0.22, rough_var=0.06,
                             color_var=0.10, color_scale=9.0, coat=0.3)
    m_stoneware = mat_principled("M_stoneware", (0.30, 0.27, 0.23), rough=0.75, rough_var=0.08,
                                 color_var=0.12, color_scale=14.0, bump=0.15, bump_scale=300)
    m_shade_in = mat_principled("M_shade_inside", (0.80, 0.78, 0.74), rough=0.6)
    m_bulb = mat_emission("M_bulb", kelvin(2600), 60.0)
    m_ext = mat_exterior("M_exterior", 5.0, hedge=(0.45, (0.86, 0.93, 0.80), 1.45))

    # ---- shell -------------------------------------------------------------------
    OX = 0.45                         # kitchen furniture offset from the window wall
    y_front, y_back, x_left, x_right = -0.8, 5.0, 0.0, 6.0 + OX
    floor = box("floor", -0.3, x_right + 0.3, -1.1, 5.3, -0.05, 0.0, m_ph)
    box("ceiling", -0.3, x_right + 0.3, -1.1, 5.3, H, H + 0.2, m_ceiling)
    box("wall_back", -0.3, x_right + 0.3, y_back, y_back + WALL_T, 0.0, H, m_plaster)
    box("wall_front", -0.3, x_right + 0.3, y_front - WALL_T, y_front, 0.0, H, m_plaster)
    box("wall_right", x_right, x_right + WALL_T, -1.1, 5.3, 0.0, H, m_plaster)
    # left wall with a big steel-framed garden window y 0.9..3.7, z 0..2.45
    wy0, wy1, wz1 = 0.9, 3.7, 2.45
    box("wall_left_a", x_left - WALL_T, x_left, -1.1, wy0, 0.0, H, m_plaster)
    box("wall_left_b", x_left - WALL_T, x_left, wy1, 5.3, 0.0, H, m_plaster)
    box("wall_left_c", x_left - WALL_T, x_left, wy0, wy1, wz1, H, m_plaster)
    # reveal / frame: black steel, glazing bars
    fx0, fx1 = x_left - 0.16, x_left - 0.10
    ft = 0.05
    box("win_frame_l", fx0, fx1, wy0, wy0 + ft, 0.0, wz1, m_black, bevel=0.002)
    box("win_frame_r", fx0, fx1, wy1 - ft, wy1, 0.0, wz1, m_black, bevel=0.002)
    box("win_frame_t", fx0, fx1, wy0, wy1, wz1 - ft, wz1, m_black, bevel=0.002)
    box("win_frame_b", fx0, fx1, wy0, wy1, 0.0, 0.06, m_black, bevel=0.002)
    bar = 0.032
    for i in (1, 2):
        yc = wy0 + (wy1 - wy0) * i / 3.0
        box("win_mullion_%d" % i, fx0 + 0.01, fx1 - 0.01, yc - bar / 2, yc + bar / 2, 0.0, wz1, m_black, bevel=0.002)
    for zc in (0.95, 1.95):
        box("win_transom_%.2f" % zc, fx0 + 0.01, fx1 - 0.01, wy0, wy1, zc - bar / 2, zc + bar / 2, m_black, bevel=0.002)
    ext = box("exterior", -3.5, -3.4, -6.0, 10.0, -2.0, 7.0, m_ext)
    for attr in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_shadow"):
        setattr(ext, attr, False)

    # ---- back run (3.6 m) ----------------------------------------------------------
    TOP_Z, SLAB = 0.90, 0.03
    run_x0, run_x1 = OX, 3.6 + OX
    cy0, cy1 = 4.38, 4.98            # cabinet carcass (door front at 4.38)
    box("run_kick", run_x0, run_x1, 4.46, cy1, 0.0, 0.10, m_kick)
    box("run_carcass", run_x0, run_x1, 4.41, cy1, 0.10, TOP_Z - SLAB, m_charcoal)
    unit = 0.6
    for i in range(6):
        ux0 = run_x0 + i * unit
        if i in (1, 2):   # sink unit: tall doors
            box("run_door_%d" % i, ux0 + 0.0015, ux0 + unit - 0.0015, cy0, 4.41, 0.103, TOP_Z - SLAB - 0.003,
                m_charcoal, bevel=0.0015)
        else:             # two drawers
            box("run_drw_%d_a" % i, ux0 + 0.0015, ux0 + unit - 0.0015, cy0, 4.41, 0.103, 0.478, m_charcoal, bevel=0.0015)
            box("run_drw_%d_b" % i, ux0 + 0.0015, ux0 + unit - 0.0015, cy0, 4.41, 0.482, TOP_Z - SLAB - 0.003,
                m_charcoal, bevel=0.0015)
    # countertop slab with undermount sink cut-out
    ct = box("countertop", run_x0, run_x1, 4.36, cy1, TOP_Z - SLAB, TOP_Z, m_ph, bevel=0.0015, segments=2)
    sink_cx, sink_cy, sink_w, sink_d = 1.30 + OX, 4.70, 0.70, 0.40
    cutter = rounded_rect_prism("sink_cutter", sink_cx, sink_cy, sink_w, sink_d, TOP_Z - 0.2, TOP_Z + 0.2, 0.02, None)
    boolean_cut(ct, cutter)
    # sink bowl (open box, normals inward)
    bm = bmesh.new()
    sx0, sx1 = sink_cx - sink_w / 2 - 0.004, sink_cx + sink_w / 2 + 0.004
    sy0, sy1 = sink_cy - sink_d / 2 - 0.004, sink_cy + sink_d / 2 + 0.004
    vs = bm_box(bm, sx0, sx1, sy0, sy1, TOP_Z - SLAB - 0.21, TOP_Z - SLAB - 0.0005)
    top_face = [f for f in bm.faces if all(abs(v.co.z - (TOP_Z - SLAB - 0.0005)) < 1e-6 for v in f.verts)]
    bmesh.ops.delete(bm, geom=top_face, context="FACES_ONLY")
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    make_obj("sink_bowl", bm, m_sink, bevel=0.01, segments=3)
    cylinder("sink_drain", sink_cx, sink_cy, TOP_Z - SLAB - 0.2105, TOP_Z - SLAB - 0.207, 0.045, m_black)
    # faucet: slim brass column with a high arc spout
    fx, fy = sink_cx, 4.90
    cylinder("faucet_base", fx, fy, TOP_Z, TOP_Z + 0.035, 0.028, m_brass, segs=48)
    pts = []
    zc_top, r_arc = TOP_Z + 0.33, 0.10
    for i in range(12):
        pts.append((fx, fy, TOP_Z + 0.03 + (zc_top - TOP_Z - 0.03) * i / 11.0))
    for i in range(1, 25):
        a = math.pi * i / 24.0
        pts.append((fx, fy - r_arc + r_arc * math.cos(a), zc_top + r_arc * math.sin(a)))
    for i in range(1, 6):
        pts.append((fx, fy - 2 * r_arc, zc_top - 0.06 * i / 5.0))
    tube_curve("faucet_spout", pts, 0.0125, m_brass)
    lever = tube_curve("faucet_lever", [(fx + 0.02, fy, TOP_Z + 0.20), (fx + 0.09, fy + 0.01, TOP_Z + 0.215)],
                       0.005, m_brass)
    cylinder("faucet_lever_hub", fx + 0.018, fy, TOP_Z + 0.19, TOP_Z + 0.215, 0.014, m_brass)
    # stoneware vase on the run (right side)
    lathe("vase", [(0.0, 0.0), (0.055, 0.0), (0.07, 0.03), (0.085, 0.13), (0.08, 0.22), (0.05, 0.30), (0.035, 0.34),
                   (0.038, 0.37), (0.030, 0.372), (0.028, 0.33), (0.0, 0.30)],
          m_stoneware, loc=(3.05 + OX, 4.80, TOP_Z), segs=64)
    # backsplash (full height cladding) on the back wall above the run
    box("backsplash", run_x0, run_x1, cy1, y_back, TOP_Z, H, m_ph, bevel=0.0015)

    # ---- tall cabinets (2.4 m bank right of the run) ----------------------------
    box("tall_kick", run_x1, x_right, 4.46, y_back, 0.0, 0.10, m_kick)
    box("tall_carcass", run_x1, x_right, 4.41, y_back, 0.10, H, m_charcoal)
    for i in range(4):
        ux0 = run_x1 + i * 0.6
        box("tall_door_%d" % i, ux0 + 0.0015, ux0 + 0.6 - 0.0015, cy0, 4.41, 0.103, 2.25, m_charcoal, bevel=0.0015)
        box("tall_top_%d" % i, ux0 + 0.0015, ux0 + 0.6 - 0.0015, cy0, 4.41, 2.254, H - 0.004, m_charcoal, bevel=0.0015)

    # ---- island 2800 x 1100, waterfall at the right end -------------------------
    ix0, ix1, iy0, iy1 = 0.95 + OX, 3.75 + OX, 2.15, 3.25
    hexa("island", [(ix0, iy0, TOP_Z - SLAB), (ix1 - SLAB, iy0, TOP_Z - SLAB), (ix1 - SLAB, iy1, TOP_Z - SLAB),
                    (ix0, iy1, TOP_Z - SLAB), (ix0, iy0, TOP_Z), (ix1, iy0, TOP_Z), (ix1, iy1, TOP_Z), (ix0, iy1, TOP_Z)],
         m_ph, bevel=0.0015)
    hexa("island_side", [(ix1 - SLAB, iy0, 0.0), (ix1, iy0, 0.0), (ix1, iy1, 0.0), (ix1 - SLAB, iy1, 0.0),
                         (ix1 - SLAB, iy0, TOP_Z - SLAB), (ix1, iy0, TOP_Z), (ix1, iy1, TOP_Z), (ix1 - SLAB, iy1, TOP_Z - SLAB)],
         m_ph, bevel=0.0015)
    bx0, bx1, by0, by1 = ix0 + 0.03, ix1 - SLAB, iy0 + 0.05, iy1 - 0.05
    box("island_body", bx0, bx1, by0 + 0.02, by1, 0.10, TOP_Z - SLAB, m_oak)
    box("island_kick", bx0 + 0.06, bx1, by0 + 0.08, by1 - 0.06, 0.0, 0.10, m_kick)
    box("island_end_l", ix0, ix0 + 0.03, iy0 + 0.02, iy1 - 0.02, 0.0, TOP_Z - SLAB, m_oak, bevel=0.002)
    # reeded front (facing the camera side, -y)
    r_reed, pitch = 0.011, 0.024
    n_reeds = int((bx1 - bx0 - 0.01) / pitch)
    off = (bx1 - bx0 - n_reeds * pitch) / 2
    bm = bmesh.new()
    for i in range(n_reeds):
        xc = bx0 + off + pitch * (i + 0.5)
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=r_reed, radius2=r_reed,
                                    depth=TOP_Z - SLAB - 0.10 - 0.004)
        bmesh.ops.translate(bm, verts=res["verts"], vec=(xc, by0 + 0.02 + 0.002, (0.10 + TOP_Z - SLAB) / 2))
    make_obj("island_reeds", bm, m_oak, smooth=True)
    # one oxblood glazed bowl on the island
    lathe("bowl", [(0.0, 0.0), (0.06, 0.0), (0.065, 0.006), (0.10, 0.03), (0.15, 0.075), (0.168, 0.105),
                   (0.162, 0.107), (0.145, 0.082), (0.095, 0.035), (0.0, 0.014)],
          m_glaze, loc=(1.62 + OX, 2.86, TOP_Z), segs=96)

    # ---- pendants over the island ------------------------------------------------
    for i, px in enumerate((1.75 + OX, 2.95 + OX)):
        py, pz = 2.70, 1.72
        dome = [(0.012 + 0.158 * math.cos(t * math.pi / 2), 0.155 * math.sin(t * math.pi / 2))
                for t in [k / 24.0 for k in range(25)]]
        lathe("pendant_shade_%d" % i, dome, m_black, loc=(px, py, pz), segs=128)
        inner = [(r - 0.004, z - 0.003) for r, z in reversed(dome)]
        lathe("pendant_inner_%d" % i, inner, m_shade_in, loc=(px, py, pz), segs=128)
        lathe("pendant_bulb_%d" % i, [(0.0, 0.035), (0.03, 0.045), (0.042, 0.075), (0.03, 0.105), (0.0, 0.112)],
              m_bulb, loc=(px, py, pz), segs=32)
        cylinder("pendant_cord_%d" % i, px, py, pz + 0.15, H, 0.003, m_black, segs=12)
        cylinder("pendant_canopy_%d" % i, px, py, H - 0.02, H, 0.05, m_black, segs=48)
        light("pendant_light_%d" % i, "POINT", (px, py, pz + 0.07), energy=66.0, color=kelvin(2700), radius=0.04)

    # ---- lights ------------------------------------------------------------------
    day = (0.88, 0.94, 1.0)
    # window: big soft area light filling the opening, facing +x
    light("window_light", "AREA", (x_left - 0.18, (wy0 + wy1) / 2, wz1 / 2), rot=(0, math.radians(-90), 0),
          energy=78.0, color=day, size=wz1, size_y=(wy1 - wy0))
    # warm grazing wash on the backsplash from a recessed ceiling slot
    light("slot_light", "AREA", (1.8 + OX, y_back - 0.40, H - 0.01), rot=(math.radians(20), 0, 0),
          energy=5.5, color=kelvin(3200), size=3.5, size_y=0.04, spread=math.radians(70))
    # soft fill from the (unseen) living space behind the camera
    light("fill_light", "AREA", (4.0 + OX, y_front + 0.05, 1.6), rot=(math.radians(-90), 0, 0),
          energy=21.0, color=(1.0, 0.96, 0.9), size=3.0, size_y=1.8)

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bpy.context.scene.world = world

    cam = level_camera((5.35 + OX, 0.25, 1.50), yaw_deg=40.0, lens=28.0, shift_x=0.0, shift_y=-0.12)

    surfaces = {
        "countertop": dict(orientation="horizontal", sizeMm=[3600, 620],
                           rect=[(run_x0, cy1, TOP_Z), (run_x1, cy1, TOP_Z), (run_x1, 4.36, TOP_Z), (run_x0, 4.36, TOP_Z)],
                           objects=["countertop"]),
        "island": dict(orientation="horizontal", sizeMm=[2800, 1100],
                       rect=[(ix0, iy1, TOP_Z), (ix1, iy1, TOP_Z), (ix1, iy0, TOP_Z), (ix0, iy0, TOP_Z)],
                       objects=["island"]),
        "island_side": dict(orientation="vertical", sizeMm=[1100, 900],
                            rect=[(ix1, iy0, TOP_Z), (ix1, iy1, TOP_Z), (ix1, iy1, 0.0), (ix1, iy0, 0.0)],
                            objects=["island_side"]),
        "backsplash": dict(orientation="vertical", sizeMm=[3600, 1850],
                           rect=[(run_x0, cy1, H), (run_x1, cy1, H), (run_x1, cy1, TOP_Z), (run_x0, cy1, TOP_Z)],
                           objects=["backsplash"]),
        "floor": dict(orientation="horizontal", sizeMm=None, rect=None, objects=["floor"],
                      room=(x_left, x_right, y_front, y_back)),
    }
    return cam, surfaces


# --------------------------------------------------------------------------------------
# BATHROOM
# --------------------------------------------------------------------------------------


def cyl_y(name, x, y0, y1, z, r, mat, segs=32):
    """Cylinder whose axis runs along Y from y0 to y1."""
    ob = cylinder(name, 0, 0, -abs(y1 - y0) / 2, abs(y1 - y0) / 2, r, mat, segs=segs)
    ob.location = (x, (y0 + y1) / 2, z)
    ob.rotation_euler = (math.radians(90), 0, 0)
    return ob


def build_bathroom():
    """Room: x 0..3.4 (left wall with frosted window), y -0.6..3.0 (clad back wall), z 0..2.7."""
    G = 1.3            # global light gain (view exposure stays 0)
    H = 2.7
    WALL_T = 0.25
    m_ph = mat_placeholder()
    m_plaster = mat_plaster("M_plaster", (0.47, 0.445, 0.41))
    m_ceiling = mat_plaster("M_ceiling", (0.62, 0.60, 0.565), var=0.03, bump=0.03)
    m_oak = mat_wood("M_smoked_oak", (0.040, 0.030, 0.023), (0.085, 0.066, 0.050), rough=0.5, vertical=False)
    m_black = mat_principled("M_black_steel", (0.018, 0.018, 0.018), rough=0.45, rough_var=0.08, spec=0.5)
    m_brass = mat_principled("M_brass", (0.72, 0.53, 0.30), rough=0.27, rough_var=0.05,
                             metallic=1.0, aniso=0.4, stretch=(1, 30, 1))
    m_ceramic = mat_principled("M_ceramic", (0.80, 0.79, 0.76), rough=0.12, rough_var=0.03, spec=0.5)
    m_mirror = mat_principled("M_mirror", (0.90, 0.90, 0.88), rough=0.0, metallic=1.0)
    m_stoneware = mat_principled("M_stoneware", (0.30, 0.27, 0.23), rough=0.75, rough_var=0.08,
                                 color_var=0.12, color_scale=14.0, bump=0.15, bump_scale=300)
    m_glaze = mat_principled("M_glaze_green", (0.045, 0.085, 0.062), rough=0.22, rough_var=0.06,
                             color_var=0.10, color_scale=9.0, coat=0.3)
    m_frost = mat_exterior("M_frosted", 3.0)

    y_front, y_back, x_left, x_right = -0.6, 3.0, 0.0, 3.4
    CL = 0.02                                       # cladding thickness
    box("floor", -0.3, x_right + 0.3, y_front - 0.3, y_back + 0.3, -0.05, 0.0, m_ph)
    box("ceiling", -0.3, x_right + 0.3, y_front - 0.3, y_back + 0.3, H, H + 0.2, m_ceiling)
    box("wall_back", -0.3, x_right + 0.3, y_back, y_back + WALL_T, 0.0, H, m_plaster)
    # front wall with an open doorway to a softly lit hall (it is what the mirror reflects)
    dx0, dx1, dz1 = 0.30, 1.20, 2.15
    box("wall_front_a", -0.3, dx0, y_front - WALL_T, y_front, 0.0, H, m_plaster)
    box("wall_front_b", dx1, x_right + 0.3, y_front - WALL_T, y_front, 0.0, H, m_plaster)
    box("wall_front_c", dx0, dx1, y_front - WALL_T, y_front, dz1, H, m_plaster)
    hall = box("hall", dx0 - 0.5, dx1 + 0.5, y_front - 1.6, y_front - 1.55, -0.5, 3.0,
               mat_emission("M_hall", (1.0, 0.93, 0.84), 0.55 * G))
    for attr in ("visible_diffuse", "visible_transmission", "visible_shadow"):
        setattr(hall, attr, False)
    box("hall_floor", dx0 - 0.5, dx1 + 0.5, y_front - 1.6, y_front, -0.05, 0.0, m_plaster)
    box("wall_right", x_right, x_right + WALL_T, y_front - 0.3, y_back + 0.3, 0.0, H, m_plaster)
    # full-height clad wall behind the vanity (replaceable surface)
    box("wall", x_left, x_right, y_back - CL, y_back, 0.0, H, m_ph, bevel=0.0015)
    # left wall with a tall frosted window close to the clad wall
    wy0, wy1, wz0, wz1 = 1.30, 2.50, 0.95, 2.40
    box("wall_left_a", x_left - WALL_T, x_left, y_front - 0.3, wy0, 0.0, H, m_plaster)
    box("wall_left_b", x_left - WALL_T, x_left, wy1, y_back + 0.3, 0.0, H, m_plaster)
    box("wall_left_c", x_left - WALL_T, x_left, wy0, wy1, 0.0, wz0, m_plaster)
    box("wall_left_d", x_left - WALL_T, x_left, wy0, wy1, wz1, H, m_plaster)
    fx0, fx1 = x_left - 0.14, x_left - 0.09
    ft = 0.045
    box("win_frame_l", fx0, fx1, wy0, wy0 + ft, wz0, wz1, m_black, bevel=0.002)
    box("win_frame_r", fx0, fx1, wy1 - ft, wy1, wz0, wz1, m_black, bevel=0.002)
    box("win_frame_t", fx0, fx1, wy0, wy1, wz1 - ft, wz1, m_black, bevel=0.002)
    box("win_frame_b", fx0, fx1, wy0, wy1, wz0, wz0 + ft, m_black, bevel=0.002)
    box("win_mullion", fx0 + 0.008, fx1 - 0.008, (wy0 + wy1) / 2 - 0.016, (wy0 + wy1) / 2 + 0.016, wz0, wz1,
        m_black, bevel=0.002)
    pane = box("win_pane", x_left - 0.125, x_left - 0.12, wy0, wy1, wz0, wz1, m_frost)
    for attr in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_shadow"):
        setattr(pane, attr, False)
    pane.visible_glossy = True   # seen in the mirror

    # ---- floating vanity 1600 x 560, stone top 40 mm -----------------------------
    vx0, vx1 = 0.85, 2.45
    vy0, vy1 = y_back - CL - 0.56, y_back - CL
    TOP_Z, SLAB = 0.90, 0.04
    top = box("vanity", vx0, vx1, vy0, vy1, TOP_Z - SLAB, TOP_Z, m_ph, bevel=0.0015)
    bcx, bcy, bw, bd = (vx0 + vx1) / 2, vy0 + 0.27, 0.50, 0.34
    cutter = rounded_rect_prism("basin_cutter", bcx, bcy, bw, bd, TOP_Z - 0.2, TOP_Z + 0.2, 0.045, None)
    boolean_cut(top, cutter)
    # undermount basin (rounded box, open top, normals inward)
    basin = rounded_rect_prism("basin_bowl", bcx, bcy, bw + 0.008, bd + 0.008, TOP_Z - SLAB - 0.16,
                               TOP_Z - SLAB - 0.0005, 0.05, m_ceramic, segs=8)
    bm = bmesh.new()
    bm.from_mesh(basin.data)
    topf = max(bm.faces, key=lambda f: f.calc_center_median().z)
    bmesh.ops.delete(bm, geom=[topf], context="FACES_ONLY")
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(basin.data)
    bm.free()
    md = basin.modifiers.new("Bevel", "BEVEL")
    md.width, md.segments, md.limit_method = 0.03, 4, "ANGLE"
    cylinder("basin_drain", bcx, bcy, TOP_Z - SLAB - 0.161, TOP_Z - SLAB - 0.157, 0.032, m_brass)
    # cabinet: two handle-less drawers under a 25 mm shadow gap
    box("vanity_carcass", vx0 + 0.01, vx1 - 0.01, vy0 + 0.04, vy1, 0.50, TOP_Z - SLAB, m_oak)
    half = (vx1 - vx0) / 2
    for i in range(2):
        x0 = vx0 + 0.012 + i * half
        box("vanity_drawer_%d" % i, x0, x0 + half - 0.024 + 0.0015, vy0 + 0.02, vy0 + 0.04, 0.50,
            TOP_Z - SLAB - 0.025, m_oak, bevel=0.0015)
    # wall-mounted tap (brass) with separate control
    tz = TOP_Z + 0.17
    cyl_y("tap_rosette", bcx, y_back - CL - 0.008, y_back - CL, tz, 0.030, m_brass, segs=48)
    tube_curve("tap_spout", [(bcx, y_back - CL - 0.004, tz), (bcx, y_back - CL - 0.17, tz),
                             (bcx, y_back - CL - 0.19, tz - 0.004), (bcx, y_back - CL - 0.196, tz - 0.016)],
               0.0105, m_brass)
    cx = bcx + 0.30
    cyl_y("tap_ctrl_rosette", cx, y_back - CL - 0.008, y_back - CL, tz, 0.030, m_brass, segs=48)
    cyl_y("tap_ctrl_body", cx, y_back - CL - 0.035, y_back - CL - 0.008, tz, 0.016, m_brass, segs=32)
    tube_curve("tap_ctrl_lever", [(cx, y_back - CL - 0.03, tz), (cx, y_back - CL - 0.035, tz - 0.07)], 0.0045, m_brass)
    # round mirror, black rim, warm halo
    mz, mr, my = 1.60, 0.40, y_back - CL - 0.035
    mirror = cylinder("mirror", 0, 0, -0.003, 0.003, mr - 0.004, m_mirror, segs=128)
    mirror.location, mirror.rotation_euler = (bcx, my, mz), (math.radians(90), 0, 0)
    rim = lathe("mirror_rim", [(mr - 0.004, -0.006), (mr + 0.004, -0.006), (mr + 0.004, 0.012),
                               (mr - 0.004, 0.012), (mr - 0.004, -0.006)], m_black, segs=128)
    rim.location, rim.rotation_euler = (bcx, my, mz), (math.radians(90), 0, 0)
    # black back plate 4..10 mm behind the glass (towards the wall, +Y)
    back = cylinder("mirror_back", 0, 0, -0.003, 0.003, mr - 0.03, m_black, segs=64)
    back.location, back.rotation_euler = (bcx, my + 0.007, mz), (math.radians(90), 0, 0)
    light("mirror_halo", "AREA", (bcx, y_back - CL - 0.016, mz), rot=(math.radians(90), 0, 0), energy=28.0 * G,
          color=kelvin(3000), size=0.70, shape="DISK")
    # sparse accessories: stoneware bottle + small green glazed dish
    lathe("bottle", [(0.0, 0.0), (0.032, 0.0), (0.036, 0.01), (0.037, 0.13), (0.03, 0.16), (0.012, 0.175),
                     (0.011, 0.20), (0.0, 0.20)], m_stoneware, loc=(vx0 + 0.20, vy1 - 0.12, TOP_Z), segs=48)
    lathe("dish", [(0.0, 0.0), (0.04, 0.0), (0.06, 0.012), (0.075, 0.026), (0.07, 0.028), (0.055, 0.016),
                   (0.0, 0.008)], m_glaze, loc=(vx0 + 0.36, vy1 - 0.15, TOP_Z), segs=64)

    # ---- lights ------------------------------------------------------------------
    day = (0.88, 0.94, 1.0)
    light("window_light", "AREA", (x_left - 0.13, (wy0 + wy1) / 2, (wz0 + wz1) / 2), rot=(0, math.radians(-90), 0),
          energy=30.0 * G, color=day, size=(wz1 - wz0), size_y=(wy1 - wy0))
    light("under_vanity", "AREA", (bcx, vy0 + 0.22, 0.495), energy=2.6 * G, color=kelvin(3000),
          size=vx1 - vx0 - 0.1, size_y=0.025, spread=math.radians(150))
    light("slot_light", "AREA", (1.7, y_back - 0.28, H - 0.01), rot=(math.radians(14), 0, 0),
          energy=3.0 * G, color=kelvin(3200), size=3.2, size_y=0.04, spread=math.radians(70))
    light("fill_light", "AREA", (2.3, y_front + 0.05, 1.6), rot=(math.radians(-90), 0, 0),
          energy=6.0 * G, color=(0.96, 0.97, 1.0), size=1.8, size_y=1.6)

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bpy.context.scene.world = world

    cam = level_camera((2.62, 0.55, 1.50), yaw_deg=25.0, lens=28.0, shift_x=0.0, shift_y=-0.14)

    surfaces = {
        "vanity": dict(orientation="horizontal", sizeMm=[1600, 560],
                       rect=[(vx0, vy1, TOP_Z), (vx1, vy1, TOP_Z), (vx1, vy0, TOP_Z), (vx0, vy0, TOP_Z)],
                       objects=["vanity"]),
        "wall": dict(orientation="vertical", sizeMm=[3400, 2700],
                     rect=[(x_left, vy1, H), (x_right, vy1, H), (x_right, vy1, 0.0), (x_left, vy1, 0.0)],
                     objects=["wall"]),
        "floor": dict(orientation="horizontal", sizeMm=None, rect=None, objects=["floor"],
                      room=(x_left, x_right, y_front, y_back - CL)),
    }
    return cam, surfaces


# --------------------------------------------------------------------------------------
# render plumbing
# --------------------------------------------------------------------------------------


def setup_render(res, samples, threshold, exposure=0.0):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    cy.device = "CPU"
    cy.samples = samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = threshold
    cy.adaptive_min_samples = min(32, samples)
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    cy.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    cy.denoising_prefilter = "ACCURATE"
    cy.denoising_quality = "HIGH"
    cy.max_bounces = 10
    cy.diffuse_bounces = 5
    cy.glossy_bounces = 4
    cy.transmission_bounces = 4
    cy.transparent_max_bounces = 8
    cy.sample_clamp_direct = 0.0
    cy.sample_clamp_indirect = 8.0
    cy.blur_glossy = 0.5
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.use_light_tree = True
    cy.seed = 7
    cy.filter_width = 1.5
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.threads_mode = "FIXED"
    sc.render.threads = os.cpu_count() or 4
    sc.render.use_persistent_data = True
    sc.render.film_transparent = False
    # Standard (plain sRGB) view: the web compositor rebuilds replaced surfaces as
    # albedo * diffuse + gloss in linear, scales by 2^exposure and sRGB-encodes.
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = exposure
    sc.view_settings.gamma = 1.0
    sc.display_settings.display_device = "sRGB"
    sc.render.dither_intensity = 0.0


def set_passes(full):
    vl = bpy.context.scene.view_layers[0]
    for p in ("diffuse_direct", "diffuse_indirect", "diffuse_color", "glossy_direct", "glossy_indirect",
              "glossy_color", "emit", "transmission_direct", "transmission_indirect", "transmission_color"):
        setattr(vl, "use_pass_" + p, full)
    vl.use_pass_cryptomatte_object = full
    vl.pass_cryptomatte_depth = 6
    vl.cycles.denoising_store_passes = full


def save_exr(path):
    sc = bpy.context.scene
    s = sc.render.image_settings
    s.media_type = "MULTI_LAYER_IMAGE"
    s.file_format = "OPEN_EXR_MULTILAYER"
    s.color_depth = "32"
    s.exr_codec = "ZIP"
    bpy.data.images["Render Result"].save_render(path, scene=sc)


def save_display_png(path):
    sc = bpy.context.scene
    s = sc.render.image_settings
    s.media_type = "IMAGE"
    s.file_format = "PNG"
    s.color_mode = "RGB"
    s.color_depth = "16"
    s.compression = 15
    bpy.data.images["Render Result"].save_render(path, scene=sc)


def surface_projection(sc, cam, surfaces):
    """Project each surface rectangle; fix corner order by projected position; floor rect."""
    out = {}
    for sid, s in surfaces.items():
        rect = s["rect"]
        if sid == "floor":
            rect, size = floor_rect(sc, cam, s["room"])
            s["sizeMm"] = size
        pts = [project(sc, cam, p) for p in rect]
        out[sid] = dict(orientation=s["orientation"], sizeMm=s["sizeMm"], objects=s["objects"],
                        rect3d=[list(map(float, p)) for p in rect], quad=[[p[0], p[1]] for p in pts],
                        depth=[p[2] for p in pts])
    return out


def floor_rect(sc, cam, room):
    """Axis-aligned floor rectangle covering the visible floor, all corners in front of the camera."""
    x_left, x_right, y_front, y_back = room
    cw = cam.matrix_world
    fwd = (cw.to_3x3() @ Vector((0, 0, -1))).normalized()
    # visible floor footprint: cast rays through the image border
    frame = cam.data.view_frame(scene=sc)
    # frame corners in camera space: [tr, br, bl, tl]
    tr, br, bl, tl = [cw @ v for v in frame]
    org = cw.translation
    hits = []
    for a, b in ((tl, tr), (tr, br), (br, bl), (bl, tl)):
        for i in range(41):
            p = a.lerp(b, i / 40.0)
            d = (p - org).normalized()
            if d.z < -1e-4:
                t = -org.z / d.z
                hit = org + d * t
                hits.append((min(max(hit.x, x_left), x_right), min(max(hit.y, y_front), y_back)))
    xs = [h[0] for h in hits]
    ys = [h[1] for h in hits]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    x0, x1 = math.floor(x0 * 10 - 1) / 10, math.ceil(x1 * 10 + 1) / 10   # 0.1 m safety margin
    y0, y1 = math.floor(y0 * 10 - 1) / 10, math.ceil(y1 * 10 + 1) / 10
    x0, x1 = max(x0, x_left), min(x1, x_right)
    y0, y1 = max(y0, y_front), min(y1, y_back)

    def depth(x, y):
        return (Vector((x, y, 0.0)) - org).dot(fwd)

    # pull the near corners in until they are safely in front of the camera
    for _ in range(200):
        bad = [(x, y) for x in (x0, x1) for y in (y0, y1) if depth(x, y) < 0.6]
        if not bad:
            break
        y0 += 0.05
    rect = [(x0, y1, 0.0), (x1, y1, 0.0), (x1, y0, 0.0), (x0, y0, 0.0)]
    size = [round((x1 - x0) * 1000), round((y1 - y0) * 1000)]
    return rect, size


BUILDERS = {"kitchen": build_kitchen, "bathroom": build_bathroom}
EXPOSURE = {"kitchen": 0.0, "bathroom": 0.0}  # stops; recorded in scenes.json when non-zero


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", required=True, choices=sorted(BUILDERS))
    ap.add_argument("--preview", action="store_true", help="low-res beauty only")
    ap.add_argument("--res", type=int, nargs=2, default=None)
    ap.add_argument("--samples", type=int, default=None)
    ap.add_argument("--threshold", type=float, default=0.012)
    ap.add_argument("--modes", default="beauty,diffuse,gloss")
    ap.add_argument("--work", default=DEFAULT_WORK)
    ap.add_argument("--tag", default="")
    ap.add_argument("--meta-only", action="store_true", help="only recompute the projection metadata")
    args = ap.parse_args(argv)

    os.makedirs(args.work, exist_ok=True)
    reset_scene()
    cam, surfaces = BUILDERS[args.scene]()
    exposure = EXPOSURE.get(args.scene, 0.0)
    add_overrides()
    res = tuple(args.res) if args.res else ((480, 300) if args.preview else (1600, 1000))
    samples = args.samples or (24 if args.preview else 160)
    setup_render(res, samples, args.threshold if not args.preview else 0.05, exposure)
    sc = bpy.context.scene
    bpy.context.view_layer.update()   # make sure matrix_world is evaluated before projecting

    proj = surface_projection(sc, cam, surfaces)
    meta = dict(scene=args.scene, width=res[0], height=res[1], samples=samples,
                albedo=PLACEHOLDER_ALBEDO, roughness=PLACEHOLDER_ROUGHNESS,
                camera=dict(location=list(cam.location), rotation=list(cam.rotation_euler), lens=cam.data.lens,
                            shift=[cam.data.shift_x, cam.data.shift_y]),
                view=dict(transform=sc.view_settings.view_transform, look=sc.view_settings.look,
                          exposure=sc.view_settings.exposure),
                surfaces=proj, times={})
    tag = args.tag or ("_preview" if args.preview else "")
    meta_path = os.path.join(args.work, "%s%s_meta.json" % (args.scene, tag))
    if args.meta_only:
        if os.path.exists(meta_path):
            meta["times"] = json.load(open(meta_path)).get("times", {})
        with open(meta_path, "w") as fh:
            json.dump(meta, fh, indent=1)
        print(json.dumps(meta["surfaces"], indent=1))
        return
    modes = ["beauty"] if args.preview else args.modes.split(",")
    for mode in modes:
        set_mode(mode)
        set_passes(mode == "beauty")
        t0 = time.time()
        bpy.ops.render.render(write_still=False)
        dt = time.time() - t0
        meta["times"][mode] = round(dt, 1)
        print("[%s] %s render %.1fs" % (args.scene, mode, dt), flush=True)
        base = os.path.join(args.work, "%s%s_%s" % (args.scene, tag, mode))
        save_exr(base + ".exr")
        if mode == "beauty":
            save_display_png(base + ".png")
    with open(meta_path, "w") as fh:
        json.dump(meta, fh, indent=1)
    print("done", json.dumps(meta["times"]))


if __name__ == "__main__":
    main()
