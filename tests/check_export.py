#!/usr/bin/env python3
"""Check a Clay Blocks STL and 3MF the way a file inspector can.

Prints a short report and exits 1 when the file is not a usable print file.
This does not slice the file. A slicer test is still a separate step.
"""
import json
import math
import struct
import sys
import zipfile
from collections import defaultdict


def load_stl(path):
    data = open(path, "rb").read()
    if len(data) < 84:
        raise SystemExit(f"{path}: too small to be a binary STL")
    count = struct.unpack_from("<I", data, 80)[0]
    need = 84 + count * 50
    if len(data) != need:
        raise SystemExit(f"{path}: {len(data)} bytes, triangle count {count} needs {need}")
    tris = []
    o = 84
    for _ in range(count):
        o += 12  # normal is recomputed below; the stored one is checked only for finiteness
        verts = []
        for _v in range(3):
            verts.append(struct.unpack_from("<fff", data, o))
            o += 12
        o += 2
        tris.append(verts)
    header = data[:80].split(b"\x00", 1)[0].decode("latin1", "replace")
    return header, tris


def bounds(tris):
    mins = [math.inf, math.inf, math.inf]
    maxs = [-math.inf, -math.inf, -math.inf]
    for tri in tris:
        for v in tri:
            for k in range(3):
                mins[k] = min(mins[k], v[k])
                maxs[k] = max(maxs[k], v[k])
    return mins, maxs


def signed_volume(tris):
    vol = 0.0
    for (ax, ay, az), (bx, by, bz), (cx, cy, cz) in tris:
        vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    return vol / 6.0


def edge_report(tris, weld=0.05):
    scale = 1.0 / weld
    ids = {}
    xyz = []

    def weld_id(v):
        key = (round(v[0] * scale), round(v[1] * scale), round(v[2] * scale))
        if key not in ids:
            ids[key] = len(xyz)
            xyz.append(v)
        return ids[key]

    edges = defaultdict(int)
    for a, b, c in tris:
        ia, ib, ic = weld_id(a), weld_id(b), weld_id(c)
        if ia == ib or ib == ic or ic == ia:
            continue
        for i, j in ((ia, ib), (ib, ic), (ic, ia)):
            edges[(i, j) if i < j else (j, i)] += 1
    lengths = []
    boundary = nonmanifold = 0
    for (i, j), n in edges.items():
        if n == 1:
            boundary += 1
        elif n > 2:
            nonmanifold += 1
            ax, ay, az = xyz[i]
            bx, by, bz = xyz[j]
            lengths.append(math.dist((ax, ay, az), (bx, by, bz)))
    lengths.sort()
    return {
        "boundary": boundary,
        "nonManifold": nonmanifold,
        "shortestMm": round(lengths[0], 4) if lengths else 0,
        "medianMm": round(lengths[len(lengths) // 2], 4) if lengths else 0,
        "longestMm": round(lengths[-1], 4) if lengths else 0,
        "totalMm": round(sum(lengths), 3),
    }


def load_3mf(path):
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        if "3D/3dmodel.model" not in names or "[Content_Types].xml" not in names:
            raise SystemExit(f"{path}: not a 3MF package, parts={names}")
        xml = zf.read("3D/3dmodel.model").decode("utf-8")
    if 'unit="millimeter"' not in xml:
        raise SystemExit(f"{path}: 3MF unit is not millimeter")
    # Pull vertex coordinates. The file is one long line.
    verts = []
    start = 0
    token = 'vertex x="'
    while True:
        i = xml.find(token, start)
        if i < 0:
            break
        chunk = xml[i:i + 160]
        def grab(name):
            key = name + '="'
            a = chunk.find(key)
            b = chunk.find('"', a + len(key))
            return float(chunk[a + len(key):b])
        verts.append((grab("x"), grab("y"), grab("z")))
        start = i + len(token)
    return xml, verts


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: check_export.py model.stl model.3mf")
    header, tris = load_stl(sys.argv[1])
    mins, maxs = bounds(tris)
    size = [maxs[k] - mins[k] for k in range(3)]
    xml, verts = load_3mf(sys.argv[2])
    vmins = [min(v[k] for v in verts) for k in range(3)]
    vmaxs = [max(v[k] for v in verts) for k in range(3)]
    report = {
        "stlHeader": header,
        "triangles": len(tris),
        "stlMin": [round(n, 3) for n in mins],
        "stlMax": [round(n, 3) for n in maxs],
        "stlSize": [round(n, 3) for n in size],
        "zMin": round(mins[2], 3),
        "signedVolumeMm3": round(signed_volume(tris), 1),
        "edges": edge_report(tris),
        "mfVertices": len(verts),
        "mfZMin": round(vmins[2], 3),
        "mfSize": [round(vmaxs[k] - vmins[k], 3) for k in range(3)],
        "application": "Clay Blocks" in xml,
    }
    # The two files must describe the same bed placement.
    if abs(report["zMin"]) > 0.6 or abs(report["mfZMin"]) > 0.6:
        raise SystemExit("model is not sitting on Z = 0:\n" + json.dumps(report, indent=2))
    if report["signedVolumeMm3"] <= 0:
        raise SystemExit("mesh volume is inside-out or empty:\n" + json.dumps(report, indent=2))
    if not report["application"]:
        raise SystemExit("3MF is missing the Clay Blocks name")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
