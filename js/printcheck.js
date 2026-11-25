// printcheck.js — say only what we actually checked.
// Bambu Lab X2D main-nozzle build space: 256 x 256 x 260 mm.
//
// Fix it for me is offered only for "sit on the plate" and "make it smaller".
// Make it clay is a separate button. It joins shapes. It does not repair gaps.
// The surface note looks for gaps wider than 0.2 mm. It does not prove the skin is closed.

import * as THREE from 'three';

export const PLATE = { x: 256, y: 256, z: 260 }; // width, depth, height (mm)

// Vertices closer than this are treated as the same point when edges are paired.
const WELD_MM = 0.05;
// A paired-edge miss is only called a gap when the middle of that edge
// sits this far from every other triangle. Joins often leave T-junctions:
// the edge is unpaired in the index, but it still lies on the skin.
// 0.2 mm is below what a typical workshop printer can reproduce.
const GAP_MM = 0.2;

// geometry: merged BufferGeometry in mm, world space (y is up).
// isClay: has Make it clay already joined the shapes?
export function checkModel(geometry, { isClay } = {}) {
  const checks = [];
  const tri = geometry ? triangleCount(geometry) : 0;

  if (!geometry || tri === 0) {
    checks.push({
      ok: false, level: 'no', key: 'empty',
      msg: 'There is nothing to print yet. Add a shape first.',
    });
    return { checks, ready: false, size: null, surface: null };
  }

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const size = new THREE.Vector3();
  bb.getSize(size);

  const fits = size.x <= PLATE.x + 0.01 && size.z <= PLATE.x + 0.01 && size.y <= PLATE.z + 0.01;
  if (fits) {
    checks.push({
      ok: true, level: 'ok', key: 'fit',
      msg: `It fits the Bambu Lab X2D main space. It is ${mm(size.x)} wide, ${mm(size.z)} deep and ${mm(size.y)} tall.`,
    });
  } else {
    checks.push({
      ok: false, level: 'no', key: 'fit', fix: 'shrink',
      msg: `It is too big for the Bambu Lab X2D main space. It needs to fit inside ${PLATE.x} by ${PLATE.x} by ${PLATE.z} mm.`,
    });
  }

  const bottom = bb.min.y;
  if (Math.abs(bottom) <= 0.5) {
    checks.push({ ok: true, level: 'ok', key: 'flat', msg: 'It sits flat on the plate.' });
  } else if (bottom > 0.5) {
    checks.push({
      ok: false, level: 'no', key: 'flat', fix: 'drop',
      msg: 'It floats above the plate. It should sit on the plate to print well.',
    });
  } else {
    checks.push({
      ok: false, level: 'no', key: 'flat', fix: 'drop',
      msg: 'Part of it is under the plate. It should sit on top of the plate.',
    });
  }

  let surface = null;
  if (!isClay) {
    checks.push({
      ok: false, level: 'no', key: 'separate', fix: 'clay',
      msg: 'Your shapes are still separate. Make it clay joins the solid shapes and cuts the holes. It does not close gaps in the skin.',
    });
  } else {
    surface = analyzeSurface(geometry);
    checks.push(surfaceCheck(surface));
  }

  const ready = checks.every((c) => c.ok);
  return { checks, ready, size, surface };
}

function surfaceCheck(surface) {
  const extra = [];
  if (surface.shells > 1) {
    extra.push(`This model has ${surface.shells} separate pieces. Pieces that do not touch stay separate.`);
  }
  if (surface.nonManifold > 0) {
    extra.push('Some edges are shared by more than two faces. This app cannot repair those.');
  }
  if (surface.gaps > 0) {
    const gap = surface.gaps === 1
      ? 'This check found a gap in the skin wider than 0.2 mm. This app cannot close it.'
      : 'This check found gaps in the skin wider than 0.2 mm. This app cannot close them.';
    return { ok: false, level: 'warn', key: 'surface', msg: [gap, ...extra].join(' ') };
  }
  const note = 'A simple check found no gap wider than 0.2 mm. This is not a promise that the skin is fully closed. It does not look for parts that pass through each other.';
  return { ok: true, level: 'note', key: 'surface', msg: [note, ...extra].join(' ') };
}

// Count how the mesh is connected.
// boundary: edges used by one triangle (unpaired in the index, including T-junctions).
// gaps: unpaired edges whose middle is farther than gapMm from every other triangle.
// nonManifold: edges used by more than two triangles.
// shells: separate pieces that do not touch.
export function analyzeSurface(geometry, { weldMm = WELD_MM, gapMm = GAP_MM } = {}) {
  const empty = { triangles: 0, boundary: 0, gaps: 0, nonManifold: 0, shells: 0 };
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return empty;

  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const scale = 1 / weldMm;
  const idOf = new Map();
  let next = 0;
  const xyz = [];

  function weld(i) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = Math.round(x * scale) + ',' + Math.round(y * scale) + ',' + Math.round(z * scale);
    let id = idOf.get(key);
    if (id === undefined) {
      id = next++;
      idOf.set(key, id);
      xyz.push(x, y, z);
    }
    return id;
  }
  function at(t, k) {
    return index ? index.getX(t * 3 + k) : t * 3 + k;
  }

  const parent = [];
  function find(a) {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  }
  function unite(a, b) {
    a = find(a); b = find(b);
    if (a !== b) parent[b] = a;
  }

  const tris = [];
  const edges = new Map();
  for (let t = 0; t < triCount; t++) {
    const a = weld(at(t, 0));
    const b = weld(at(t, 1));
    const c = weld(at(t, 2));
    if (a === b || b === c || c === a) continue;
    const ti = tris.length;
    tris.push(a, b, c);
    if (parent[a] === undefined) parent[a] = a;
    if (parent[b] === undefined) parent[b] = b;
    if (parent[c] === undefined) parent[c] = c;
    unite(a, b);
    unite(b, c);
    addEdge(edges, a, b, ti);
    addEdge(edges, b, c, ti);
    addEdge(edges, c, a, ti);
  }

  let boundary = 0;
  let nonManifold = 0;
  const boundaryEdges = [];
  for (const [key, owners] of edges) {
    if (owners.length === 1) {
      boundary++;
      boundaryEdges.push(key, owners[0]);
    } else if (owners.length > 2) nonManifold++;
  }
  const gaps = boundary === 0 ? 0 : countGaps(tris, xyz, boundaryEdges, gapMm);

  const roots = new Set();
  for (let i = 0; i < next; i++) if (parent[i] !== undefined) roots.add(find(i));
  return { triangles: tris.length / 3, boundary, gaps, nonManifold, shells: roots.size };
}

function addEdge(map, i, j, ti) {
  const key = i < j ? i + '|' + j : j + '|' + i;
  const list = map.get(key);
  if (list) list.push(ti);
  else map.set(key, [ti]);
}

// Unpaired edges whose middle does not lie on another triangle.
function countGaps(tris, xyz, boundaryEdges, gapMm) {
  const cell = 2;
  const grid = new Map();
  const n = tris.length / 3;
  for (let ti = 0; ti < n; ti++) {
    const a = tris[ti * 3], b = tris[ti * 3 + 1], c = tris[ti * 3 + 2];
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (const id of [a, b, c]) {
      const x = xyz[id * 3], y = xyz[id * 3 + 1], z = xyz[id * 3 + 2];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    const x0 = Math.floor(minx / cell), x1 = Math.floor(maxx / cell);
    const y0 = Math.floor(miny / cell), y1 = Math.floor(maxy / cell);
    const z0 = Math.floor(minz / cell), z1 = Math.floor(maxz / cell);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const key = x + ',' + y + ',' + z;
          const bucket = grid.get(key);
          if (bucket) bucket.push(ti);
          else grid.set(key, [ti]);
        }
      }
    }
  }

  const tri = new THREE.Triangle();
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const limit = gapMm * gapMm;
  let gaps = 0;

  for (let e = 0; e < boundaryEdges.length; e += 2) {
    const key = boundaryEdges[e];
    const owner = boundaryEdges[e + 1];
    const bar = key.indexOf('|');
    const i = Number(key.slice(0, bar));
    const j = Number(key.slice(bar + 1));
    mid.set(
      (xyz[i * 3] + xyz[j * 3]) * 0.5,
      (xyz[i * 3 + 1] + xyz[j * 3 + 1]) * 0.5,
      (xyz[i * 3 + 2] + xyz[j * 3 + 2]) * 0.5
    );
    const ix = Math.floor(mid.x / cell);
    const iy = Math.floor(mid.y / cell);
    const iz = Math.floor(mid.z / cell);
    let nearest = Infinity;
    const seen = new Set();
    for (let dx = -1; dx <= 1 && nearest > limit; dx++) {
      for (let dy = -1; dy <= 1 && nearest > limit; dy++) {
        for (let dz = -1; dz <= 1 && nearest > limit; dz++) {
          const bucket = grid.get((ix + dx) + ',' + (iy + dy) + ',' + (iz + dz));
          if (!bucket) continue;
          for (let k = 0; k < bucket.length; k++) {
            const ti = bucket[k];
            if (ti === owner || seen.has(ti)) continue;
            seen.add(ti);
            const a = tris[ti * 3], b = tris[ti * 3 + 1], c = tris[ti * 3 + 2];
            va.set(xyz[a * 3], xyz[a * 3 + 1], xyz[a * 3 + 2]);
            vb.set(xyz[b * 3], xyz[b * 3 + 1], xyz[b * 3 + 2]);
            vc.set(xyz[c * 3], xyz[c * 3 + 1], xyz[c * 3 + 2]);
            tri.a = va; tri.b = vb; tri.c = vc;
            tri.closestPointToPoint(mid, closest);
            const d = closest.distanceToSquared(mid);
            if (d < nearest) nearest = d;
            if (nearest <= limit) break;
          }
        }
      }
    }
    if (nearest > limit) gaps++;
  }
  return gaps;
}

function triangleCount(geometry) {
  const n = geometry.index ? geometry.index.count : geometry.attributes.position.count;
  return n / 3;
}

function mm(v) { return Math.round(v) + ' mm'; }
