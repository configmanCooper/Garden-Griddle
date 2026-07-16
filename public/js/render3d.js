import * as THREE from './vendor/three.module.js';

const C = window.GG.Constants;
const B = window.GG.Balance;
const CAMERA_HEIGHT = 19.8;

function material(color, options) {
  return new THREE.MeshLambertMaterial(Object.assign({ color }, options || {}));
}

function mesh(geometry, color, options) {
  return new THREE.Mesh(geometry, material(color, options));
}

class ParticlePool {
  constructor(scene, capacity) {
    this.capacity = capacity;
    this.cursor = 0;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    for (let index = 0; index < capacity; index += 1) this.positions[index * 3 + 1] = -100;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);
  }

  spawn(position, colorValue, count, mode) {
    const color = new THREE.Color(colorValue);
    for (let n = 0; n < count; n += 1) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const base = index * 3;
      this.positions[base] = position.x + (Math.random() - 0.5) * 0.35;
      this.positions[base + 1] = position.y + Math.random() * 0.25;
      this.positions[base + 2] = position.z + (Math.random() - 0.5) * 0.35;
      this.colors[base] = color.r;
      this.colors[base + 1] = color.g;
      this.colors[base + 2] = color.b;
      const outward = mode === 'water' ? 0.35 : 0.8;
      this.velocities[base] = (Math.random() - 0.5) * outward;
      this.velocities[base + 1] = mode === 'water' ? -0.8 - Math.random() * 0.7 : 0.45 + Math.random() * 0.9;
      this.velocities[base + 2] = (Math.random() - 0.5) * outward;
      this.life[index] = 0.55 + Math.random() * 0.65;
      this.gravity[index] = mode === 'steam' ? -0.18 : 1.25;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  update(dt) {
    let changed = false;
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.life[index] <= 0) continue;
      const base = index * 3;
      this.life[index] -= dt;
      if (this.life[index] <= 0) {
        this.positions[base + 1] = -100;
      } else {
        this.velocities[base + 1] -= this.gravity[index] * dt;
        this.positions[base] += this.velocities[base] * dt;
        this.positions[base + 1] += this.velocities[base + 1] * dt;
        this.positions[base + 2] += this.velocities[base + 2] * dt;
      }
      changed = true;
    }
    if (changed) this.points.geometry.attributes.position.needsUpdate = true;
  }
}

export class Render3D {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WEBGL2_UNAVAILABLE');
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xb7d69c);
    this.camera = new THREE.OrthographicCamera(-16, 16, 9, -9, 0.1, 100);
    this.camera.position.set(22, CAMERA_HEIGHT, 22);
    this.camera.lookAt(0, 0, 0);
    this.cameraZoom = 1;
    this.cameraPan = new THREE.Vector3(0, 0, 0);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.interactive = [];
    this.targets = new Map();
    this.plotViews = new Map();
    this.stoveViews = new Map();
    this.customerViews = [];
    this.playerViews = new Map();
    this.lastSnapshot = null;
    this.lowEffects = false;
    this.reducedMotion = false;
    this.lowFpsSince = 0;
    this.highFpsSince = 0;
    this.fpsSamples = [];
    this.lastFrameAt = performance.now();
    this._build();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _build() {
    this.scene.add(new THREE.HemisphereLight(0xfff2d2, 0x5b774e, 1.35));
    const sun = new THREE.DirectionalLight(0xffd59a, 1.1);
    sun.position.set(-10, 20, 12);
    this.scene.add(sun);

    const ground = mesh(new THREE.PlaneGeometry(42, 25), 0x94bf79);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    this.scene.add(ground);

    const path = mesh(new THREE.PlaneGeometry(9, 22), 0xd9c39b);
    path.rotation.x = -Math.PI / 2;
    path.position.set(-1, 0, 0);
    this.scene.add(path);

    this._buildGarden();
    this._buildKitchen();
    this._buildCustomers();
    this._buildPlayers();
    this._buildEffects();
  }

  _target(meshObject, target) {
    meshObject.userData.target = target;
    this.interactive.push(meshObject);
    this.targets.set(target.type + ':' + target.id, meshObject);
    if (meshObject.geometry && meshObject.parent) {
      meshObject.geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      meshObject.geometry.boundingBox.getSize(size);
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(
          Math.max(1.2, size.x * 1.45),
          Math.max(1.1, size.y * 1.45),
          Math.max(1.2, size.z * 1.45)
        ),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
      );
      proxy.position.copy(meshObject.position);
      proxy.rotation.copy(meshObject.rotation);
      proxy.userData.target = target;
      proxy.visible = false;
      meshObject.parent.add(proxy);
      this.interactive.push(proxy);
    }
  }

  _buildGarden() {
    for (let index = 0; index < B.PLOT_COUNT; index += 1) {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const group = new THREE.Group();
      group.position.set(-12 + column * 3.2, 0, -3.9 + row * 2.6);
      const bed = mesh(new THREE.BoxGeometry(2.7, 0.42, 2.05), 0x9b603b);
      bed.position.y = 0.2;
      group.add(bed);
      const soil = mesh(new THREE.BoxGeometry(2.35, 0.18, 1.7), 0x5a3926);
      soil.position.y = 0.48;
      group.add(soil);
      const crop = this._makeCrop();
      crop.position.y = 0.56;
      group.add(crop);
      this._target(soil, { type: 'plot', id: 'plot-' + (index + 1) });
      this.plotViews.set('plot-' + (index + 1), { group, crop, soil });
      this.scene.add(group);
    }

    const pail = new THREE.Group();
    const bucket = mesh(new THREE.CylinderGeometry(0.52, 0.4, 0.7, 16, 1, true), 0x6d9fc1, { side: THREE.DoubleSide });
    bucket.position.y = 0.38;
    pail.add(bucket);
    const handle = mesh(new THREE.TorusGeometry(0.46, 0.05, 8, 20, Math.PI), 0xd8e8ef);
    handle.rotation.z = Math.PI;
    handle.position.y = 0.72;
    pail.add(handle);
    pail.position.set(-4.3, 0, 4.7);
    this._target(bucket, { type: 'pail', id: 'pail' });
    pail.userData.bucket = bucket;
    this.targets.set('pail-group', pail);
    this.scene.add(pail);

    const cow = new THREE.Group();
    const body = mesh(new THREE.BoxGeometry(2.1, 1.25, 1.05), 0xf5eee0);
    body.position.y = 1.15;
    cow.add(body);
    const head = mesh(new THREE.BoxGeometry(0.85, 0.85, 0.8), 0xf5eee0);
    head.position.set(1.25, 1.3, 0);
    cow.add(head);
    for (const z of [-0.35, 0.35]) for (const x of [-0.65, 0.65]) {
      const leg = mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.85, 8), 0x6e4a35);
      leg.position.set(x, 0.45, z);
      cow.add(leg);
    }
    const milkBadge = mesh(new THREE.SphereGeometry(0.18, 12, 8), 0xeaf7ff);
    milkBadge.position.set(1.25, 2.15, 0);
    cow.add(milkBadge);
    cow.userData.milkBadge = milkBadge;
    cow.position.set(-10.5, 0, 6.1);
    this._target(body, { type: 'cow', id: 'cow' });
    this.targets.set('cow-group', cow);
    this.scene.add(cow);
  }

  _makeCrop() {
    const group = new THREE.Group();
    const stemMat = material(0x4e8a49);
    const leafMat = material(0x6ca75a);
    const fruitMat = material(0xe34c5b);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.3, 8), stemMat);
    stem.position.y = 0.65;
    group.add(stem);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), leafMat);
    leaf.scale.set(1.5, 0.55, 1.25);
    leaf.position.y = 0.72;
    group.add(leaf);
    const fruit = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), fruitMat);
    fruit.scale.set(1.15, 0.85, 1.15);
    fruit.position.y = 1.08;
    group.add(fruit);
    const leaves = [leaf];
    const fruits = [fruit];
    group.userData = { stem, leaves, fruits, stemMat, leafMat, fruitMat };
    group.visible = false;
    return group;
  }

  _buildKitchen() {
    const floor = mesh(new THREE.BoxGeometry(13.5, 0.28, 12), 0xf0d6a6);
    floor.position.set(6, 0.1, 0);
    this.scene.add(floor);

    const backWall = mesh(new THREE.BoxGeometry(13.5, 2.9, 0.3), 0xfff0d4);
    backWall.position.set(6, 1.45, -6);
    this.scene.add(backWall);

    const fridge = mesh(new THREE.BoxGeometry(2.1, 3.8, 1.8), 0xdbeaf0);
    fridge.position.set(1.2, 1.95, -4.8);
    this.scene.add(fridge);

    const sink = mesh(new THREE.CylinderGeometry(0.82, 0.62, 0.55, 20), 0x9eb6bf);
    sink.position.set(1.3, 1.15, 3.8);
    this._target(sink, { type: 'sink', id: 'sink' });
    this.scene.add(sink);

    const mixerGroup = new THREE.Group();
    const counter = mesh(new THREE.BoxGeometry(3, 1.4, 2.2), 0x9b603b);
    counter.position.y = 0.7;
    mixerGroup.add(counter);
    const bowl = mesh(new THREE.SphereGeometry(0.72, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xdfe8ec, { side: THREE.DoubleSide });
    bowl.rotation.x = Math.PI;
    bowl.position.y = 1.55;
    mixerGroup.add(bowl);
    mixerGroup.position.set(4.2, 0, -4.6);
    this._target(bowl, { type: 'mixer', id: 'mixer' });
    this.targets.set('mixer-group', mixerGroup);
    this.scene.add(mixerGroup);

    const toppingAtlas = this._makeToppingAtlas();
    for (let index = 0; index < B.STOVE_COUNT; index += 1) {
      const group = new THREE.Group();
      const base = mesh(new THREE.BoxGeometry(2.4, 1.35, 2.1), 0x6f5848);
      base.position.y = 0.68;
      group.add(base);
      const top = mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.15, 24), 0x27272a);
      top.position.y = 1.43;
      group.add(top);
      const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x555555 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.08, 8, 24), ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.53;
      group.add(ring);
      const crepe = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 24), 0xe0a75f);
      const toppingTexture = toppingAtlas.clone();
      toppingTexture.needsUpdate = true;
      toppingTexture.repeat.set(1 / C.RECIPES.length, 1);
      crepe.material.map = toppingTexture;
      crepe.material.color.setHex(0xffffff);
      crepe.position.y = 1.57;
      crepe.visible = false;
      group.add(crepe);
      group.position.set(7.2, 0, -3.6 + index * 3.6);
      this._target(top, { type: 'stove', id: 'stove-' + (index + 1) });
      this.stoveViews.set('stove-' + (index + 1), { group, ring, crepe, toppingTexture });
      this.scene.add(group);
    }

    const service = mesh(new THREE.BoxGeometry(2.1, 1.5, 11), 0xb87643);
    service.position.set(11.6, 0.75, 0);
    this.scene.add(service);
    for (let z = -4.2; z <= 2.8; z += 2.8) {
      const stool = mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.75, 14), 0x6d4a35);
      stool.position.set(13.2, 0.38, z);
      this.scene.add(stool);
    }
  }

  _buildCustomers() {
    const colors = [0xcc5a61, 0x5d88be, 0xd59a48, 0x6b9c65, 0x9670af, 0x4f9c98, 0xd66e9b, 0x8d7359];
    for (let index = 0; index < 8; index += 1) {
      const group = new THREE.Group();
      const body = mesh(new THREE.CylinderGeometry(0.35, 0.46, 1.05, 12), colors[index]);
      body.position.y = 0.85;
      group.add(body);
      const head = mesh(new THREE.SphereGeometry(0.34, 14, 10), 0xf1c9a3);
      head.position.y = 1.58;
      group.add(head);
      group.position.set(13.3, 0, -4.3 + index * 1.25);
      group.visible = false;
      this.customerViews.push(group);
      this.scene.add(group);
    }
  }

  _buildPlayers() {
    const configs = [
      { color: 0xe45b5b, x: -2.5, z: -1 },
      { color: 0x4f91d9, x: -2.5, z: 1 }
    ];
    configs.forEach((config, index) => {
      const group = new THREE.Group();
      const body = mesh(new THREE.CylinderGeometry(0.38, 0.48, 1.15, 14), config.color);
      body.position.y = 0.85;
      group.add(body);
      const apron = mesh(new THREE.BoxGeometry(0.5, 0.65, 0.08), index === 0 ? 0xffe9d0 : 0xe7f3ff);
      apron.position.set(0, 0.84, 0.42);
      group.add(apron);
      const head = mesh(new THREE.SphereGeometry(0.35, 14, 10), 0xf1c9a3);
      head.position.y = 1.62;
      group.add(head);
      const hat = mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.34, 14), 0xfffbef);
      hat.position.y = 2;
      group.add(hat);
      group.position.set(config.x, 0, config.z);
      group.userData.targetPosition = group.position.clone();
      this.playerViews.set(index, group);
      this.scene.add(group);
    });
  }

  _makeToppingAtlas() {
    const width = 128 * C.RECIPES.length;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    const colors = { lemon: '#f0d34f', sugar: '#fff4d2', strawberry: '#df4055', blackberry: '#563a75', banana: '#efc94c' };
    C.RECIPES.forEach((recipe, index) => {
      const left = index * 128;
      context.fillStyle = '#e0a75f';
      context.fillRect(left, 0, 128, 128);
      const keys = Object.keys(recipe.toppings);
      keys.forEach((key, toppingIndex) => {
        const angle = toppingIndex / Math.max(1, keys.length) * Math.PI * 2 - Math.PI / 2;
        context.fillStyle = colors[key] || '#fff';
        context.beginPath();
        context.arc(left + 64 + Math.cos(angle) * 28, 64 + Math.sin(angle) * 28, key === 'sugar' ? 12 : 18, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = 'rgba(80,40,20,.35)';
        context.lineWidth = 3;
        context.stroke();
      });
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  _buildEffects() {
    this.particles = new ParticlePool(this.scene, 160);
    this.fxEvents = new Set();
    this.lastParticleAt = performance.now();

    this.contactShadows = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.6, 20),
      new THREE.MeshBasicMaterial({ color: 0x3d2c20, transparent: true, opacity: 0.18, depthWrite: false }),
      12
    );
    this.contactShadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.contactShadows.frustumCulled = false;
    this.contactShadows.renderOrder = 1;
    this.scene.add(this.contactShadows);

    this.patienceRings = new THREE.InstancedMesh(
      new THREE.TorusGeometry(0.5, 0.055, 6, 24),
      new THREE.MeshBasicMaterial({ vertexColors: true }),
      8
    );
    this.patienceRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.patienceRings.frustumCulled = false;
    this.scene.add(this.patienceRings);
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const vertical = 10.7 / this.cameraZoom;
    this.camera.left = -vertical * aspect;
    this.camera.right = vertical * aspect;
    this.camera.top = vertical;
    this.camera.bottom = -vertical;
    this.camera.updateProjectionMatrix();
  }

  panBy(dx, dy) {
    this.cameraPan.x = THREE.MathUtils.clamp(this.cameraPan.x - dx * 0.015 / this.cameraZoom, -4, 4);
    this.cameraPan.z = THREE.MathUtils.clamp(this.cameraPan.z - dy * 0.015 / this.cameraZoom, -3, 3);
  }

  zoomBy(amount) {
    this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom * amount, 0.85, 1.6);
    this.resize();
  }

  setReducedMotion(value) {
    this.reducedMotion = !!value;
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.interactive, false)[0];
    return hit ? hit.object.userData.target : null;
  }

  clientPointForTarget(type, id) {
    const object = type === 'plot' ? this.plotViews.get(id).soil
      : type === 'stove' ? this.targets.get('stove:' + id)
        : this.targets.get(type + ':' + id);
    if (!object) return null;
    this.scene.updateMatrixWorld(true);
    const position = new THREE.Vector3();
    object.getWorldPosition(position);
    position.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + (position.x + 1) * rect.width / 2,
      y: rect.top + (1 - position.y) * rect.height / 2
    };
  }

  update(snapshot, session) {
    this.lastSnapshot = snapshot;
    if (!snapshot) return;
    const cropColors = {
      flour: [0xd7b75b, 0x7ca650, 0xcba449],
      sugar: [0xa9d46b, 0x68a64c, 0xe2ead1],
      strawberry: [0x5e9b4e, 0x6fae58, 0xdf4055],
      blackberry: [0x547f45, 0x6b9d53, 0x4d315f],
      lemon: [0x4e8e45, 0x70a957, 0xf0d34f],
      banana: [0x4c8f48, 0x72ad5b, 0xefc94c]
    };
    for (const plot of snapshot.plots) {
      const view = this.plotViews.get(plot.id);
      const crop = view.crop;
      if (!plot.crop || plot.state === 'empty') {
        crop.visible = false;
        view.soil.material.color.setHex(0x5a3926);
        continue;
      }
      crop.visible = true;
      const colors = cropColors[plot.crop];
      crop.userData.stemMat.color.setHex(colors[0]);
      crop.userData.leafMat.color.setHex(colors[1]);
      crop.userData.fruitMat.color.setHex(colors[2]);
      let stage = plot.state === 'dry' ? 0.18 : plot.state === 'ripe' ? 1 : 0.35;
      if (plot.state === 'growing') {
        const total = C.CROPS[plot.crop].growSeconds * snapshot.effects.growthMultiplier;
        stage = THREE.MathUtils.clamp(1 - (plot.readyAt - snapshot.elapsed) / total, 0.24, 0.96);
      }
      crop.scale.setScalar(0.35 + stage * 0.72);
      crop.rotation.z = this.reducedMotion ? 0 : Math.sin(performance.now() * 0.0015 + Number(plot.id.split('-')[1])) * 0.035;
      crop.userData.fruits.forEach((fruit) => { fruit.visible = stage > 0.68; });
      view.soil.material.color.setHex(plot.state === 'dry' ? 0x76513a : 0x493526);
    }

    const cow = this.targets.get('cow-group');
    cow.userData.milkBadge.visible = snapshot.cow.milk > 0;
    cow.userData.milkBadge.position.y = 2.15 + (this.reducedMotion ? 0 : Math.sin(performance.now() * 0.005) * 0.08);

    const pail = this.targets.get('pail-group');
    const waterRatio = snapshot.pail.capacity ? snapshot.pail.water / snapshot.pail.capacity : 0;
    pail.userData.bucket.material.color.setRGB(0.43 - waterRatio * 0.12, 0.62 + waterRatio * 0.12, 0.76 + waterRatio * 0.16);
    if (snapshot.pail.holder && snapshot.players[snapshot.pail.holder]) {
      const holder = snapshot.players[snapshot.pail.holder];
      const avatar = this.playerViews.get(holder ? holder.seat : 0);
      pail.position.lerp(new THREE.Vector3(avatar.position.x + 0.65, 0.6, avatar.position.z), 0.28);
    } else {
      pail.position.lerp(new THREE.Vector3(-4.3, 0, 4.7), 0.18);
    }

    for (const stove of snapshot.stoves) {
      const view = this.stoveViews.get(stove.id);
      const colors = { empty: 0x555555, cooking: 0xe18435, ready: 0x4aa85a, serving: 0x66c878, burnt: 0xc43c35 };
      view.ring.material.color.setHex(colors[stove.state]);
      view.crepe.visible = stove.state !== 'empty';
      if (stove.state === 'ready') view.crepe.position.y = 1.62 + (this.reducedMotion ? 0 : Math.sin(performance.now() * 0.008) * 0.05);
      view.crepe.material.color.setHex(stove.state === 'burnt' ? 0x39251b : 0xffffff);
      const order = snapshot.orders.find((item) => item.id === stove.orderId);
      if (order) {
        const recipeIndex = Math.max(0, C.RECIPES.findIndex((recipe) => recipe.id === order.recipeId));
        view.toppingTexture.offset.set(recipeIndex / C.RECIPES.length, 0);
      }
    }

    const activeOrders = snapshot.orders.filter((order) => ['waiting', 'cooking', 'ready', 'serving', 'eating'].includes(order.status));
    this.customerViews.forEach((view, index) => {
      const order = activeOrders[index];
      view.visible = !!order;
      if (!order) {
        this._setInstance(this.patienceRings, index, new THREE.Vector3(0, -100, 0), 0);
        return;
      }
      const targetX = order.status === 'eating' ? 12.55 : 13.3;
      view.position.x += (targetX - view.position.x) * 0.08;
      view.rotation.y = order.status === 'eating' ? -Math.PI / 2 : Math.PI;
      view.scale.setScalar(order.status === 'eating' ? 1.06 : 1);
      const patience = Math.max(0, Math.min(1, (order.expiresAt - snapshot.elapsed) / Math.max(0.01, order.expiresAt - order.createdAt)));
      const ringScale = order.status === 'eating' ? 0 : 0.35 + patience * 0.65;
      this._setInstance(this.patienceRings, index, new THREE.Vector3(view.position.x, 0.05, view.position.z), ringScale);
      this.patienceRings.setColorAt(index, new THREE.Color(patience < 0.25 ? 0xc43c35 : patience < 0.5 ? 0xe5a43b : 0x4aa85a));
    });
    this.patienceRings.instanceMatrix.needsUpdate = true;
    if (this.patienceRings.instanceColor) this.patienceRings.instanceColor.needsUpdate = true;

    for (const avatar of this.playerViews.values()) avatar.visible = false;
    const playerEntries = Object.values(snapshot.players).sort((a, b) => a.seat - b.seat);
    playerEntries.forEach((player) => {
      const avatar = this.playerViews.get(player.seat);
      if (!avatar) return;
      avatar.visible = player.connected;
      const target = this._positionForAction(player.lastAction);
      if (target) avatar.userData.targetPosition.copy(target);
      avatar.position.lerp(avatar.userData.targetPosition, 0.1);
      avatar.position.y = this.reducedMotion ? 0 : Math.abs(Math.sin(performance.now() * 0.007 + player.seat)) * 0.025;
    });

    const mixer = this.targets.get('mixer-group');
    if (snapshot.mixer.state === 'mixing') mixer.rotation.y += 0.035;
    this._updateContactShadows(snapshot, playerEntries, activeOrders, pail, cow);
    this._consumeEffects(snapshot.events || []);
  }

  _setInstance(instancedMesh, index, position, scale) {
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const matrix = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(scale, scale, scale));
    instancedMesh.setMatrixAt(index, matrix);
  }

  _updateContactShadows(snapshot, playerEntries, activeOrders, pail, cow) {
    let index = 0;
    this._setInstance(this.contactShadows, index++, new THREE.Vector3(cow.position.x, 0.015, cow.position.z), 1.8);
    this._setInstance(this.contactShadows, index++, new THREE.Vector3(pail.position.x, 0.015, pail.position.z), 0.75);
    for (const player of playerEntries) {
      const avatar = this.playerViews.get(player.seat);
      this._setInstance(this.contactShadows, index++, new THREE.Vector3(avatar.position.x, 0.015, avatar.position.z), player.connected ? 0.9 : 0);
    }
    for (let customerIndex = 0; customerIndex < 8; customerIndex += 1) {
      const customer = this.customerViews[customerIndex];
      this._setInstance(this.contactShadows, index++, new THREE.Vector3(customer.position.x, 0.015, customer.position.z), activeOrders[customerIndex] ? 0.75 : 0);
    }
    this.contactShadows.count = index;
    this.contactShadows.instanceMatrix.needsUpdate = true;
  }

  _consumeEffects(events) {
    for (const event of events) {
      if (this.fxEvents.has(event.id)) continue;
      this.fxEvents.add(event.id);
      if (this.fxEvents.size > 220) this.fxEvents.delete(this.fxEvents.values().next().value);
      let position = null;
      let color = 0xffffff;
      let mode = 'spark';
      if (event.plotId && this.plotViews.has(event.plotId)) {
        position = this.plotViews.get(event.plotId).group.position.clone().add(new THREE.Vector3(0, 1, 0));
      } else if (event.stoveId && this.stoveViews.has(event.stoveId)) {
        position = this.stoveViews.get(event.stoveId).group.position.clone().add(new THREE.Vector3(0, 1.7, 0));
      } else if (event.type === 'milked' || event.type === 'milkReady') {
        position = this.targets.get('cow-group').position.clone().add(new THREE.Vector3(0.8, 1.6, 0));
      } else if (event.type === 'mixerStarted' || event.type === 'batterReady') {
        position = this.targets.get('mixer-group').position.clone().add(new THREE.Vector3(0, 1.7, 0));
      } else if (event.type === 'pailFilled') {
        const sink = this.targets.get('sink:sink');
        position = sink.position.clone().add(new THREE.Vector3(0, 0.8, 0));
      } else if (event.type === 'served' || event.type === 'customerPaid') {
        position = new THREE.Vector3(12.3, 1.4, 0);
      }
      if (!position) continue;
      if (event.type === 'watered' || event.type === 'pailFilled') { color = 0x62b9ef; mode = 'water'; }
      else if (event.type === 'mixerStarted') { color = 0xfff0cf; mode = 'steam'; }
      else if (event.type === 'crepeReady') { color = 0xf5e4bd; mode = 'steam'; }
      else if (event.type === 'customerPaid' || event.type === 'served') color = 0xffcf45;
      else if (event.type === 'harvested' || event.type === 'cropReady') color = 0x85d46c;
      else if (event.type === 'milked' || event.type === 'milkReady') color = 0xeaf7ff;
      const count = this.reducedMotion ? 0 : this.lowEffects ? 4 : 9;
      if (count) this.particles.spawn(position, color, count, mode);
    }
  }

  _positionForAction(lastAction) {
    if (!lastAction) return null;
    const id = lastAction.targetId;
    if (id && this.plotViews.has(id)) return this.plotViews.get(id).group.position.clone().add(new THREE.Vector3(1.6, 0, 0));
    if (id && this.stoveViews.has(id)) return this.stoveViews.get(id).group.position.clone().add(new THREE.Vector3(-1.4, 0, 0));
    if (lastAction.kind === 'milk') return new THREE.Vector3(-9, 0, 6);
    if (lastAction.kind === 'fillPail') return new THREE.Vector3(0.2, 0, 3.8);
    if (lastAction.kind === 'mixBatter') return new THREE.Vector3(3.1, 0, -4.1);
    if (lastAction.kind === 'pickupPail' || lastAction.kind === 'dropPail') return new THREE.Vector3(-4.5, 0, 4);
    return null;
  }

  render(time) {
    const target = new THREE.Vector3(this.cameraPan.x, 0, this.cameraPan.z);
    this.camera.position.set(22 + target.x, CAMERA_HEIGHT, 22 + target.z);
    this.camera.lookAt(target);
    const t = this.lastSnapshot ? this.lastSnapshot.elapsed / Math.max(1, this.lastSnapshot.level.daySeconds) : 0;
    this.scene.background.setRGB(0.72 - t * 0.08, 0.84 - t * 0.06, 0.61 + t * 0.03);
    this.renderer.render(this.scene, this.camera);
    const now = time || performance.now();
    const particleDt = Math.min(0.05, Math.max(0, (now - this.lastParticleAt) / 1000));
    this.lastParticleAt = now;
    this.particles.update(particleDt);
    const fps = 1000 / Math.max(1, now - this.lastFrameAt);
    this.lastFrameAt = now;
    this.fpsSamples.push(fps);
    if (this.fpsSamples.length > 180) this.fpsSamples.shift();
    if (fps < 30) {
      if (!this.lowFpsSince) this.lowFpsSince = now;
      if (!this.lowEffects && now - this.lowFpsSince >= 3000) {
        this.lowEffects = true;
        this.contactShadows.visible = false;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.resize();
      }
      this.highFpsSince = 0;
    } else {
      this.lowFpsSince = 0;
      if (this.lowEffects && fps > 50) {
        if (!this.highFpsSince) this.highFpsSince = now;
        if (now - this.highFpsSince >= 10000) {
          this.lowEffects = false;
          this.contactShadows.visible = true;
          this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
          this.resize();
          this.highFpsSince = 0;
        }
      } else {
        this.highFpsSince = 0;
      }
    }
  }

  metrics() {
    const averageFps = this.fpsSamples.length ? this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length : 0;
    return {
      fps: averageFps,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      textures: this.renderer.info.memory.textures,
      geometries: this.renderer.info.memory.geometries
    };
  }
}
