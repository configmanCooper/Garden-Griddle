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

function addContactShadow(group, radius) {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 24),
    new THREE.MeshBasicMaterial({ color: 0x3d2c20, transparent: true, opacity: 0.18, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  group.add(shadow);
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
    this.lowFpsSince = 0;
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
    const gardenSign = mesh(new THREE.BoxGeometry(5.8, 0.8, 0.35), 0x8b5a32);
    gardenSign.position.set(-9, 0.7, -6);
    this.scene.add(gardenSign);
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
    const patch = mesh(new THREE.CircleGeometry(0.34, 16), 0x4c362b);
    patch.position.set(0, 1.35, 0.531);
    cow.add(patch);
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
      crepe.position.y = 1.57;
      crepe.visible = false;
      group.add(crepe);
      group.position.set(7.2, 0, -3.6 + index * 3.6);
      this._target(top, { type: 'stove', id: 'stove-' + (index + 1) });
      this.stoveViews.set('stove-' + (index + 1), { group, ring, crepe });
      this.scene.add(group);
    }

    const service = mesh(new THREE.BoxGeometry(2.1, 1.5, 11), 0xb87643);
    service.position.set(11.6, 0.75, 0);
    this.scene.add(service);
    for (let z = -4.2; z <= 4.2; z += 2.8) {
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
      crop.rotation.z = Math.sin(performance.now() * 0.0015 + Number(plot.id.split('-')[1])) * 0.035;
      crop.userData.fruits.forEach((fruit) => { fruit.visible = stage > 0.68; });
      view.soil.material.color.setHex(plot.state === 'dry' ? 0x76513a : 0x493526);
    }

    const cow = this.targets.get('cow-group');
    cow.userData.milkBadge.visible = snapshot.cow.milk > 0;
    cow.userData.milkBadge.position.y = 2.15 + Math.sin(performance.now() * 0.005) * 0.08;

    const pail = this.targets.get('pail-group');
    if (snapshot.pail.holder && snapshot.players[snapshot.pail.holder]) {
      const holder = snapshot.players[snapshot.pail.holder];
      const avatar = this.playerViews.get(holder ? holder.seat : 0);
      pail.position.lerp(new THREE.Vector3(avatar.position.x + 0.65, 0.6, avatar.position.z), 0.28);
    } else {
      pail.position.lerp(new THREE.Vector3(-4.3, 0, 4.7), 0.18);
    }

    for (const stove of snapshot.stoves) {
      const view = this.stoveViews.get(stove.id);
      const colors = { empty: 0x555555, cooking: 0xe18435, ready: 0x4aa85a, burnt: 0xc43c35 };
      view.ring.material.color.setHex(colors[stove.state]);
      view.crepe.visible = stove.state !== 'empty';
      if (stove.state === 'ready') view.crepe.position.y = 1.62 + Math.sin(performance.now() * 0.008) * 0.05;
      view.crepe.material.color.setHex(stove.state === 'burnt' ? 0x39251b : 0xe0a75f);
    }

    const activeOrders = snapshot.orders.filter((order) => ['waiting', 'cooking', 'ready', 'serving', 'eating'].includes(order.status));
    this.customerViews.forEach((view, index) => {
      const order = activeOrders[index];
      view.visible = !!order;
      if (!order) return;
      const targetX = order.status === 'eating' ? 12.55 : 13.3;
      view.position.x += (targetX - view.position.x) * 0.08;
      view.rotation.y = order.status === 'eating' ? -Math.PI / 2 : Math.PI;
    });

    for (const avatar of this.playerViews.values()) avatar.visible = false;
    const playerEntries = Object.values(snapshot.players).sort((a, b) => a.seat - b.seat);
    playerEntries.forEach((player) => {
      const avatar = this.playerViews.get(player.seat);
      if (!avatar) return;
      avatar.visible = player.connected;
      const target = this._positionForAction(player.lastAction);
      if (target) avatar.userData.targetPosition.copy(target);
      avatar.position.lerp(avatar.userData.targetPosition, 0.1);
      avatar.position.y = Math.abs(Math.sin(performance.now() * 0.007 + player.seat)) * 0.025;
    });

    const mixer = this.targets.get('mixer-group');
    if (snapshot.mixer.state === 'mixing') mixer.rotation.y += 0.035;
  }

  _positionForAction(lastAction) {
    if (!lastAction) return null;
    const id = lastAction.targetId;
    if (id && this.plotViews.has(id)) return this.plotViews.get(id).group.position.clone().add(new THREE.Vector3(1.6, 0, 0));
    if (id && this.stoveViews.has(id)) return this.stoveViews.get(id).group.position.clone().add(new THREE.Vector3(-1.4, 0, 0));
    if (lastAction.kind === 'milk') return new THREE.Vector3(-9, 0, 6);
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
    const fps = 1000 / Math.max(1, now - this.lastFrameAt);
    this.lastFrameAt = now;
    this.fpsSamples.push(fps);
    if (this.fpsSamples.length > 180) this.fpsSamples.shift();
    if (fps < 30) {
      if (!this.lowFpsSince) this.lowFpsSince = now;
      if (!this.lowEffects && now - this.lowFpsSince >= 3000) {
        this.lowEffects = true;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.resize();
      }
    } else {
      this.lowFpsSince = 0;
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
