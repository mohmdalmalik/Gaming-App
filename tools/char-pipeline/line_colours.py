# Median lit colour of every guest material in the game lineup (see lineup_measure.mjs):
#   python3 tools/char-pipeline/line_colours.py <prefix>
# Pixels whose ID colour (and its 3x3 neighbourhood) matches exactly are that material's visible, unblended pixels.
import sys, json, numpy as np
from PIL import Image
from scipy import ndimage as nd
pre = sys.argv[1]; info = json.load(open(pre + '.json'))
lit = np.asarray(Image.open(pre + '-lit.png').convert('RGB')).astype(int); idi = np.asarray(Image.open(pre + '-id.png').convert('RGB')).astype(int)
res = {}
for rec in info:
    for m in rec['mats']:
        tgt = np.array(m['id']); mask = (np.abs(idi - tgt).sum(2) <= 3)
        mask = nd.binary_erosion(mask, iterations=1)
        if mask.sum() < 30: continue
        med = np.median(lit[mask], axis=0).astype(int)
        key = (rec['x'], m['base'])
        res[key] = (med, int(mask.sum()))
guest = {-2.5: 'Victor', -1.5: 'Eleanor', -0.5: 'Marcus', 0.5: 'Beatrice', 1.5: 'Henry', 2.5: 'Clara'}
for (x, base), (med, n) in sorted(res.items()):
    print(f"{guest.get(x, x):7s} base {base} -> lit #{''.join('%02x' % v for v in med)}  ({n} px)")
