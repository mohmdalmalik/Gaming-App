"""Render every sound of Hotel Escape: mix, add the room, master, encode, measure.

  python3 tools/audio/build.py                 everything
  python3 tools/audio/build.py lobby click     only these (music piece or effect names)
  python3 tools/audio/build.py --wav           also keep the 32-bit WAV masters (tests/shots/audio/)
  python3 tools/audio/build.py --report        only measure what is in assets/audio/

Writes assets/audio/*.mp3, the playback table src/audio/library.js (generated - do not edit by hand)
and tools/audio/report.json (duration, size, peak, loudness of every file).
"""
import json
import os
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from dsp import (SR, samples, undb, db, hp, lp, shelf, peq, hall_ir, convolve, compressor, limiter,  # noqa: E402
                 loudness, true_peak_db, normalize_lufs, circular, stereo, mono, click_score, fade)
import music  # noqa: E402
import sfx  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'audio')
LIB = os.path.join(ROOT, 'src', 'audio', 'library.js')
REPORT = os.path.join(HERE, 'report.json')
WAVDIR = os.path.join(ROOT, 'tests', 'shots', 'audio')
PAD = 4096           # samples of the loop's own end / start kept before / after it in a loop file

MUSIC_BITRATE = '128k'


# --- mixing ------------------------------------------------------------------------------------
def mix_piece(P):
    loop = P['loop']
    stems = P['stems']
    n = next(iter(stems.values())).shape[1]
    dry = np.zeros((2, n))
    send = np.zeros((2, n))
    wet_only = P.get('wet_only', set())
    levels = {}
    for name, (target, amt) in P['mix'].items():
        x = stems[name]
        lev = loudness(x)['integrated']
        g = undb(target - lev) if lev > -90 else 0.0
        levels[name] = round(lev, 1)
        x = x * g
        dry += x * (0.22 if name in wet_only else 1.0)
        send += x * amt
    rv = P['reverb']
    ir = hall_ir(rv['rt60'], predelay=rv.get('predelay', 0.02), seed=rv.get('seed', 1), dark=rv.get('dark', 1.0))
    if loop:
        wet = convolve(send, ir, circular_n=n)
        wet = circular(lambda z: lp(hp(z, 160, 2), 6500, 2), wet, 4.0)
    else:
        wet = convolve(send, ir)[:, :n]
        wet = lp(hp(wet, 160, 2), 6500, 2)
    x = dry + wet
    # master: clean lows, (lobby) a gramophone-era top, a little glue, then loudness + limiter
    def eq(z):
        z = hp(z, 30, 2)
        if P.get('vintage'):
            z = shelf(z, 8000, -1.5, 'high')
            z = peq(z, 240, 1.0, 0.8)
        return z
    x = circular(eq, x, 4.0) if loop else eq(x)
    x = compressor(x, thr_db=-24, ratio=1.6, attack=0.03, release=0.4, loop=loop)
    if not loop:
        x = trim_tail(x)
        if P.get('fade_out'):
            x = fade(x, 0, P['fade_out'])
    x = normalize_lufs(x, P['target'], ceiling_db=-1.6, loop=loop)
    if loop:
        x = x - x.mean(axis=1, keepdims=True)
    return x, levels


def trim_tail(x, floor_db=-66):
    env = np.max(np.abs(x), axis=0)
    thr = undb(floor_db) * np.max(env)
    idx = np.nonzero(env > thr)[0]
    end = idx[-1] + samples(0.05) if len(idx) else x.shape[1]
    return x[:, :min(x.shape[1], end)]


# --- files ------------------------------------------------------------------------------------
def encode(x, path, bitrate, channels=2):
    x = stereo(x) if channels == 2 else mono(x)[None, :]
    raw = np.ascontiguousarray(x.T.astype('<f4')).tobytes()
    cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(channels), '-i', 'pipe:0',
           '-c:a', 'libmp3lame', '-b:a', bitrate, '-ar', str(SR), path]
    subprocess.run(cmd, input=raw, check=True)


def channels_of(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels',
                        '-of', 'csv=p=0', path], capture_output=True, text=True, check=True)
    return int(r.stdout.strip() or 2)


def decode(path):
    """The file as the browser hears it: a mono file is played on both speakers at full level."""
    ch = channels_of(path)
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', str(ch), '-ar', str(SR), 'pipe:1'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(out, '<f4').reshape(-1, ch).T.astype(float)
    return np.vstack([x[0], x[0]]) if ch == 1 else x


def write_wav(x, path):
    from scipy.io import wavfile
    wavfile.write(path, SR, np.ascontiguousarray(stereo(x).T.astype(np.float32)))


def ffmpeg_lufs(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True)
    txt = r.stderr
    try:
        i = txt.rindex('Integrated loudness:')
        I = float(txt[i:].split('I:')[1].split('LUFS')[0])
        tp = float(txt[txt.rindex('True peak:'):].split('Peak:')[1].split('dBFS')[0])
        return I, tp
    except Exception:
        return None, None


def measure(path, kind, loop_n=None):
    d = decode(path)
    L = loudness(d)
    info = {
        'file': os.path.relpath(path, ROOT), 'kind': kind, 'bytes': os.path.getsize(path), 'channels': channels_of(path),
        'duration': round(d.shape[1] / SR, 3), 'peak_dbfs': round(db(np.max(np.abs(d))), 2),
        'true_peak_dbtp': round(true_peak_db(d), 2), 'lufs': round(L['integrated'], 1),
        'short_term_max': round(L['shortMax'], 1), 'momentary_max': round(L['momentaryMax'], 1), 'dc': float(np.max(np.abs(d.mean(axis=1)))),
    }
    fI, fTP = ffmpeg_lufs(path)
    if fI is not None:
        info['ffmpeg_lufs'] = fI
        info['ffmpeg_true_peak'] = fTP
    if loop_n:
        # the decoded file holds [end of loop][loop][start of loop]: if it is periodic across the
        # loop points, a player looping [PAD, PAD + N) can never click, however much the decoder
        # delays the audio (up to PAD samples)
        k = 2048
        for off in (0, 1105):          # trimmed decoder / a decoder that keeps the encoder delay
            a = d[:, PAD - off: PAD - off + k]
            b = d[:, PAD + loop_n - off: PAD + loop_n - off + k]
            rms = np.sqrt(np.mean(d ** 2)) + 1e-9
            info[f'seam_diff_db_off{off}'] = round(db(np.sqrt(np.mean((a - b) ** 2)) / rms), 1)
        seam = np.concatenate([d[:, PAD + loop_n - 4096: PAD + loop_n], d[:, PAD: PAD + 4096]], axis=1)
        info['seam_click_score'] = round(click_score(seam), 1)
        info['body_click_score'] = round(click_score(d[:, PAD: PAD + min(loop_n, SR * 20)]), 1)
    return info


# --- the build --------------------------------------------------------------------------------
def build_music(name, keep_wav=False):
    t0 = time.time()
    P = music.PIECES[name]()
    x, levels = mix_piece(P)
    if keep_wav:
        os.makedirs(WAVDIR, exist_ok=True)
        write_wav(x, os.path.join(WAVDIR, f'music-{name}.wav'))
    path = os.path.join(OUT, f'music-{name}.mp3')
    entry = {'file': f'music-{name}.mp3'}
    if P['loop']:
        n = x.shape[1]
        padded = np.concatenate([x[:, n - PAD:], x, x[:, :PAD]], axis=1)
        pre = {'seam_pcm_click': round(click_score(np.concatenate([x[:, -4096:], x[:, :4096]], axis=1)), 1)}
        encode(padded, path, MUSIC_BITRATE)
        info = measure(path, 'music-loop', loop_n=n)
        info.update(pre)
        entry.update({'loopStart': round(PAD / SR, 6), 'loopEnd': round((PAD + n) / SR, 6), 'loop': True})
    else:
        encode(x, path, MUSIC_BITRATE)
        info = measure(path, 'stinger')
        entry.update({'loop': False})
    info['stems_lufs'] = levels
    info['render_s'] = round(time.time() - t0, 1)
    entry['duration'] = info['duration']
    return entry, info


def build_sfx(name, keep_wav=False):
    t0 = time.time()
    spec = sfx.EFFECTS[name]
    x = spec['fn']()
    ch = 2 if (x.ndim == 2 and spec.get('stereo')) else 1
    x = sfx.finish(x, spec, stereo_out=(ch == 2))
    if keep_wav:
        os.makedirs(WAVDIR, exist_ok=True)
        write_wav(x, os.path.join(WAVDIR, f'sfx-{name}.wav'))
    path = os.path.join(OUT, f'sfx-{name}.mp3')
    encode(x, path, spec.get('bitrate', '96k' if ch == 2 else '64k'), channels=ch)
    info = measure(path, 'sfx')
    info['render_s'] = round(time.time() - t0, 1)
    entry = {'file': f'sfx-{name}.mp3', 'duration': info['duration']}
    if spec.get('slices'):
        entry['slices'] = spec['slices']
    return entry, info


def write_library(lib):
    music_keys = [k for k in lib if k.startswith('music:')]
    sfx_keys = [k for k in lib if k.startswith('sfx:')]

    def obj(d):
        return json.dumps(d, separators=(', ', ': '))
    lines = [
        '// GENERATED by tools/audio/build.py - do not edit by hand (run the build again instead).',
        '// Every sound file of the game: music loops (loopStart / loopEnd in seconds: the file keeps a',
        "// little of the loop's own end before it and of its start after it, so the loop is seamless even",
        '// if a decoder shifts the audio) and the effects. Mix levels and behaviour live in src/audio/sounds.js.',
        'export const MUSIC = {',
    ]
    for k in music_keys:
        lines.append(f"  {k.split(':', 1)[1]}: {obj(lib[k])},")
    lines.append('};')
    lines.append('export const EFFECTS = {')
    for k in sfx_keys:
        lines.append(f"  {k.split(':', 1)[1]}: {obj(lib[k])},")
    lines.append('};')
    with open(LIB, 'w') as f:
        f.write('\n'.join(lines) + '\n')


def main(argv):
    keep = '--wav' in argv
    names = [a for a in argv if not a.startswith('--')]
    os.makedirs(OUT, exist_ok=True)
    report = json.load(open(REPORT)) if os.path.exists(REPORT) else {}
    lib = {}
    # keep earlier entries (a partial build only replaces what it renders)
    for k, v in report.items():
        if 'library' in v:
            lib[k] = v['library']
    todo_m = [n for n in music.PIECES if not names or n in names]
    todo_s = [n for n in sfx.EFFECTS if not names or n in names]
    for n in todo_m:
        entry, info = build_music(n, keep)
        info['library'] = entry
        report[f'music:{n}'] = info
        lib[f'music:{n}'] = entry
        print(f"music {n:13s} {info['duration']:7.2f}s {info['bytes'] / 1024:7.0f} KB  {info['lufs']:6.1f} LUFS  "
              f"peak {info['peak_dbfs']:6.2f}  tp {info['true_peak_dbtp']:6.2f}  "
              + (f"seam {info.get('seam_diff_db_off0')}/{info.get('seam_diff_db_off1105')} dB  click {info.get('seam_click_score')}/{info.get('body_click_score')}  " if 'seam_click_score' in info else '')
              + f"({info['render_s']}s)", flush=True)
    for n in todo_s:
        entry, info = build_sfx(n, keep)
        info['library'] = entry
        report[f'sfx:{n}'] = info
        lib[f'sfx:{n}'] = entry
        print(f"sfx   {n:13s} {info['duration']:7.2f}s {info['bytes'] / 1024:7.1f} KB  {info['lufs']:6.1f} LUFS  mom {info['momentary_max']:6.1f}  "
              f"peak {info['peak_dbfs']:6.2f}  tp {info['true_peak_dbtp']:6.2f}", flush=True)
    # drop entries whose source no longer exists
    lib = {k: v for k, v in lib.items() if (k.split(':')[0] == 'music' and k.split(':')[1] in music.PIECES)
           or (k.split(':')[0] == 'sfx' and k.split(':')[1] in sfx.EFFECTS)}
    report = {k: v for k, v in report.items() if k in lib}
    order = [f'music:{n}' for n in music.PIECES] + [f'sfx:{n}' for n in sfx.EFFECTS]
    lib = {k: lib[k] for k in order if k in lib}
    report = {k: report[k] for k in order if k in report}
    write_library(lib)
    total = sum(v['bytes'] for v in report.values())
    with open(REPORT, 'w') as f:
        json.dump(report, f, indent=1)
    print(f'total {len(report)} files, {total / 1024 / 1024:.2f} MB')


if __name__ == '__main__':
    main(sys.argv[1:])
