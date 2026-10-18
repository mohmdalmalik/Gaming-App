# The parts manifest and index writer (no Blender needed).
#   python3 tools/char-pipeline/parts/manifest.py            scan assets/characters/parts/*/*.glb, write
#                                                            assets/characters/parts/manifest.json and
#                                                            src/data/partsIndex.js (atomically: temp file + rename)
#   python3 tools/char-pipeline/parts/manifest.py --check    the same, and exit 1 on any failure: a file that breaks the
#                                                            format (contract 3.3), a budget (9.1), a missing or stale
#                                                            shadow patch, a hole through a hair or moustache shell
# The result depends only on what is on disk, so both art builders (and anyone else) can run it at any time. A file
# that breaks the format is left OUT of both outputs (the game never tries to load it) and listed under errors.
import sys, os, json, math, time, datetime
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import glb as G
import tables as T

REPO = HERE.parents[2]
PARTS_DIR = REPO / 'assets' / 'characters' / 'parts'
INDEX_JS = REPO / 'src' / 'data' / 'partsIndex.js'

ATTR_TYPES = {  # attribute -> (componentType, type, normalized)
    'POSITION': (5126, 'VEC3', False), 'NORMAL': (5126, 'VEC3', False), 'COLOR_0': (5123, 'VEC4', True),
    'JOINTS_0': (5121, 'VEC4', False), 'WEIGHTS_0': (5121, 'VEC4', True)}

def _atomic_write(path, text):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f'.tmp{os.getpid()}')
    tmp.write_text(text); os.replace(tmp, path)

# Open-loop check for hair and moustache shells: a sculpted shell has ONE open loop, its rim along the hairline. Any
# other loop is a hole through the hair (a skin-coloured pit at close range). A loop of at most 4 vertices is a single
# missing triangle (invisible in every render so far, also in today's women's hair): a warning, not a failure.
HOLE_SLOTS = ('hairStyle', 'facial')
HOLE_TINY = 4

def open_loops(gltf, binb, mat_name):
    """The open boundary loops of one primitive, positions welded to 0.1 mm: [(vertex count, centre xyz)], largest
    first."""
    for _, _, p, mat in G.prim_list(gltf):
        if mat != mat_name: continue
        pos = G.accessor(gltf, binb, p['attributes']['POSITION']).astype(np.float64)
        idx = G.accessor(gltf, binb, p['indices']).astype(np.int64).reshape(-1, 3)
        _, weld = np.unique(np.round(pos * 1e4).astype(np.int64), axis=0, return_inverse=True)
        tri = weld.reshape(-1)[idx]
        e = np.sort(np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]), axis=1)
        e = e[e[:, 0] != e[:, 1]]
        uniq, count = np.unique(e, axis=0, return_counts=True)
        adj = {}
        for a, b in uniq[count == 1]:
            adj.setdefault(int(a), []).append(int(b)); adj.setdefault(int(b), []).append(int(a))
        first = {}
        for i, w in enumerate(weld.reshape(-1)): first.setdefault(int(w), i)
        seen, loops = set(), []
        for s in adj:
            if s in seen: continue
            stack, comp = [s], []
            while stack:
                u = stack.pop()
                if u in seen: continue
                seen.add(u); comp.append(u); stack.extend(adj[u])
            loops.append((len(comp), [round(float(v), 3) for v in pos[[first[u] for u in comp]].mean(0)]))
        return sorted(loops, key=lambda l: -l[0])
    return []

def inspect(path, body_dir):
    """Read one GLB: -> (record dict, inverse bind matrices, errors list). The record holds what the manifest needs."""
    errs = []; rec = {}
    try: gltf, binb = G.read(path)
    except Exception as e: return None, None, [f'unreadable: {e}']
    key = path.stem
    ex = (gltf.get('scenes') or [{}])[0].get('extras') or {}
    rec['extras'] = ex
    if gltf.get('asset', {}).get('version') != '2.0': errs.append('not glTF 2.0')
    if gltf.get('extensionsUsed') or gltf.get('extensionsRequired'): errs.append(f'extensions used: {gltf.get("extensionsUsed")}')
    for k in ('textures', 'images', 'samplers'):
        if gltf.get(k): errs.append(f'has {k}')
    # nodes, rig, skin
    nodes = gltf.get('nodes', [])
    rigs = [n for n in nodes if n.get('name') == 'Rig']
    if len(rigs) != 1: errs.append(f'{len(rigs)} nodes named Rig (want 1)')
    skins = gltf.get('skins', [])
    ibm = None
    if len(skins) != 1: errs.append(f'{len(skins)} skins (want 1)')
    else:
        names = [nodes[j].get('name') for j in skins[0]['joints']]
        if names != T.BONES: errs.append(f'joints {names} differ from the 19 bones in order')
        if 'inverseBindMatrices' in skins[0]:
            ibm = G.accessor(gltf, binb, skins[0]['inverseBindMatrices']).astype(np.float64)
        else: errs.append('no inverse bind matrices')
    mesh_nodes = [n for n in nodes if 'mesh' in n]
    if len(mesh_nodes) != 1: errs.append(f'{len(mesh_nodes)} mesh nodes (want 1)')
    else:
        if mesh_nodes[0].get('name') != key: errs.append(f'mesh node named {mesh_nodes[0].get("name")!r}, want {key!r}')
        if 'skin' not in mesh_nodes[0]: errs.append('mesh node is not skinned')
    # primitives and materials
    mats_in_file = []
    for mi, pi, p, mat in G.prim_list(gltf):
        if p.get('targets'): errs.append(f'{mat}: morph targets')
        if p.get('mode', 4) != 4: errs.append(f'{mat}: not triangles')
        if set(p['attributes']) != set(ATTR_TYPES): errs.append(f'{mat}: attributes {sorted(p["attributes"])}')
        for a, (ct, ty, norm) in ATTR_TYPES.items():
            if a not in p['attributes']: continue
            acc = gltf['accessors'][p['attributes'][a]]
            if acc['componentType'] != ct or acc['type'] != ty or bool(acc.get('normalized', False)) != norm:
                errs.append(f'{mat}: {a} is {acc["componentType"]}/{acc["type"]}/norm={acc.get("normalized", False)}')
        if 'indices' not in p or gltf['accessors'][p['indices']]['componentType'] != 5123: errs.append(f'{mat}: indices not u16')
        if 'WEIGHTS_0' in p['attributes'] and gltf['accessors'][p['attributes']['WEIGHTS_0']]['componentType'] == 5121:
            w = G.accessor(gltf, binb, p['attributes']['WEIGHTS_0']).astype(np.int64)
            if (w.sum(1) != 255).any(): errs.append(f'{mat}: {(w.sum(1) != 255).sum()} vertices whose weights do not sum to 255')
            j = G.accessor(gltf, binb, p['attributes']['JOINTS_0']).astype(np.int64)
            if (j[w > 0] >= len(T.BONES)).any(): errs.append(f'{mat}: joint index out of range')
        if mat in mats_in_file: errs.append(f'two primitives use material {mat}')
        mats_in_file.append(mat)
        if mat not in T.PALETTE: errs.append(f'material {mat!r} is not in the palette table')
    for m in gltf.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        if pbr.get('metallicFactor', 1) != 0 or pbr.get('roughnessFactor', 1) != 1: errs.append(f'{m.get("name")}: metallic/roughness not 0/1')
        if not m.get('doubleSided'): errs.append(f'{m.get("name")}: not double-sided')
    # scene extras
    slot, ident, fit = T.split_key(key)
    want = dict(partFormat=T.PART_FORMAT, body=body_dir, slot=slot, id=ident, key=key, fit=(f'{fit[0]}_{fit[1]}' if fit else None))
    for k, v in want.items():
        if ex.get(k) != v: errs.append(f'extras.{k} = {ex.get(k)!r}, want {v!r}')
    if key != 'body' and slot not in T.SLOTS: errs.append(f'unknown slot {slot!r}')
    h = G.piece_hash(gltf, binb)
    if ex.get('hash') != h: errs.append(f'extras.hash {ex.get("hash")} != {h} (file changed after its extras were written)')
    mt = ex.get('materials') or {}
    if set(mt) != set(mats_in_file): errs.append(f'extras.materials {sorted(mt)} != primitives {sorted(mats_in_file)}')
    for n, e in mt.items():
        if e not in T.PALETTE_ENTRIES: errs.append(f'extras.materials[{n}] = {e!r} is not a palette entry')
    if slot == 'face':
        if not ex.get('eyeCentre') or len(ex['eyeCentre']) != 3: errs.append('face without eyeCentre')
        if 'Eye' not in mats_in_file or 'Brow' not in mats_in_file: errs.append('face without Eye / Brow')
        bg = ex.get('builtInGlasses')
        if bg and bg.get('material') not in mats_in_file: errs.append('builtInGlasses material not in the file')
    if slot == 'extra' and ex.get('attach') not in T.ATTACH: errs.append(f'extra without a valid attach ({ex.get("attach")!r})')
    rec['holeWarnings'] = []
    if slot in HOLE_SLOTS:
        for mat in mats_in_file:
            loops = open_loops(gltf, binb, mat)[1:]           # the first (largest) loop is the shell's own rim
            holes = [l for l in loops if l[0] > HOLE_TINY]
            if holes: errs.append(f'{mat}: {len(holes)} hole(s) through the shell beyond its rim (vertices, centre): {holes}')
            tiny = [l for l in loops if l[0] <= HOLE_TINY]
            if tiny: rec['holeWarnings'].append(f'{mat}: {len(tiny)} single-triangle gap(s) at {[l[1] for l in tiny]}')
    for tk, patch in (ex.get('aoPatches') or {}).items():
        if not isinstance(patch, dict) or 'against' not in patch or 'mats' not in patch: errs.append(f'aoPatches[{tk}] malformed')
    rig_ex = rigs[0].get('extras', {}) if rigs else {}
    if key == 'body':
        anims = {a.get('name'): a for a in gltf.get('animations', [])}
        for nm, dur in (('Idle', 3.0), ('Walk', 1.3333)):
            if nm not in anims: errs.append(f'no {nm} animation'); continue
            tmax = max(gltf['accessors'][s['input']].get('max', [0])[0] for s in anims[nm]['samplers'])
            if abs(tmax - dur) > 0.05: errs.append(f'{nm} lasts {tmax:.3f} s, want {dur}')
        for k in ('strideLength', 'contactStride', 'walkClipSeconds', 'eyeCentre'):
            if k not in rig_ex: errs.append(f'Rig extras without {k}')
    elif gltf.get('animations'): errs.append('a piece must not carry animations (only body.glb)')
    # sizes
    tris = G.tri_count(gltf); verts = G.vert_count(gltf)
    prim_tris = {}
    for _, _, p, mat in G.prim_list(gltf): prim_tris[mat] = gltf['accessors'][p['indices']]['count'] // 3
    prim_verts = {mat: gltf['accessors'][p['attributes']['POSITION']]['count'] for _, _, p, mat in G.prim_list(gltf)}
    rec.update(key=key, slot=slot, id=ident, fit=want['fit'], tris=tris, verts=verts, bytes=path.stat().st_size, hash=h,
               materials=mt, primTris=prim_tris, primVerts=prim_verts, rig=rig_ex, mtime=path.stat().st_mtime)
    return rec, ibm, errs

def colour_slots(materials):
    out = []
    for name, entry in materials.items():
        c = T.COLOUR_OF_ENTRY.get(entry)
        if c and c not in out: out.append(c)
    return out

def body_order(bodies):
    return sorted(bodies, key=lambda b: (T.BODY_ORDER.index(b) if b in T.BODY_ORDER else len(T.BODY_ORDER), b))

def build(check=False, quiet=False):
    errors, warnings, missing, stale = [], [], [], []
    bodies, parts, index_parts, index_tris, built_in, red_eye = {}, {}, {}, {}, {}, {}
    heaviest = {}
    newest = 0.0
    dirs = sorted(d for d in PARTS_DIR.glob('*') if d.is_dir()) if PARTS_DIR.exists() else []
    for d in dirs:
        b = d.name
        files = sorted(d.glob('*.glb'))
        if not files: continue
        body_path = d / 'body.glb'
        if not body_path.exists():
            errors.append(f'{b}: no body.glb (its {len(files)} pieces are left out)'); continue
        brec, bibm, berr = inspect(body_path, b)
        if berr:
            errors += [f'{b}/body: {e}' for e in berr]; continue
        recs = {}
        for f in files:
            if f.name == 'body.glb': continue
            rec, ibm, err = inspect(f, b)
            if rec is not None and ibm is not None and bibm is not None:
                if ibm.shape != bibm.shape or np.abs(ibm - bibm).max() > 1e-5: err.append('inverse bind matrices differ from body.glb')
            if err:
                errors += [f'{b}/{f.stem}: {e}' for e in err]; continue
            warnings += [f'{b}/{f.stem}: {w}' for w in rec['holeWarnings']]
            recs[rec['key']] = rec
        newest = max([newest, brec['mtime']] + [r['mtime'] for r in recs.values()])
        g = T.gender_of(b); bud = T.BUDGETS.get(g, T.BUDGETS['m'])
        rig = brec['rig']
        bodies[b] = dict(file=f'{b}/body.glb', gender=g, tris=brec['tris'], bytes=brec['bytes'], hash=brec['hash'],
                         strideLength=rig.get('strideLength'), contactStride=rig.get('contactStride'),
                         walkClipSeconds=rig.get('walkClipSeconds'), eyeCentre=rig.get('eyeCentre'), height=rig.get('height'))
        all_recs = dict(recs); all_recs['body'] = brec
        keys = set(recs)
        # ---- shadow patches: stale (target rebuilt since the bake) and missing (a pair the catalogue allows)
        for k, r in recs.items():
            for tk, patch in (r['extras'].get('aoPatches') or {}).items():
                t = all_recs.get(tk)
                if t is None: warnings.append(f'{b}/{k}: patch for {tk}, which is not on disk'); continue
                if patch.get('against') != t['hash']: stale.append(f'{b}/{k} -> {tk} (baked against {patch.get("against")}, now {t["hash"]})')
                for mat, mp in (patch.get('mats') or {}).items():
                    n = t['primVerts'].get(mat)
                    if n is None: errors.append(f'{b}/{k}: patch for {tk}.{mat}, which has no such primitive'); continue
                    if mp['idx'] and max(mp['idx']) >= n: errors.append(f'{b}/{k}: patch index out of range in {tk}.{mat}')
        for k, r in recs.items():
            slot, ident, fit = T.split_key(k)
            for ts in T.CASTS.get(slot, []):
                if ts == 'body': targets = ['body']
                else: targets = [t for t in keys if T.split_key(t)[0] == ts and '~' not in t]
                for t in targets:
                    if fit and fit[0] == ts and f'{fit[0]}_{fit[1]}' != t: continue        # a variant fitted to another piece of that slot
                    if not fit and ts != 'body' and any(o.startswith(f'{slot}_{ident}~') and o.split('~', 1)[1] == t for o in keys): continue
                    if t not in (r['extras'].get('aoPatches') or {}): missing.append(f'{b}/{k} -> {t}')
        # ---- budgets
        def cap(slot, ident):
            return T.BUDGET_EXCEPTIONS.get((g, slot, ident), bud.get(slot))
        glasses_tris = {}
        for k, r in recs.items():
            slot, ident, fit = T.split_key(k)
            bg = r['extras'].get('builtInGlasses')
            own = r['tris'] - (r['primTris'].get(bg['material'], 0) if bg else 0)
            if bg: glasses_tris[k] = r['primTris'].get(bg['material'], 0)
            if slot == 'face':
                if brec['tris'] + own > bud['bodyFace']: errors.append(f'{b}/{k}: body + face {brec["tris"] + own} tris > {bud["bodyFace"]}')
                if bg and glasses_tris[k] > bud['glasses']: errors.append(f'{b}/{k}: built-in glasses {glasses_tris[k]} tris > {bud["glasses"]}')
            elif cap(slot, ident) is not None and r['tris'] > cap(slot, ident):
                errors.append(f'{b}/{k}: {r["tris"]} tris > the {slot} budget {cap(slot, ident)}')
            if r['bytes'] > T.piece_byte_cap(r['verts'], r['tris']):
                errors.append(f'{b}/{k}: {r["bytes"]} bytes > {T.piece_byte_cap(r["verts"], r["tris"])} (40 x verts + 6 x tris + 25 kB)')
        by_slot = {}
        for k, r in recs.items():
            slot = T.split_key(k)[0]; own = r['tris'] - glasses_tris.get(k, 0)
            by_slot[slot] = max(by_slot.get(slot, 0), own)
        heavy = brec['tris'] + sum(v for s, v in by_slot.items() if s != 'extra')
        heaviest[b] = heavy
        if heavy > bud['heaviest']: errors.append(f'{b}: heaviest combination without extras and glasses {heavy} tris > {bud["heaviest"]}')
        # the classic Looks of this body's gender whose pieces are all here
        for look, L in T.LOOKS.items():
            if L['gender'] != g: continue
            worn = {f'{s}_{v}' for s, v in L.items() if s in T.SLOTS and v != 'none'}
            worn |= {f'extra_{e}' for e in L.get('extras', [])}
            ks, ok = [], True
            for s, v in L.items():
                if s not in T.SLOTS or v == 'none': continue
                fk = T.resolve(keys, s, v, worn)
                if fk is None: ok = False; break
                ks.append(fk)
            for e in L.get('extras', []):
                fk = T.resolve(keys, 'extra', e, worn)
                if fk: ks.append(fk)
            if not ok: continue
            tris = brec['tris'] + sum(recs[k]['tris'] - (glasses_tris.get(k, 0) if L.get('glasses') != 'round' else 0) for k in ks)
            byts = brec['bytes'] + sum(recs[k]['bytes'] for k in ks)
            if tris > bud['look']: errors.append(f'{b}: Look {look} {tris} tris > {bud["look"]}')
            if byts > T.LOOK_BYTES: errors.append(f'{b}: Look {look} {byts} bytes > {T.LOOK_BYTES}')
            if not quiet: print(f'look {b}/{look}: {tris} tris, {byts} bytes, pieces {", ".join(ks)}')
        # ---- outputs
        index_parts[b] = sorted(keys)
        index_tris[f'{b}/body'] = brec['tris']
        for k in sorted(keys):
            r = recs[k]
            ent = dict(file=f'{b}/{k}.glb', body=b, slot=r['slot'], id=r['id'], fit=r['fit'], tris=r['tris'], verts=r['verts'],
                       bytes=r['bytes'], materials=r['materials'], colourSlots=colour_slots(r['materials']), hash=r['hash'],
                       patches={tk: sum(len(m['idx']) for m in p.get('mats', {}).values()) for tk, p in sorted((r['extras'].get('aoPatches') or {}).items())})
            for extra in ('eyeCentre', 'builtInGlasses', 'attach'):
                if extra in r['extras']: ent[extra] = r['extras'][extra]
            for extra in ('redEyeMin', 'poke'):
                if extra in r['extras']: ent[extra] = r['extras'][extra]
            parts[f'{b}/{k}'] = ent
            index_tris[f'{b}/{k}'] = r['tris']
            bg = r['extras'].get('builtInGlasses')
            if bg: built_in[f'{b}/{k}'] = bg.get('style')
            if isinstance(r['extras'].get('redEyeMin'), (int, float)): red_eye[f'{b}/{k}'] = r['extras']['redEyeMin']
    order = body_order(bodies)
    gen = datetime.datetime.fromtimestamp(newest, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if newest else None
    manifest = dict(v=1, generated=gen, bones=T.BONES, bodies={b: bodies[b] for b in order}, parts=parts,
                    checks=dict(heaviest=heaviest, missingPatches=sorted(missing), stalePatches=sorted(stale),
                                warnings=warnings, errors=errors))
    text = json.dumps(manifest, indent=1, sort_keys=False) + '\n'
    _atomic_write(PARTS_DIR / 'manifest.json', text)
    js = ['// src/data/partsIndex.js: GENERATED by tools/char-pipeline/parts/manifest.py from assets/characters/parts/. Never edit.',
          'export const PART_INDEX = {', '  v: 1,',
          '  bodies: [' + ', '.join(f"'{b}'" for b in order) + '],',
          '  parts: {' + ', '.join(f"{json.dumps(b) if not b.isidentifier() else b}: [" + ', '.join(f"'{k}'" for k in index_parts[b]) + ']' for b in order) + '},',
          '  tris: {' + ', '.join(f"'{k}': {v}" for k, v in index_tris.items()) + '},',
          '  builtInGlasses: {' + ', '.join(f"'{k}': '{v}'" for k, v in built_in.items()) + '},',
          # (the red-eye test's recorded minimum per piece, review.mjs --record: the data keeps a piece below the gate
          # off the guests it dresses itself, src/data/wardrobe.js eyesShow)
          '  redEye: {' + ', '.join(f"'{k}': {v}" for k, v in red_eye.items()) + '},',
          '};', '']
    _atomic_write(INDEX_JS, '\n'.join(js))
    fail = bool(errors or missing or stale)
    if not quiet:
        print(f'manifest: {len(order)} bodies ({", ".join(order)}), {len(parts)} pieces; heaviest {heaviest}')
        for w in warnings: print('WARNING', w)
        for m in sorted(missing): print('MISSING PATCH', m)
        for s in sorted(stale): print('STALE PATCH', s)
        for e in errors: print('ERROR', e)
        print(('CHECK FAILED' if fail else 'CHECK OK') if check else ('wrote ' + str(PARTS_DIR / 'manifest.json') + ' and ' + str(INDEX_JS)))
    return manifest, fail

if __name__ == '__main__':
    args = sys.argv[1:]
    check = '--check' in args
    if '--parts' in args:            # check a draft folder (with <body>/ subfolders) instead of assets/characters/parts
        PARTS_DIR = Path(args[args.index('--parts') + 1]).resolve()
    if '--no-write' in args:
        _atomic_write = lambda path, text: None
    elif '--parts' in args:          # a draft: its own manifest.json (for the review tools), never the game's index
        _real_write = _atomic_write
        _atomic_write = lambda path, text: _real_write(path, text) if Path(path).name == 'manifest.json' else None
    _, fail = build(check=check)
    sys.exit(1 if (check and fail) else 0)
