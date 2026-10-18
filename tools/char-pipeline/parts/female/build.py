# Build the pieces of the shared female body 'f' (Blender bpy 4.2, headless). In this environment bpy needs its own
# libraries:
#   LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/bpy/lib python3 tools/char-pipeline/parts/female/build.py
#        every female piece that is marked to ship -> assets/characters/parts/f/  (then run manifest.py --check)
#   ... female/build.py --only hairStyle_waves,face_eleanor     only those (an item id builds all its variants)
#   ... female/build.py --out <scratch dir>                     a draft build somewhere else (every piece, shipped or not)
#   ... female/build.py --out <dir> --only a,b --just       a quick draft of only those pieces (no casters rebuilt)
#   ... female/build.py --list                                  the items, their context and what they shade
# Specs: tools/char-pipeline/parts/female/spec.py. The shared core (parts/core.py, glb.py, tables.py) is used unchanged;
# this driver is the male driver (parts/build.py) plus what the gowns need: a belt is built on the gown it is fitted
# to (`needs`), a face can fold extra shading into its shadow patch on the body (`patch_mod`: Eleanor's chin shadow on
# the neck), and an extra patch can be kept a touch lighter (`patch_soft`: the hair's shadow on the gowns).
import sys, os, time, argparse
from pathlib import Path
HERE = Path(__file__).resolve().parent
PARTS = HERE.parent
KIT = PARTS.parent
for p in (str(HERE), str(PARTS), str(KIT), str(KIT / 'guests')):
    if p not in sys.path: sys.path.insert(0, p)
import numpy as np
import bpy
import guest_kit as GK
import victor_lib as L
import core as C
import tables as T
import spec as S

REPO = PARTS.parents[2]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default=''); ap.add_argument('--out', default=''); ap.add_argument('--list', action='store_true')
    ap.add_argument('--just', action='store_true')
    a = ap.parse_args(sys.argv[1:])
    items = S.items(); by_key = {it['key']: it for it in items}
    if a.list:
        for it in items:
            print(f"{it['key']:34s} ship={it['ship']!s:5s} ctx={','.join(it['ctx']) or '-'}  shades={','.join(t for t, _ in it['casts']) or '-'}")
        return 0
    assets = (REPO / 'assets' / 'characters' / 'parts' / S.BODY).resolve()
    out_dir = Path(a.out).resolve() if a.out else assets
    to_assets = out_dir == assets
    # ---- what to export: the asked items (an id or a key), plus every caster onto an asked target
    if a.only:
        asked = set()
        for w in filter(None, a.only.split(',')):
            hit = [k for k, it in by_key.items() if k == w or k.split('~')[0] == w or f"{it['slot']}_{it['id']}" == w]
            if not hit: raise SystemExit(f'unknown item {w!r} (see --list)')
            asked |= set(hit)
        casters = {k for k, it in by_key.items() if any(t in asked for t, _ in it['casts'])}
        if a.just: casters = set()                 # a quick draft: only the asked pieces (patches only between them)
        if casters - asked: print('REPORT also rebuilding (they shade an asked piece): ' + ', '.join(sorted(casters - asked)))
        export = asked | casters
        if a.just and to_assets: raise SystemExit('--just builds drafts only (give --out)')
    else:
        export = set(by_key)
    skipped = sorted(k for k in export if to_assets and not by_key[k]['ship'])
    if skipped: print('REPORT not shipped (below the bar, kept out of assets/): ' + ', '.join(skipped))
    export = {k for k in export if not (to_assets and not by_key[k]['ship'])}
    need = set(export) | {'body', f'face_{S.DEFAULT_FACE}'}
    for _ in range(3):                           # contexts, patch bases and build dependencies (a belt's gown)
        for k in list(need):
            it = by_key[k]; need |= set(it['ctx']) | set(it.get('needs', []))
            for t, base in it['casts']:
                if k in export and (not a.just or t in export): need |= {t, *base}
    t0 = time.time()
    GK.reset_scene()
    g = GK.Guest(S.BODY, S.BASE_CFG, S.COLOURS, H=S.H)
    S.use_face(g, S.DEFAULT_FACE)
    meshes, grooves, eye_centres, timing = {}, {}, {}, {}
    # ---- geometry, in spec order
    for it in items:
        k = it['key']
        if k not in need: continue
        t = time.time()
        S.use_face(g, it['face'])
        g.hair_groove = None; g._building_key = k
        m = C.group(g, k, lambda: it['build'](g))
        L.smooth_normals(m, it['smooth'])
        grooves[k] = g.hair_groove if it['slot'] == 'hairStyle' else None
        if it['slot'] == 'face': eye_centres[k] = g.face_eye_centre.copy()
        meshes[k] = m; timing[k] = round(time.time() - t, 1)
        print(f'REPORT built {k}: {C.tri_count(m)} tris, {len(m.data.vertices)} verts in {timing[k]} s')
    # ---- own bakes
    t = time.time()
    for k in sorted(export, key=list(by_key).index):
        it = by_key[k]; S.use_face(g, it['face'])
        cols = C.bake_colours(g, meshes[k], [meshes[c] for c in it['ctx']], grooves.get(k), cfg=it['bake'])
        if it['lift']: cols = C.lift(cols, C.vertex_materials(meshes[k]), it['lift'])
        C.write_colours(meshes[k], cols)
        for p in it['post']: p(g, meshes[k])            # the piece's own after-bake steps (spec functions)
    print(f'REPORT own bakes {time.time() - t:.1f} s')
    # ---- shadow patches (the base bake of a target in a context is shared by every caster)
    t = time.time(); patches = {}; base_cache = {}
    for k in sorted(export, key=list(by_key).index):
        it = by_key[k]
        for tk, base in it['casts']:
            if a.just and tk not in export: continue
            tgt = by_key[tk]; S.use_face(g, tgt['face'])
            ck = (tk, tuple(base))
            if ck not in base_cache: base_cache[ck] = C.bake_colours(g, meshes[tk], [meshes[b] for b in base], cfg=tgt['bake'])[:, 0]
            a_ = base_cache[ck]
            b_ = C.bake_colours(g, meshes[tk], [meshes[b] for b in base] + [meshes[k]], cfg=tgt['bake'])[:, 0]
            r = np.clip(b_ / np.maximum(a_, 1e-4), 0.0, 1.0)
            if tgt['lift']:
                s = np.array([tgt['lift'].get(mn, 1.0) for mn in C.vertex_materials(meshes[tk])]); r = 1.0 - (1.0 - r) * s
            mod = it['patch_mod'].get(tk)
            if mod:                                      # extra shading this caster brings (Eleanor's chin shadow)
                S.use_face(g, it['face']); fn = getattr(S, mod + '_shade')(g); mats = C.vertex_materials(meshes[tk])
                me = meshes[tk].data
                r = r * np.array([fn(me.vertices[i].co) if mats[i] == 'Skin' else 1.0 for i in range(len(me.vertices))])
            soft = next((f for pre, f in it['patch_soft'].items() if tk.startswith(pre)), 0.0)
            if soft: r = np.minimum(1.0, r + soft)       # an extra shadow kept a touch lighter (spec: patch_soft)
            idx = np.nonzero(r < 0.995)[0]
            hid = C.hidden_by(meshes[tk], idx, meshes[k]) if len(idx) else np.zeros(0, bool)
            idx = idx[~hid]
            patches.setdefault(k, {})[tk] = (idx, r[idx])
            print(f'REPORT patch {k} -> {tk}: {len(idx)} verts ({int(hid.sum())} hidden by it left out), min {r[idx].min() if len(idx) else 1:.2f}')
    print(f'REPORT patch bakes {time.time() - t:.1f} s')
    # ---- the shared rig (Clara's head state: the head bone runs from her chin to her skull top) and the clips
    S.use_face(g, S.DEFAULT_FACE)
    g.mesh = meshes['body']
    GK.rig(g, S.RIG); GK.animate(g, S.RIG)
    arm = g.arm; arm.name = 'Rig'; arm.data.name = 'Rig'
    e = eye_centres[f'face_{S.DEFAULT_FACE}']
    arm['eyeCentre'] = [round(e.x, 4), round(e.z, 4), round(-e.y, 4)]; arm['height'] = S.H
    for k, m in meshes.items():
        if k != 'body': C.attach(m, arm)
    # ---- export + post-process
    out_dir.mkdir(parents=True, exist_ok=True)
    for k in sorted(export, key=list(by_key).index):
        it = by_key[k]; m = meshes[k]; path = out_dir / f'{k}.glb'
        C.export_glb(arm, m, path, anims=(k == 'body'))
        mats = {mt.name: it['materials'].get(mt.name, T.PALETTE.get(mt.name)) for mt in m.data.materials if mt}
        extras = dict(it['extras'])
        if it['slot'] == 'face':
            e = eye_centres[k]; extras['eyeCentre'] = [round(e.x, 4), round(e.z, 4), round(-e.y, 4)]
        C.postprocess(path, k, S.BODY, mats, it['colours'], extras)
    # ---- patches -> glTF indices of the target files in the output folder
    for k, pp in patches.items():
        aop = {}
        for tk, (idx, mul) in pp.items():
            tpath = out_dir / f'{tk}.glb'
            if not tpath.exists(): print(f'REPORT WARNING {k} -> {tk}: no target file in {out_dir}, patch left out'); continue
            mp, miss = C.map_patch(tpath, meshes[tk], idx, mul)
            if miss: print(f'REPORT WARNING {k} -> {tk}: {miss} vertices not found in the target file (rebuild {tk})')
            aop[tk] = {'against': C.file_hash(tpath), 'mats': mp}
        C.set_scene_extras(out_dir / f'{k}.glb', {'aoPatches': aop})
    for k in sorted(export, key=list(by_key).index):
        p = out_dir / f'{k}.glb'
        print(f'REPORT wrote {k}: {C.tri_count(meshes[k])} tris, {p.stat().st_size} bytes')
    print(f'REPORT total {time.time() - t0:.1f} s, {len(export)} pieces -> {out_dir}')
    if to_assets: print('REPORT now run: python3 tools/char-pipeline/parts/manifest.py --check')
    return 0

if __name__ == '__main__':
    rc = main()
    sys.stdout.flush(); sys.stderr.flush(); os._exit(rc or 0)
