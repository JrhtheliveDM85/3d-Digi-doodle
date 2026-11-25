// exporters.js — write STL and 3MF in millimetres.
// Input is a THREE.BufferGeometry whose units are already millimetres
// (in this app 1 three.js unit = 1 mm).

import { zipSync, strToU8 } from 'fflate';

// Return {positions:Float32Array of triangle verts, count:triangleCount}
function toTriangles(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  const count = pos.count / 3;
  return { array: pos.array, triCount: count };
}

/* ---------------- STL (binary) ---------------- */
export function exportSTL(geometry) {
  const { array, triCount } = toTriangles(geometry);
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  // 80-byte header
  const header = 'Clay Blocks STL (mm)';
  for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  view.setUint32(80, triCount, true);
  let o = 84;
  const ax = array;
  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    // normal
    const x1 = ax[i], y1 = ax[i+1], z1 = ax[i+2];
    const x2 = ax[i+3], y2 = ax[i+4], z2 = ax[i+5];
    const x3 = ax[i+6], y3 = ax[i+7], z3 = ax[i+8];
    const ux = x2-x1, uy = y2-y1, uz = z2-z1;
    const vx = x3-x1, vy = y3-y1, vz = z3-z1;
    let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx/=len; ny/=len; nz/=len;
    view.setFloat32(o, nx, true); view.setFloat32(o+4, ny, true); view.setFloat32(o+8, nz, true); o+=12;
    for (let v = 0; v < 3; v++) {
      view.setFloat32(o, ax[i+v*3], true);
      view.setFloat32(o+4, ax[i+v*3+1], true);
      view.setFloat32(o+8, ax[i+v*3+2], true);
      o += 12;
    }
    view.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buffer);
}

/* ---------------- 3MF ---------------- */
// A 3MF file is a zip with a small set of XML parts. Units are millimetres.
export function export3MF(geometry) {
  const g = geometry.index ? geometry : mergeToIndexed(geometry);
  const pos = g.attributes.position;
  const idx = g.index;

  let verts = '';
  for (let i = 0; i < pos.count; i++) {
    verts += `<vertex x="${fmt(pos.getX(i))}" y="${fmt(pos.getY(i))}" z="${fmt(pos.getZ(i))}"/>`;
  }
  let tris = '';
  for (let i = 0; i < idx.count; i += 3) {
    tris += `<triangle v1="${idx.getX(i)}" v2="${idx.getX(i+1)}" v3="${idx.getX(i+2)}"/>`;
  }

  const model =
`<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">Clay Blocks</metadata>
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>${verts}</vertices>
        <triangles>${tris}</triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`;

  const contentTypes =
`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

  const rels =
`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  const files = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  };
  return zipSync(files, { level: 6 });
}

function fmt(n) { return (Math.round(n * 1000) / 1000).toString(); }

// Fallback: build an indexed geometry by welding identical positions.
function mergeToIndexed(geometry) {
  const pos = geometry.attributes.position;
  const map = new Map();
  const verts = [];
  const indices = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x*1000)},${Math.round(y*1000)},${Math.round(z*1000)}`;
    let id = map.get(key);
    if (id === undefined) { id = verts.length / 3; verts.push(x, y, z); map.set(key, id); }
    indices.push(id);
  }
  return {
    attributes: {
      position: {
        count: verts.length / 3,
        getX: (i) => verts[i*3], getY: (i) => verts[i*3+1], getZ: (i) => verts[i*3+2],
      },
    },
    index: { count: indices.length, getX: (i) => indices[i] },
  };
}
