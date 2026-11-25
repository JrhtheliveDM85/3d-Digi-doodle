// scene.js — the 3D workshop.
// Blocks mode: stack simple shapes. Clay mode: one mesh you can sculpt.

import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { mergeVertices, mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { Evaluator, Brush, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { analyzeSurface } from './printcheck.js';

const PLATE_MM = 256;      // build plate width/depth
let ID = 1;
const nextId = () => 'p' + (ID++);

const KIND_COLORS = {
  box: 0x4c9be8, cylinder: 0x63c07a, sphere: 0xe8a24c,
  cone: 0xc06fd6, wedge: 0xe86c6c, clay: 0xd9c3a5,
};

export class Scene {
  constructor(canvas, { onChange = () => {}, onSelect = () => {} } = {}) {
    this.canvas = canvas;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.tool = 'none';        // 'shapes' | 'move' | 'sculpt' | 'none'
    this.isClay = false;
    this.selected = null;      // selected shape mesh (blocks mode)
    this.sculpt = { brush: 'pull', size: 30, strength: 0.6 };

    this._initThree();
    this._initPicking();
    this._animate();
  }

  /* ---------------- setup ---------------- */
  _initThree() {
    const c = this.canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeef1f5);

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    this.camera.position.set(200, 210, 320);

    this.controls = new OrbitControls(this.camera, c);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 40, 0);
    this.controls.maxPolarAngle = Math.PI * 0.49; // don't go under the floor

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa2ad, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(180, 320, 220);
    this.scene.add(dir);

    // Build plate: a flat plane + a grid, centred at origin, top surface y=0.
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(PLATE_MM, PLATE_MM),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = -0.01;
    plate.name = 'plate';
    this.scene.add(plate);
    const grid = new THREE.GridHelper(PLATE_MM, 16, 0x9aa4b2, 0xc7cfd8);
    grid.position.y = 0;
    this.scene.add(grid);

    this.shapesGroup = new THREE.Group();
    this.scene.add(this.shapesGroup);

    this.clayMesh = null;

    // Selection highlight box
    this.selBox = new THREE.BoxHelper(undefined, 0xf59e0b);
    this.selBox.visible = false;
    this.scene.add(this.selBox);

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      if (this.selBox.visible && this.selected) this.selBox.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  /* ---------------- geometry per kind ---------------- */
  _makeGeometry(kind, s) {
    let g;
    if (kind === 'box') g = new THREE.BoxGeometry(s.x, s.y, s.z, 2, 2, 2);
    else if (kind === 'cylinder') g = new THREE.CylinderGeometry(s.x/2, s.x/2, s.y, 48);
    else if (kind === 'sphere') g = new THREE.SphereGeometry(s.x/2, 48, 32);
    else if (kind === 'cone') g = new THREE.ConeGeometry(s.x/2, s.y, 48);
    else if (kind === 'wedge') g = this._wedgeGeometry(s.x, s.y, s.z);
    else g = new THREE.BoxGeometry(s.x, s.y, s.z);
    return g;
  }

  // A ramp: right-triangle prism. Low at -x, high at +x, depth along z.
  _wedgeGeometry(w, h, d) {
    const hw = w/2, hh = h/2, hd = d/2;
    // 6 corners
    const v = [
      -hw,-hh,-hd,  hw,-hh,-hd,  hw,hh,-hd,   // back triangle
      -hw,-hh, hd,  hw,-hh, hd,  hw,hh, hd,   // front triangle
    ];
    const faces = [
      0,1,2,        // back
      5,4,3,        // front
      0,3,4, 0,4,1, // bottom
      1,4,5, 1,5,2, // vertical (+x) face
      0,2,5, 0,5,3, // slope
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex(faces);
    g.computeVertexNormals();
    return g;
  }

  // default size per kind (mm)
  _defaultSize(kind) {
    if (kind === 'sphere') return { x: 40, y: 40, z: 40 };
    if (kind === 'cylinder' || kind === 'cone') return { x: 40, y: 50, z: 40 };
    if (kind === 'wedge') return { x: 60, y: 40, z: 40 };
    return { x: 50, y: 40, z: 50 };
  }

  /* ---------------- shapes ---------------- */
  addShape(kind) {
    if (this.isClay) return; // clay mode has one piece only
    const s = this._defaultSize(kind);
    const geo = this._makeGeometry(kind, s);
    const mat = new THREE.MeshStandardMaterial({ color: KIND_COLORS[kind] || 0x8899aa, roughness: 0.55, metalness: 0.02 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { id: nextId(), kind, size: { ...s }, isHole: false };
    mesh.position.set(0, s.y / 2, 0); // sit on plate
    this.shapesGroup.add(mesh);
    this._select(mesh);
    this.onChange('add-' + kind);
  }

  _select(mesh) {
    this.selected = mesh || null;
    if (mesh) { this.selBox.setFromObject(mesh); this.selBox.visible = true; }
    else this.selBox.visible = false;
    this.onSelect(this.getSelected());
  }

  getSelected() {
    const m = this.selected;
    if (!m || !m.parent) return null;
    return { id: m.userData.id, kind: m.userData.kind, size: { ...m.userData.size }, isHole: !!m.userData.isHole };
  }

  setSelectedSize(size) {
    const m = this.selected; if (!m) return;
    const s = m.userData.size;
    s.x = clampMM(size.x ?? s.x); s.y = clampMM(size.y ?? s.y); s.z = clampMM(size.z ?? s.z);
    if (m.userData.kind === 'sphere') s.y = s.z = s.x;
    if (m.userData.kind === 'cylinder' || m.userData.kind === 'cone') s.z = s.x;
    const bottom = m.position.y - (m.geometry.boundingBox ? 0 : 0); // recompute below
    const oldBottom = this._bottomOf(m);
    m.geometry.dispose();
    m.geometry = this._makeGeometry(m.userData.kind, s);
    // keep the bottom where it was
    m.geometry.computeBoundingBox();
    const halfH = (m.geometry.boundingBox.max.y - m.geometry.boundingBox.min.y) / 2;
    m.position.y = oldBottom + halfH;
    this.selBox.setFromObject(m);
    this.onChange('resize');
  }

  setSelectedHole(isHole) {
    const m = this.selected; if (!m) return;
    m.userData.isHole = !!isHole;
    m.material.transparent = !!isHole;
    m.material.opacity = isHole ? 0.4 : 1;
    m.material.color.set(isHole ? 0x8a8f98 : (KIND_COLORS[m.userData.kind] || 0x8899aa));
    m.material.wireframe = !!isHole;
    this.onChange('hole');
  }

  deleteSelected() {
    const m = this.selected; if (!m) return;
    this.shapesGroup.remove(m); m.geometry.dispose(); m.material.dispose();
    this._select(null);
    this.onChange('delete');
  }

  _bottomOf(mesh) {
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    return mesh.position.y + bb.min.y;
  }
  _topOf(mesh) {
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    return mesh.position.y + bb.max.y;
  }
  _halfH(mesh) {
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    return (bb.max.y - bb.min.y) / 2;
  }

  /* ---------------- tools ---------------- */
  setTool(tool) {
    this.tool = tool;
    // in sculpt mode we lock orbit while a brush stroke is happening only
  }

  setSculptBrush(b) { this.sculpt.brush = b; }
  setSculptSize(mm) { this.sculpt.size = Math.max(6, Math.min(120, Number(mm) || 30)); }

  get hasContent() { return this.isClay ? !!this.clayMesh : this.shapesGroup.children.length > 0; }

  /* ---------------- picking / interaction ---------------- */
  _initPicking() {
    const c = this.canvas;
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragging = null;      // {mesh, offset}
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
    this.sculpting = false;

    c.addEventListener('pointerdown', (e) => this._onDown(e));
    c.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', (e) => this._onUp(e));
  }

  _setPointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
  }

  _onDown(e) {
    this._setPointer(e);
    if (this.isClay && this.tool === 'sculpt' && this.clayMesh) {
      const hit = this.ray.intersectObject(this.clayMesh, false)[0];
      if (hit) { this.sculpting = true; this.controls.enabled = false; this._applyBrush(hit); }
      return;
    }
    // blocks mode: select / start drag
    if (!this.isClay && (this.tool === 'move' || this.tool === 'shapes')) {
      const hit = this.ray.intersectObjects(this.shapesGroup.children, false)[0];
      if (hit) {
        this._select(hit.object);
        if (this.tool === 'move') {
          const p = new THREE.Vector3();
          this.ray.ray.intersectPlane(this.groundPlane, p);
          this.dragging = { mesh: hit.object, offset: new THREE.Vector3().subVectors(hit.object.position, new THREE.Vector3(p.x, hit.object.position.y, p.z)) };
          this.controls.enabled = false;
        }
      } else if (this.tool === 'move' || this.tool === 'shapes') {
        // tapping empty space deselects
        this._select(null);
      }
    }
  }

  _onMove(e) {
    if (this.sculpting) {
      this._setPointer(e);
      const hit = this.ray.intersectObject(this.clayMesh, false)[0];
      if (hit) this._applyBrush(hit);
      return;
    }
    if (this.dragging) {
      this._setPointer(e);
      const p = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.groundPlane, p)) {
        const m = this.dragging.mesh;
        let nx = p.x + this.dragging.offset.x;
        let nz = p.z + this.dragging.offset.z;
        const lim = PLATE_MM/2;
        nx = Math.max(-lim, Math.min(lim, nx));
        nz = Math.max(-lim, Math.min(lim, nz));
        m.position.x = nx; m.position.z = nz;
        this.selBox.setFromObject(m);
      }
    }
  }

  _onUp() {
    if (this.sculpting) {
      this.sculpting = false;
      this.controls.enabled = true;
      this.clayMesh.geometry.computeVertexNormals();
      this.onChange('sculpt');
      return;
    }
    if (this.dragging) {
      const m = this.dragging.mesh;
      this._snap(m);
      this.selBox.setFromObject(m);
      this.dragging = null;
      this.controls.enabled = true;
      this.onChange('move');
    }
  }

  // Snap the moved shape's bottom onto the plate, or onto the top of the
  // shape it is resting over.
  _snap(mesh) {
    const half = this._halfH(mesh);
    let bottom = 0;
    let bestTop = 0;
    for (const other of this.shapesGroup.children) {
      if (other === mesh) continue;
      // does mesh centre sit over other's footprint?
      const ob = new THREE.Box3().setFromObject(other);
      if (mesh.position.x >= ob.min.x && mesh.position.x <= ob.max.x &&
          mesh.position.z >= ob.min.z && mesh.position.z <= ob.max.z) {
        bestTop = Math.max(bestTop, ob.max.y);
      }
    }
    bottom = bestTop;
    mesh.position.y = bottom + half;
  }

  /* ---------------- sculpt brush ---------------- */
  _applyBrush(hit) {
    const geo = this.clayMesh.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const inv = new THREE.Matrix4().copy(this.clayMesh.matrixWorld).invert();
    const localPoint = hit.point.clone().applyMatrix4(inv);
    const r = this.sculpt.size;
    const r2 = r * r;
    const strength = this.sculpt.strength * (r * 0.12);
    const brush = this.sculpt.brush;

    const v = new THREE.Vector3();
    const n = new THREE.Vector3();

    if (brush === 'smooth') {
      // move each nearby vertex toward the average of nearby vertices
      const near = [];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (v.distanceToSquared(localPoint) <= r2) near.push(i);
      }
      if (near.length > 2) {
        const c = new THREE.Vector3();
        for (const i of near) { v.fromBufferAttribute(pos, i); c.add(v); }
        c.multiplyScalar(1 / near.length);
        for (const i of near) {
          v.fromBufferAttribute(pos, i);
          const d2 = v.distanceToSquared(localPoint);
          const f = falloff(d2, r2) * 0.5;
          v.lerp(c, f);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
      }
    } else {
      const sign = brush === 'push' ? -1 : 1;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const d2 = v.distanceToSquared(localPoint);
        if (d2 > r2) continue;
        n.fromBufferAttribute(nor, i);
        const f = falloff(d2, r2) * strength * sign;
        v.addScaledVector(n, f);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  /* ---------------- make clay (CSG) ---------------- */
  makeClay() {
    if (this.isClay) return { ok: false, error: 'It is already clay.' };
    const solids = this.shapesGroup.children.filter((m) => !m.userData.isHole);
    const holes = this.shapesGroup.children.filter((m) => m.userData.isHole);
    if (solids.length === 0) return { ok: false, error: 'Add a solid shape first (holes cannot stand alone).' };

    try {
      const ev = new Evaluator();
      ev.useGroups = false;
      ev.attributes = ['position', 'normal']; // only carry what every shape has
      const toBrush = (m) => {
        const g = m.geometry.clone();
        const b = new Brush(g);
        b.position.copy(m.position); b.rotation.copy(m.rotation); b.scale.copy(m.scale);
        b.updateMatrixWorld(true);
        return b;
      };
      let result = toBrush(solids[0]);
      for (let i = 1; i < solids.length; i++) result = ev.evaluate(result, toBrush(solids[i]), ADDITION);
      for (const h of holes) result = ev.evaluate(result, toBrush(h), SUBTRACTION);

      let geo = result.geometry;
      geo = geo.index ? geo : mergeVertices(geo);
      geo = mergeVertices(geo);            // weld so brushes move shared verts
      // Extra triangles make sculpting smoother. Skip that step when it
      // creates edges shared by more than two faces, or new gaps. Those
      // tiny edges are not repaired here; they are simply not added.
      geo = this._densifyIfSafe(geo);
      geo.computeVertexNormals();
      geo.computeBoundingBox();

      // remove blocks, add clay
      for (const m of [...this.shapesGroup.children]) { this.shapesGroup.remove(m); m.geometry.dispose(); }
      if (this.clayMesh) { this.scene.remove(this.clayMesh); this.clayMesh.geometry.dispose(); }
      const mat = new THREE.MeshStandardMaterial({ color: KIND_COLORS.clay, roughness: 0.85, metalness: 0 });
      this.clayMesh = new THREE.Mesh(geo, mat);
      this.clayMesh.updateMatrixWorld(true);
      this.scene.add(this.clayMesh);
      this.isClay = true;
      this._select(null);
      this.onChange('clay');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'Could not join the shapes. Try moving them so they touch or overlap.' };
    }
  }

  // Add triangles for sculpting, one step at a time. Stop before a step
  // that makes more edges shared by three faces, or a new gap.
  _densifyIfSafe(geo) {
    let current = geo;
    let skin = analyzeSurface(current);
    for (let guard = 0; guard < 3 && triCount(current) < 3500; guard++) {
      const next = mergeVertices(subdivide(current));
      const nextSkin = analyzeSurface(next);
      if (nextSkin.nonManifold > skin.nonManifold || nextSkin.gaps > skin.gaps) break;
      current = next;
      skin = nextSkin;
    }
    return current;
  }

  // Split triangles into 4 until we have enough detail to sculpt smoothly.
  _densify(geo) {
    let g = geo;
    let guard = 0;
    while (triCount(g) < 3500 && guard < 3) { g = subdivide(g); guard++; }
    return mergeVertices(g);
  }

  /* ---------------- fixes ---------------- */
  dropToPlate({ silent = false } = {}) {
    if (this.isClay && this.clayMesh) {
      this.clayMesh.geometry.computeBoundingBox();
      const minY = this.clayMesh.geometry.boundingBox.min.y + this.clayMesh.position.y;
      this.clayMesh.position.y -= minY;
    } else {
      // put every shape's stack bottom on the plate
      let minB = Infinity;
      for (const m of this.shapesGroup.children) minB = Math.min(minB, this._bottomOf(m));
      if (minB !== Infinity) for (const m of this.shapesGroup.children) m.position.y -= minB;
    }
    if (!silent) this.onChange('drop');
  }

  shrinkToFit() {
    const geo = this.getExportGeometry();
    if (!geo) return;
    geo.computeBoundingBox();
    const size = new THREE.Vector3(); geo.boundingBox.getSize(size);
    const s = Math.min(PLATE_MM / size.x, PLATE_MM / size.z, 260 / size.y, 1) * 0.98;
    if (s >= 1) return;
    if (this.isClay && this.clayMesh) {
      this.clayMesh.geometry.scale(s, s, s);
    } else {
      for (const m of this.shapesGroup.children) {
        const sz = m.userData.size;
        m.userData.size = { x: sz.x*s, y: sz.y*s, z: sz.z*s };
        m.geometry.dispose();
        m.geometry = this._makeGeometry(m.userData.kind, m.userData.size);
        m.position.multiplyScalar(s);
      }
    }
    this.dropToPlate({ silent: true });
    this.onChange('shrink');
  }

  /* ---------------- export geometry (world, mm) ---------------- */
  getExportGeometry() {
    if (this.isClay && this.clayMesh) {
      const g = this.clayMesh.geometry.clone();
      g.applyMatrix4(this.clayMesh.matrixWorld);
      return g;
    }
    const geos = [];
    for (const m of this.shapesGroup.children) {
      if (m.userData.isHole) continue;
      m.updateMatrixWorld(true);
      const g = m.geometry.clone();
      g.deleteAttribute('uv');
      g.applyMatrix4(m.matrixWorld);
      geos.push(g);
    }
    if (geos.length === 0) return null;
    return mergeGeometries(geos, false) || geos[0];
  }

  /* ---------------- thumbnail ---------------- */
  thumbnail(size = 160) {
    this.renderer.render(this.scene, this.camera);
    try {
      const full = this.renderer.domElement;
      const out = document.createElement('canvas');
      out.width = size; out.height = Math.round(size * 0.75);
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#eef1f5'; ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(full, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    } catch (_) { return ''; }
  }

  /* ---------------- save / load ---------------- */
  serialize() {
    if (this.isClay && this.clayMesh) {
      const g = this.clayMesh.geometry;
      const pos = Array.from(g.attributes.position.array, (n) => Math.round(n * 100) / 100);
      const idx = g.index ? Array.from(g.index.array) : null;
      return { mode: 'clay', clay: { position: pos, index: idx, color: this.clayMesh.material.color.getHex(), y: this.clayMesh.position.y } };
    }
    return {
      mode: 'blocks',
      shapes: this.shapesGroup.children.map((m) => ({
        id: m.userData.id, kind: m.userData.kind, size: { ...m.userData.size },
        pos: { x: m.position.x, y: m.position.y, z: m.position.z },
        isHole: !!m.userData.isHole,
      })),
    };
  }

  load(project) {
    this.reset();
    if (!project) return;
    if (project.mode === 'clay' && project.clay) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(project.clay.position, 3));
      if (project.clay.index) g.setIndex(project.clay.index);
      g.computeVertexNormals(); g.computeBoundingBox();
      const mat = new THREE.MeshStandardMaterial({ color: project.clay.color ?? KIND_COLORS.clay, roughness: 0.85 });
      this.clayMesh = new THREE.Mesh(g, mat);
      this.clayMesh.position.y = project.clay.y || 0;
      this.scene.add(this.clayMesh);
      this.isClay = true;
    } else if (project.shapes) {
      for (const sh of project.shapes) {
        const geo = this._makeGeometry(sh.kind, sh.size);
        const mat = new THREE.MeshStandardMaterial({ color: KIND_COLORS[sh.kind] || 0x8899aa, roughness: 0.55 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { id: sh.id || nextId(), kind: sh.kind, size: { ...sh.size }, isHole: !!sh.isHole };
        mesh.position.set(sh.pos.x, sh.pos.y, sh.pos.z);
        if (sh.isHole) { mat.transparent = true; mat.opacity = 0.4; mat.wireframe = true; mat.color.set(0x8a8f98); }
        this.shapesGroup.add(mesh);
      }
    }
    this._select(null);
  }

  reset() {
    for (const m of [...this.shapesGroup.children]) { this.shapesGroup.remove(m); m.geometry.dispose(); }
    if (this.clayMesh) { this.scene.remove(this.clayMesh); this.clayMesh.geometry.dispose(); this.clayMesh = null; }
    this.isClay = false;
    this._select(null);
  }

  // Import an external mesh (scan). mode: 'solid' | 'negative' (both handled by caller)
  importMesh(geometry, { asHole = false } = {}) {
    // normalise: sit on plate, centre on origin
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    geometry.translate(-cx, -bb.min.y, -cz);
    geometry.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: asHole ? 0x8a8f98 : 0x8bd0c9, roughness: 0.6, transparent: asHole, opacity: asHole ? 0.4 : 1, wireframe: asHole });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.userData = { id: nextId(), kind: 'box', size: sizeFromBox(geometry), isHole: asHole, imported: true };
    this.shapesGroup.add(mesh);
    this._select(mesh);
    this.onChange('import');
  }
}

/* ---------------- helpers ---------------- */
function clampMM(v) { return Math.max(2, Math.min(300, Number(v) || 2)); }
function falloff(d2, r2) { const t = 1 - d2 / r2; return t * t; } // smooth 0..1
function triCount(g) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }
function sizeFromBox(g) {
  g.computeBoundingBox(); const s = new THREE.Vector3(); g.boundingBox.getSize(s);
  return { x: s.x, y: s.y, z: s.z };
}

// Midpoint subdivision: each triangle -> 4. Operates on non-indexed, welds after.
function subdivide(geo) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const p = src.attributes.position.array;
  const out = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const AB = new THREE.Vector3(), BC = new THREE.Vector3(), CA = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    A.set(p[i], p[i+1], p[i+2]);
    B.set(p[i+3], p[i+4], p[i+5]);
    C.set(p[i+6], p[i+7], p[i+8]);
    AB.addVectors(A, B).multiplyScalar(0.5);
    BC.addVectors(B, C).multiplyScalar(0.5);
    CA.addVectors(C, A).multiplyScalar(0.5);
    push(out, A, AB, CA);
    push(out, AB, B, BC);
    push(out, CA, BC, C);
    push(out, AB, BC, CA);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}
function push(arr, a, b, c) { arr.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z); }
