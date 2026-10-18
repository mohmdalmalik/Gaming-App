# The fixed tables of the parts format (docs: tools/char-pipeline/README.md "Parts pipeline"; the contract they
# follow: the wardrobe W1 contract, sections 2-4 and 9). Pure data, no Blender: manifest.py, core.py and the builders
# all read them from here, so a name or a budget lives in ONE place.

PART_FORMAT = 1

# today's 19 bones, in today's joint order (every piece of a body carries the same inverse bind matrices)
BONES = ['root', 'hips', 'spine', 'neck', 'head', 'shoulder.L', 'upperarm.L', 'forearm.L', 'hand.L', 'shoulder.R',
         'upperarm.R', 'forearm.R', 'hand.R', 'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R']

# the slots a file key may start with (`<slot>_<id>` or `<slot>_<id>~<fitSlot>_<fitId>`), plus the body itself
SLOTS = ['face', 'hairStyle', 'facial', 'makeup', 'top', 'neck', 'legs', 'dress', 'belt', 'feet', 'extra']
KEY_SLOTS = ['body', 'face', 'hairStyle', 'facial', 'makeup', 'glasses', 'top', 'neck', 'legs', 'dress', 'belt', 'feet']
ATTACH = ['ears', 'neck', 'chest', 'waist', 'hands']

# material name -> palette entry (contract section 4). A name not here is an error.
PALETTE = {}
for entry, names in {
    'fixed': ['Shirt', 'Button', 'Horn', 'Sole', 'Shoe', 'Mouth', 'Pearl', 'Glove', 'Petal', 'Glass'],
    'skin': ['Skin'], 'lips': ['Lips'], 'hair': ['Hair'], 'brow': ['Brow', 'Stache'],
    'main': ['Jacket', 'Trouser', 'Dress'], 'lapel': ['Lapel'], 'shade': ['Shade'],
    'accent': ['Tie', 'Sash', 'Trim'], 'metal': ['Gold'], 'frame': ['Glasses'], 'eye': ['Eye', 'Shine'],
}.items():
    for n in names: PALETTE[n] = entry
PALETTE_ENTRIES = ['fixed', 'skin', 'lips', 'hair', 'brow', 'main', 'lapel', 'shade', 'accent', 'metal', 'frame', 'eye']
# palette entry -> the avatar colour slot that paints it (fixed paints nothing)
COLOUR_OF_ENTRY = {'skin': 'skin', 'lips': 'lips', 'hair': 'hair', 'brow': 'hair', 'main': 'main', 'lapel': 'main',
                   'shade': 'main', 'accent': 'accent', 'metal': 'metal', 'frame': 'frame', 'eye': 'eyes'}

# who casts a shadow patch on whom (caster slot -> target slots; 'body' = the body file)
CASTS = {'hairStyle': ['face', 'body'], 'facial': ['face'], 'face': ['body'], 'top': ['body', 'legs'],
         'neck': ['body', 'top'], 'legs': ['body', 'feet'], 'dress': ['body', 'feet'], 'belt': ['dress']}

# triangles per piece (contract 9.1); `look` = a classic Look's pieces together; `heaviest` = the hard ceiling for the
# heaviest combination WITHOUT extras and glasses (the game's own cap, 38,000, also counts those)
BUDGETS = {
    'm': dict(bodyFace=9000, hairStyle=8000, facial=3500, top=9000, neck=1000, legs=3000, feet=2500, extra=1500,
              glasses=2600, look=33000, heaviest=36000),
    'f': dict(bodyFace=11000, hairStyle=12800, makeup=1500, dress=8500, belt=1200, feet=1500, extra=1500,
              glasses=2600, look=33000, heaviest=36000),
}
# named exceptions: Victor's own Swept keeps its shipped 8,544 (on every face it is fitted to: the same shell)
BUDGET_EXCEPTIONS = {('m', 'hairStyle', 'swept'): 8544}
LOOK_BYTES = 1_200_000          # a classic Look's files together
ALL_LOOKS_BYTES = 6_800_000     # the six Looks' files together (today's six GLBs)
def piece_byte_cap(verts, tris): return 40 * verts + 6 * tris + 25_000

# the six classic Looks as pieces (contract 5.3). Female Looks name their gown: on the shared female body 'f' or on
# the fallback gown body that carries that dress.
LOOKS = {
    'victor':   dict(gender='m', face='victor', hairStyle='swept', facial='handlebar', top='tux', neck='bow', legs='trousers', feet='derby'),
    'marcus':   dict(gender='m', face='marcus', hairStyle='sideSwept', facial='none', top='lounge', neck='tie', legs='trousers', feet='derby'),
    'henry':    dict(gender='m', face='henry', hairStyle='quiff', facial='none', top='dinner', neck='bowFull', legs='blackTrousers', feet='derby', glasses='round'),
    'clara':    dict(gender='f', face='clara', hairStyle='waves', makeup='none', dress='column', belt='sash', feet='pumps', extras=['goldDrop']),
    'eleanor':  dict(gender='f', face='eleanor', hairStyle='chignon', makeup='none', dress='ballgown', belt='thin', feet='pumps', extras=['pearlStud']),
    'beatrice': dict(gender='f', face='beatrice', hairStyle='wavyBob', makeup='none', dress='aline', belt='thin', feet='pumps', extras=['goldBall']),
}
BODY_ORDER = ['m', 'f', 'f_column', 'f_ballgown', 'f_aline']

def gender_of(body): return body[0]

def split_key(key):
    """'hairStyle_swept~face_marcus' -> ('hairStyle', 'swept', ('face', 'marcus')); 'body' -> ('body', 'body', None)."""
    if key == 'body': return 'body', 'body', None
    main, _, fit = key.partition('~')
    slot, _, ident = main.partition('_')
    fs = None
    if fit:
        a, _, b = fit.partition('_'); fs = (a, b)
    return slot, ident, fs

def resolve(keys, slot, ident, worn):
    """The file key that draws item (slot, ident) on a guest wearing the piece keys `worn` (contract 3.2): the first
    variant (sorted) whose fit piece is worn, else the plain file, else None."""
    plain = f'{slot}_{ident}'
    for k in sorted(keys):
        if k.startswith(plain + '~') and k.split('~', 1)[1] in worn: return k
    return plain if plain in keys else None
