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

function makeCanvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  draw(context, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
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
    this.cameraZoom = this._phoneViewZoom();
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

    this.grassTexture = this._makeGrassTexture();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(42, 25),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: this.grassTexture })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    this.scene.add(ground);

    this.porchTexture = this._makePorchTexture();
    const porch = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 13.5),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: this.porchTexture })
    );
    porch.rotation.x = -Math.PI / 2;
    porch.position.set(-2.95, 0.02, 0);
    this.scene.add(porch);

    this._buildGarden();
    this._buildKitchen();
    this._buildCustomers();
    this._buildPlayers();
    this._buildEffects();
  }

  _makeGrassTexture() {
    const texture = makeCanvasTexture(512, 512, (context, width, height) => {
      context.fillStyle = '#769949';
      context.fillRect(0, 0, width, height);
      for (let patch = 0; patch < 55; patch += 1) {
        const x = (patch * 97 + 31) % width;
        const y = (patch * 173 + 19) % height;
        const radius = 18 + (patch * 13) % 42;
        context.fillStyle = patch % 2 ? 'rgba(164,190,91,.13)' : 'rgba(55,111,49,.12)';
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
      context.lineCap = 'round';
      for (let blade = 0; blade < 190; blade += 1) {
        const x = (blade * 73 + 11) % width;
        const y = (blade * 151 + 47) % height;
        const lean = ((blade * 29) % 9) - 4;
        const heightValue = 5 + (blade * 17) % 9;
        context.strokeStyle = blade % 3 === 0 ? 'rgba(198,218,116,.52)' : 'rgba(48,105,43,.48)';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x, y);
        context.quadraticCurveTo(x + lean * 0.4, y - heightValue * 0.55, x + lean, y - heightValue);
        context.stroke();
      }
      for (let clover = 0; clover < 22; clover += 1) {
        const x = (clover * 137 + 67) % width;
        const y = (clover * 83 + 101) % height;
        context.fillStyle = 'rgba(102,150,57,.7)';
        for (let petal = 0; petal < 3; petal += 1) {
          const angle = petal / 3 * Math.PI * 2;
          context.beginPath();
          context.arc(x + Math.cos(angle) * 4, y + Math.sin(angle) * 4, 4, 0, Math.PI * 2);
          context.fill();
        }
        if (clover % 5 === 0) {
          context.fillStyle = 'rgba(255,239,177,.8)';
          context.beginPath();
          context.arc(x, y, 2.4, 0, Math.PI * 2);
          context.fill();
        }
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 5);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    return texture;
  }

  _makePorchTexture() {
    const texture = makeCanvasTexture(512, 512, (context, width, height) => {
      context.fillStyle = '#9b603b';
      context.fillRect(0, 0, width, height);
      const boardHeight = 64;
      for (let y = 0; y < height; y += boardHeight) {
        context.fillStyle = (y / boardHeight) % 2 ? '#a96b42' : '#8f5635';
        context.fillRect(0, y + 3, width, boardHeight - 6);
        context.strokeStyle = '#5d3827';
        context.lineWidth = 5;
        context.beginPath();
        context.moveTo(0, y + 1);
        context.lineTo(width, y + 1);
        context.stroke();
        for (let grain = 0; grain < 7; grain += 1) {
          const grainY = y + 13 + grain * 7;
          context.strokeStyle = grain % 2 ? 'rgba(255,196,122,.16)' : 'rgba(69,37,23,.18)';
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(0, grainY);
          for (let x = 0; x <= width; x += 48) {
            context.lineTo(x, grainY + Math.sin((x + y + grain * 17) * 0.035) * 3);
          }
          context.stroke();
        }
        for (const x of [18, width - 18]) {
          context.fillStyle = '#4d3023';
          context.beginPath();
          context.arc(x, y + boardHeight / 2, 3, 0, Math.PI * 2);
          context.fill();
        }
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.4, 4.5);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    return texture;
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
    this._buildCropAssets();
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
    const bucketBottom = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.075, 16), 0x587f99);
    bucketBottom.position.y = 0.07;
    pail.add(bucketBottom);
    const waterSurface = mesh(
      new THREE.CylinderGeometry(0.37, 0.37, 0.025, 18),
      0x59c5ed,
      { transparent: true, opacity: 0.82, depthWrite: false }
    );
    waterSurface.position.y = 0.13;
    waterSurface.visible = false;
    pail.add(waterSurface);
    const handle = mesh(new THREE.TorusGeometry(0.46, 0.05, 8, 20, Math.PI), 0xd8e8ef);
    handle.rotation.z = Math.PI;
    handle.position.y = 0.72;
    pail.add(handle);
    pail.position.set(-0.55, 0, 4.3);
    this._target(bucket, { type: 'pail', id: 'pail' });
    pail.userData = { bucket, bucketBottom, waterSurface };
    this.targets.set('pail-group', pail);
    this.scene.add(pail);

    const cow = new THREE.Group();
    const cowTexture = makeCanvasTexture(256, 128, (context, width, height) => {
      context.fillStyle = '#f4eee2';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#5a4033';
      for (const [x, y, rx, ry] of [[38, 28, 30, 21], [122, 80, 38, 25], [205, 35, 29, 28], [220, 105, 24, 16]]) {
        context.beginPath();
        context.ellipse(x, y, rx, ry, 0.35, 0, Math.PI * 2);
        context.fill();
      }
    });
    cowTexture.wrapS = THREE.RepeatWrapping;
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(1, 22, 14),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: cowTexture })
    );
    body.scale.set(1.45, 0.82, 0.72);
    body.position.y = 1.18;
    cow.add(body);
    const headPivot = new THREE.Group();
    headPivot.position.set(1.35, 1.42, 0);
    const head = mesh(new THREE.SphereGeometry(0.52, 18, 12), 0xf4eee2);
    head.scale.set(1, 1.08, 0.88);
    headPivot.add(head);
    const muzzle = mesh(new THREE.SphereGeometry(0.31, 16, 10), 0xd8a98f);
    muzzle.scale.set(0.85, 0.62, 1);
    muzzle.position.set(0.42, -0.12, 0);
    headPivot.add(muzzle);
    const eyes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 9, 6), material(0x17120f), 2);
    eyes.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0.43, 0.11, -0.2));
    eyes.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0.43, 0.11, 0.2));
    headPivot.add(eyes);
    cow.add(headPivot);
    const legs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.15, 0.9, 9), material(0x6e4a35), 4);
    [[-0.72, 0.45, -0.38], [-0.72, 0.45, 0.38], [0.72, 0.45, -0.38], [0.72, 0.45, 0.38]].forEach((position, index) => {
      legs.setMatrixAt(index, new THREE.Matrix4().makeTranslation(position[0], position[1], position[2]));
    });
    cow.add(legs);
    const ears = new THREE.InstancedMesh(new THREE.ConeGeometry(0.18, 0.42, 8), material(0x8a5b46), 2);
    const earMatrix = new THREE.Matrix4();
    ears.setMatrixAt(0, earMatrix.compose(new THREE.Vector3(0.05, 0.42, -0.35), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, -1.2)), new THREE.Vector3(1, 1, 1)));
    ears.setMatrixAt(1, earMatrix.compose(new THREE.Vector3(0.05, 0.42, 0.35), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0, -1.2)), new THREE.Vector3(1, 1, 1)));
    headPivot.add(ears);
    const horns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.09, 0.34, 8), material(0xd9c8a8), 2);
    horns.setMatrixAt(0, earMatrix.compose(new THREE.Vector3(-0.05, 0.48, -0.22), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, 0.2)), new THREE.Vector3(1, 1, 1)));
    horns.setMatrixAt(1, earMatrix.compose(new THREE.Vector3(-0.05, 0.48, 0.22), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0, 0.2)), new THREE.Vector3(1, 1, 1)));
    headPivot.add(horns);
    const udder = mesh(new THREE.SphereGeometry(0.3, 14, 9), 0xe4a5a7);
    udder.scale.set(1.15, 0.65, 0.9);
    udder.position.set(0.25, 0.5, 0);
    cow.add(udder);
    const tail = mesh(new THREE.ConeGeometry(0.12, 1.05, 8), 0x6e4a35);
    tail.rotation.z = -1.1;
    tail.position.set(-1.42, 1.22, 0);
    cow.add(tail);
    const milkBadge = mesh(new THREE.SphereGeometry(0.18, 12, 8), 0xeaf7ff);
    milkBadge.position.set(1.25, 2.15, 0);
    cow.add(milkBadge);
    cow.userData = { milkBadge, headPivot, tail, body };
    cow.position.set(-14.6, 0, 7.4);
    this._target(body, { type: 'cow', id: 'cow' });
    this.targets.set('cow-group', cow);
    this.scene.add(cow);
  }

  _makeCrop() {
    const group = new THREE.Group();
    const plantMaterial = new THREE.MeshLambertMaterial({
      map: this.cropTextures.flour,
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
      depthWrite: true
    });
    const plant = new THREE.Mesh(this.cropGeometry, plantMaterial);
    plant.position.y = 0;
    group.add(plant);
    group.userData = { plant, plantMaterial, currentCrop: 'flour' };
    group.visible = false;
    return group;
  }

  _buildCropAssets() {
    if (this.cropGeometry) return;
    const positions = new Float32Array([
      -0.72, 0, 0, 0.72, 0, 0, 0.72, 1.9, 0, -0.72, 1.9, 0,
      0, 0, -0.72, 0, 0, 0.72, 0, 1.9, 0.72, 0, 1.9, -0.72
    ]);
    const uvs = new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    geometry.computeVertexNormals();
    this.cropGeometry = geometry;
    this.cropTextures = Object.fromEntries(C.CROP_IDS.map((id) => [id, this._makeCropTexture(id)]));
  }

  _makeCropTexture(id) {
    const texture = makeCanvasTexture(256, 320, (context, width, height) => {
      context.clearRect(0, 0, width, height);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      const line = (x1, y1, x2, y2, color, size) => {
        context.strokeStyle = color;
        context.lineWidth = size;
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();
      };
      const leaf = (x, y, rx, ry, rotation, color) => {
        context.save();
        context.translate(x, y);
        context.rotate(rotation);
        context.fillStyle = color;
        context.strokeStyle = '#2e5d32';
        context.lineWidth = 5;
        context.beginPath();
        context.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        line(-rx * 0.72, 0, rx * 0.72, 0, '#c9e894', 3);
        context.restore();
      };
      const fruit = (x, y, radius, color, highlight) => {
        context.fillStyle = color;
        context.strokeStyle = '#503329';
        context.lineWidth = 4;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.fillStyle = highlight || '#fff3c0';
        context.beginPath();
        context.arc(x - radius * 0.32, y - radius * 0.34, Math.max(2, radius * 0.24), 0, Math.PI * 2);
        context.fill();
      };
      const soilY = height - 20;

      if (id === 'flour') {
        for (let index = 0; index < 9; index += 1) {
          const x = 50 + index * 19 + (index % 2) * 5;
          const top = 72 + (index % 3) * 16;
          line(128, soilY, x, top + 25, '#6e8b35', 7);
          for (let grain = 0; grain < 5; grain += 1) {
            const y = top + grain * 10;
            fruit(x - 7, y, 7, '#efb92e', '#fff3a2');
            fruit(x + 7, y + 4, 7, '#efb92e', '#fff3a2');
          }
        }
        leaf(105, 225, 45, 8, -0.55, '#6c9a42');
        leaf(154, 245, 45, 8, 0.55, '#6c9a42');
      } else if (id === 'sugar') {
        for (let index = 0; index < 5; index += 1) {
          const x = 78 + index * 25;
          const top = 55 + (index % 2) * 14;
          line(x, soilY, x + (index - 2) * 4, top, '#79bd42', 18);
          for (let joint = 0; joint < 5; joint += 1) line(x - 9, 260 - joint * 38, x + 9, 260 - joint * 38, '#e8f06a', 4);
          leaf(x, 120 + index * 12, 63, 10, index % 2 ? 0.55 : -0.55, '#72c64f');
        }
      } else if (id === 'strawberry') {
        for (let index = 0; index < 9; index += 1) {
          const angle = index / 9 * Math.PI * 2;
          leaf(128 + Math.cos(angle) * 48, 205 + Math.sin(angle) * 28, 34, 16, angle, '#529746');
        }
        for (const [x, y] of [[85, 225], [126, 245], [169, 214], [145, 182], [104, 190]]) {
          line(128, 205, x, y, '#4b873e', 5);
          context.fillStyle = '#d92e43';
          context.strokeStyle = '#762337';
          context.lineWidth = 4;
          context.beginPath();
          context.moveTo(x, y + 17);
          context.bezierCurveTo(x - 17, y + 3, x - 12, y - 13, x, y - 9);
          context.bezierCurveTo(x + 12, y - 13, x + 17, y + 3, x, y + 17);
          context.fill();
          context.stroke();
          leaf(x, y - 9, 12, 5, 0, '#4d8e40');
        }
        for (const [x, y] of [[78, 175], [178, 178]]) {
          context.fillStyle = '#ffffff';
          for (let petal = 0; petal < 5; petal += 1) {
            const angle = petal / 5 * Math.PI * 2;
            context.beginPath();
            context.arc(x + Math.cos(angle) * 8, y + Math.sin(angle) * 8, 6, 0, Math.PI * 2);
            context.fill();
          }
          fruit(x, y, 5, '#ffd83f', '#fff8b0');
        }
      } else if (id === 'blackberry') {
        line(128, soilY, 128, 110, '#65472e', 12);
        for (let index = 0; index < 12; index += 1) {
          const angle = index / 12 * Math.PI * 2;
          const x = 128 + Math.cos(angle) * (42 + (index % 3) * 12);
          const y = 180 + Math.sin(angle) * 58;
          line(128, 205, x, y, '#526f35', 5);
          leaf(x, y, 32, 13, angle, '#4e8744');
          for (let berry = 0; berry < 4; berry += 1) fruit(x + (berry % 2) * 10 - 5, y + Math.floor(berry / 2) * 10 - 5, 7, '#642c88', '#d596f1');
        }
      } else if (id === 'lemon') {
        line(128, soilY, 128, 105, '#765035', 24);
        line(128, 185, 83, 125, '#765035', 10);
        line(128, 175, 177, 118, '#765035', 10);
        for (let index = 0; index < 13; index += 1) {
          const angle = index / 13 * Math.PI * 2;
          leaf(128 + Math.cos(angle) * 58, 130 + Math.sin(angle) * 54, 38, 22, angle, '#4d9144');
        }
        for (const [x, y] of [[85, 145], [123, 92], [169, 137], [140, 166], [102, 116]]) fruit(x, y, 15, '#ffdc28', '#fff9a3');
      } else if (id === 'banana') {
        line(128, soilY, 128, 105, '#75863c', 31);
        for (let index = 0; index < 8; index += 1) {
          const angle = index / 8 * Math.PI * 2 - Math.PI / 2;
          leaf(128 + Math.cos(angle) * 28, 115 + Math.sin(angle) * 22, 75, 18, angle, '#4f984a');
        }
        for (let index = 0; index < 6; index += 1) {
          context.strokeStyle = '#e1bb27';
          context.lineWidth = 11;
          context.beginPath();
          context.arc(128 + (index - 2.5) * 9, 170 + Math.abs(index - 2.5) * 4, 17, 0.15, Math.PI * 0.9);
          context.stroke();
        }
      }
    });
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  _buildKitchen() {
    const floorTexture = this._makeFloorTexture();
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(16, 0.28, 13.5),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: floorTexture })
    );
    floor.position.set(6.5, 0.1, 0);
    this.scene.add(floor);

    const backWall = mesh(new THREE.BoxGeometry(16, 5, 0.3), 0xf5d8a9);
    backWall.position.set(6.5, 2.5, -6.6);
    this.scene.add(backWall);
    const mural = new THREE.Mesh(
      new THREE.PlaneGeometry(10.5, 2.05),
      new THREE.MeshBasicMaterial({ map: this._makeCrepeMuralTexture(), transparent: true })
    );
    mural.position.set(6.5, 1.92, -6.42);
    this.scene.add(mural);

    const frontWalls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material(0x9e633f), 2);
    frontWalls.setMatrixAt(0, new THREE.Matrix4().compose(
      new THREE.Vector3(1.5, 0.36, 6.62),
      new THREE.Quaternion(),
      new THREE.Vector3(6, 0.72, 0.26)
    ));
    frontWalls.setMatrixAt(1, new THREE.Matrix4().compose(
      new THREE.Vector3(11.5, 0.36, 6.62),
      new THREE.Quaternion(),
      new THREE.Vector3(6, 0.72, 0.26)
    ));
    this.scene.add(frontWalls);

    const fridgeGroup = new THREE.Group();
    const fridgeBody = mesh(new THREE.BoxGeometry(2.2, 3.9, 1.9), 0xb9ced5);
    fridgeBody.position.y = 1.95;
    fridgeGroup.add(fridgeBody);
    const fridgeDoorPivot = new THREE.Group();
    fridgeDoorPivot.position.set(0.95, 1.68, 1.01);
    const fridgeDoor = mesh(new THREE.BoxGeometry(1.9, 2.35, 0.13), 0xdcebee);
    fridgeDoor.position.x = -0.95;
    fridgeDoorPivot.add(fridgeDoor);
    fridgeGroup.add(fridgeDoorPivot);
    fridgeGroup.position.set(1.2, 0, -4.8);
    fridgeGroup.userData = { doorPivot: fridgeDoorPivot, door: fridgeDoor };
    this.targets.set('fridge-group', fridgeGroup);
    this.scene.add(fridgeGroup);

    const sinkGroup = new THREE.Group();
    const sinkCabinet = mesh(new THREE.BoxGeometry(2.15, 1.35, 1.8), 0x8d7666);
    sinkCabinet.position.y = 0.68;
    sinkGroup.add(sinkCabinet);
    const counterTop = mesh(new THREE.BoxGeometry(2.35, 0.18, 2), 0x59686d);
    counterTop.position.y = 1.4;
    sinkGroup.add(counterTop);
    const steelMaterial = new THREE.MeshPhongMaterial({
      color: 0xb9c6ca,
      specular: 0xf4ffff,
      shininess: 82,
      side: THREE.DoubleSide
    });
    const sinkBasin = new THREE.Mesh(
      new THREE.SphereGeometry(0.78, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      steelMaterial
    );
    sinkBasin.rotation.x = Math.PI;
    sinkBasin.scale.z = 0.82;
    sinkBasin.position.y = 1.58;
    sinkGroup.add(sinkBasin);
    const faucetMaterial = new THREE.MeshPhongMaterial({
      color: 0x87999f,
      specular: 0xffffff,
      shininess: 105
    });
    const faucet = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.07, 9, 20, Math.PI), faucetMaterial);
    faucet.rotation.z = Math.PI / 2;
    faucet.position.set(-0.05, 2.02, -0.42);
    sinkGroup.add(faucet);
    const waterStream = mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.72, 10), 0x58bde9, { transparent: true, opacity: 0.76, depthWrite: false });
    waterStream.position.set(0.42, 1.66, -0.42);
    waterStream.visible = false;
    sinkGroup.add(waterStream);
    const sinkWater = mesh(new THREE.CylinderGeometry(0.59, 0.59, 0.035, 24), 0x69c7e9, { transparent: true, opacity: 0.46, depthWrite: false });
    sinkWater.position.set(0, 1.39, 0);
    sinkWater.visible = false;
    sinkGroup.add(sinkWater);
    sinkGroup.position.set(1.3, 0, 3.8);
    this._target(sinkBasin, { type: 'sink', id: 'sink' });
    sinkGroup.userData = { waterStream, sinkWater, faucet };
    this.targets.set('sink-group', sinkGroup);
    this.scene.add(sinkGroup);

    const mixerGroup = new THREE.Group();
    const counter = mesh(new THREE.BoxGeometry(3, 1.4, 2.2), 0x9b603b);
    counter.position.y = 0.7;
    mixerGroup.add(counter);
    const bowl = mesh(new THREE.SphereGeometry(0.72, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xdfe8ec, { side: THREE.DoubleSide });
    bowl.rotation.x = Math.PI;
    bowl.position.y = 1.55;
    mixerGroup.add(bowl);
    const ingredientMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.28, 12, 8),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      3
    );
    ingredientMesh.setMatrixAt(0, new THREE.Matrix4().compose(
      new THREE.Vector3(-0.28, 1.53, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(1.25, 0.48, 1)
    ));
    ingredientMesh.setMatrixAt(1, new THREE.Matrix4().compose(
      new THREE.Vector3(0.27, 1.55, 0.12),
      new THREE.Quaternion(),
      new THREE.Vector3(0.78, 0.78, 0.78)
    ));
    ingredientMesh.setMatrixAt(2, new THREE.Matrix4().compose(
      new THREE.Vector3(0, 1.43, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(1.65, 0.2, 1.65)
    ));
    ingredientMesh.setColorAt(0, new THREE.Color(0xf4ead7));
    ingredientMesh.setColorAt(1, new THREE.Color(0xfff7dc));
    ingredientMesh.setColorAt(2, new THREE.Color(0xeaf7ff));
    ingredientMesh.instanceColor.needsUpdate = true;
    ingredientMesh.visible = false;
    mixerGroup.add(ingredientMesh);
    const batterSurface = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.58, 0.08, 22),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: this._makeBatterTexture() })
    );
    batterSurface.position.set(0, 1.47, 0);
    batterSurface.visible = false;
    mixerGroup.add(batterSurface);
    const mixerAppliance = new THREE.Group();
    const motorBody = mesh(new THREE.CapsuleGeometry(0.25, 0.5, 6, 12), 0xb74f41);
    motorBody.rotation.z = Math.PI / 2;
    mixerAppliance.add(motorBody);
    const handle = mesh(new THREE.TorusGeometry(0.25, 0.07, 8, 18, Math.PI), 0x71362f);
    handle.rotation.y = Math.PI / 2;
    handle.position.set(0.05, 0.28, 0);
    mixerAppliance.add(handle);
    const shafts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.92, 8), material(0x68777c), 2);
    shafts.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-0.16, -0.63, 0));
    shafts.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0.16, -0.63, 0));
    mixerAppliance.add(shafts);
    const beaters = new THREE.InstancedMesh(new THREE.TorusGeometry(0.14, 0.025, 6, 14), material(0x7a8a8f), 2);
    mixerAppliance.add(beaters);
    mixerAppliance.position.set(-0.78, 2.72, -0.22);
    mixerAppliance.rotation.z = -0.24;
    mixerGroup.add(mixerAppliance);
    mixerGroup.position.set(4.2, 0, -4.6);
    this._target(bowl, { type: 'mixer', id: 'mixer' });
    mixerGroup.userData = { bowl, ingredientMesh, batterSurface, mixerAppliance, beaters, shafts };
    this.targets.set('mixer-group', mixerGroup);
    this.scene.add(mixerGroup);

    const toppingAtlas = this._makeToppingAtlas();
    const baseCrepeTexture = this._makeCrepeBaseTexture();
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
      crepe.material.map = baseCrepeTexture;
      crepe.material.color.setHex(0xffffff);
      crepe.position.y = 1.57;
      crepe.visible = false;
      group.add(crepe);
      group.position.set(7.2, 0, -3.6 + index * 3.6);
      this._target(top, { type: 'stove', id: 'stove-' + (index + 1) });
      this.stoveViews.set('stove-' + (index + 1), {
        group,
        ring,
        crepe,
        baseCrepeTexture,
        toppingTexture,
        hasToppings: false,
        flipStartedAt: 0,
        lastFlippedAt: 0,
        flipInitialized: false
      });
      this.scene.add(group);
    }

    const service = mesh(new THREE.BoxGeometry(2.1, 1.5, 11), 0xb87643);
    service.position.set(11.6, 0.75, 0);
    this.scene.add(service);
    const stoolX = 13.45;
    const customerX = 13.5;
    this.customerSeatX = customerX;
    const stools = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.5, 0.75, 14), material(0x6d4a35), 8);
    this.customerStoolPositions = [];
    for (let index = 0; index < 8; index += 1) {
      const position = new THREE.Vector3(stoolX, 0.38, -4.3 + index * 1.25);
      stools.setMatrixAt(index, new THREE.Matrix4().makeTranslation(position.x, position.y, position.z));
      this.customerStoolPositions.push(position);
    }
    this.scene.add(stools);
    this._buildRestaurantBanner();
  }

  _makeFloorTexture() {
    const texture = makeCanvasTexture(512, 512, (context, width, height) => {
      context.fillStyle = '#d7ad73';
      context.fillRect(0, 0, width, height);
      const size = 64;
      for (let y = 0; y < height; y += size) {
        for (let x = 0; x < width; x += size) {
          context.fillStyle = ((x / size + y / size) % 2) ? '#e6c58f' : '#c99661';
          context.fillRect(x + 2, y + 2, size - 4, size - 4);
          context.strokeStyle = 'rgba(105,65,38,.18)';
          context.strokeRect(x + 2, y + 2, size - 4, size - 4);
        }
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 3.4);
    return texture;
  }

  _makeBatterTexture() {
    const texture = makeCanvasTexture(256, 256, (context, width, height) => {
      const gradient = context.createRadialGradient(94, 82, 10, 128, 128, 126);
      gradient.addColorStop(0, '#fff0bd');
      gradient.addColorStop(0.5, '#e9c979');
      gradient.addColorStop(1, '#b98642');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = 'rgba(255,248,213,.62)';
      context.lineWidth = 12;
      context.lineCap = 'round';
      context.beginPath();
      for (let angle = 0; angle < Math.PI * 5; angle += 0.16) {
        const radius = 5 + angle * 6.2;
        const x = 128 + Math.cos(angle) * radius;
        const y = 128 + Math.sin(angle) * radius;
        if (angle === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      context.fillStyle = 'rgba(120,70,30,.12)';
      for (let bubble = 0; bubble < 18; bubble += 1) {
        const angle = bubble * 2.17;
        const radius = 18 + (bubble * 23) % 82;
        context.beginPath();
        context.arc(128 + Math.cos(angle) * radius, 128 + Math.sin(angle) * radius, 3 + bubble % 4, 0, Math.PI * 2);
        context.fill();
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.center.set(0.5, 0.5);
    return texture;
  }

  _makeCrepeMuralTexture() {
    return makeCanvasTexture(1024, 220, (context, width, height) => {
      context.clearRect(0, 0, width, height);
      const recipes = [1, 0, 2, 3];
      for (let index = 0; index < 4; index += 1) {
        const x = 55 + index * 242;
        context.fillStyle = '#75462f';
        context.fillRect(x, 10, 205, 200);
        context.fillStyle = '#fff3d4';
        context.fillRect(x + 10, 20, 185, 180);
        this._drawCrepeArt(context, x + 102, 110, 68, recipes[index]);
      }
    });
  }

  _buildRestaurantBanner() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 240;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 1.9),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
    );
    banner.position.set(6.5, 4, -6.4);
    banner.rotation.y = 0;
    this.restaurantBanner = { mesh: banner, canvas, context: canvas.getContext('2d'), texture, name: '' };
    this.scene.add(banner);
    this.setRestaurantName('Garden & Griddle');
  }

  setRestaurantName(name) {
    if (!this.restaurantBanner) return;
    const cleanName = String(name || 'Garden & Griddle').trim().slice(0, 32) || 'Garden & Griddle';
    if (this.restaurantBanner.name === cleanName) return;
    this.restaurantBanner.name = cleanName;
    const { context, canvas, texture } = this.restaurantBanner;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#6f3f25';
    context.strokeStyle = '#efb84e';
    context.lineWidth = 18;
    context.beginPath();
    context.roundRect(14, 14, canvas.width - 28, canvas.height - 28, 42);
    context.fill();
    context.stroke();
    this._drawCrepeArt(context, 105, 120, 74, 1);
    this._drawCrepeArt(context, 919, 120, 74, 0);
    let fontSize = 72;
    do {
      context.font = `900 ${fontSize}px system-ui, sans-serif`;
      fontSize -= 2;
    } while (context.measureText(cleanName).width > 660 && fontSize > 30);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 10;
    context.strokeStyle = '#3a2118';
    context.fillStyle = '#fff1c8';
    context.strokeText(cleanName, 512, 120);
    context.fillText(cleanName, 512, 120);
    texture.needsUpdate = true;
  }

  _drawCrepeArt(context, centerX, centerY, radius, recipeIndex) {
    const recipe = C.RECIPES[recipeIndex] || C.RECIPES[0];
    const base = context.createRadialGradient(
      centerX - radius * 0.25,
      centerY - radius * 0.32,
      radius * 0.08,
      centerX,
      centerY,
      radius
    );
    base.addColorStop(0, '#f8d694');
    base.addColorStop(0.58, '#dfa45a');
    base.addColorStop(0.88, '#b96f35');
    base.addColorStop(1, '#804321');
    context.fillStyle = base;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#5f321f';
    context.lineWidth = Math.max(3, radius * 0.08);
    context.stroke();
    for (let spot = 0; spot < 13; spot += 1) {
      const angle = (spot * 2.399 + recipeIndex * 0.47) % (Math.PI * 2);
      const distance = radius * (0.18 + ((spot * 37) % 55) / 100);
      const size = radius * (0.025 + (spot % 3) * 0.015);
      context.fillStyle = `rgba(117,54,25,${0.16 + (spot % 4) * 0.045})`;
      context.beginPath();
      context.ellipse(
        centerX + Math.cos(angle) * distance,
        centerY + Math.sin(angle) * distance,
        size * 1.5,
        size,
        angle,
        0,
        Math.PI * 2
      );
      context.fill();
    }
    const toppingKeys = Object.keys(recipe.toppings);
    toppingKeys.forEach((key, toppingIndex) => {
      const count = key === 'sugar' ? 11 : key === 'blackberry' ? 3 : 2;
      for (let item = 0; item < count; item += 1) {
        const angle = toppingIndex * 2.2 + item * 2.1 + recipeIndex * 0.2;
        const distance = radius * (0.2 + (item % 3) * 0.17);
        this._drawCrepeTopping(
          context,
          key,
          centerX + Math.cos(angle) * distance,
          centerY + Math.sin(angle) * distance,
          radius * (key === 'sugar' ? 0.035 : 0.15),
          angle
        );
      }
    });
  }

  _drawCrepeTopping(context, key, x, y, size, rotation) {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    if (key === 'sugar') {
      context.fillStyle = 'rgba(255,255,245,.9)';
      context.beginPath();
      context.arc(0, 0, size, 0, Math.PI * 2);
      context.fill();
    } else if (key === 'lemon') {
      context.fillStyle = '#ffd936';
      context.strokeStyle = '#a97c12';
      context.lineWidth = Math.max(2, size * 0.14);
      context.beginPath();
      context.moveTo(0, 0);
      context.arc(0, 0, size, -0.72, 0.72);
      context.closePath();
      context.fill();
      context.stroke();
      context.strokeStyle = '#fff3a1';
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(size * 0.72, 0);
      context.stroke();
    } else if (key === 'strawberry') {
      context.fillStyle = '#d92f45';
      context.strokeStyle = '#762337';
      context.lineWidth = Math.max(2, size * 0.14);
      context.beginPath();
      context.moveTo(0, size);
      context.bezierCurveTo(-size, size * 0.15, -size * 0.72, -size * 0.8, 0, -size * 0.55);
      context.bezierCurveTo(size * 0.72, -size * 0.8, size, size * 0.15, 0, size);
      context.fill();
      context.stroke();
      context.fillStyle = '#77a743';
      context.fillRect(-size * 0.38, -size * 0.72, size * 0.76, size * 0.2);
    } else if (key === 'blackberry') {
      context.fillStyle = '#51256f';
      context.strokeStyle = '#2e163e';
      context.lineWidth = Math.max(1, size * 0.1);
      for (const [dx, dy] of [[-0.35, -0.25], [0.35, -0.25], [-0.35, 0.3], [0.35, 0.3], [0, 0]]) {
        context.beginPath();
        context.arc(dx * size, dy * size, size * 0.42, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
    } else if (key === 'banana') {
      context.fillStyle = '#f3cd38';
      context.strokeStyle = '#9d791b';
      context.lineWidth = Math.max(2, size * 0.14);
      context.beginPath();
      context.ellipse(0, 0, size, size * 0.48, 0, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = '#fff2a0';
      context.beginPath();
      context.ellipse(-size * 0.18, -size * 0.12, size * 0.48, size * 0.17, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  _buildCustomers() {
    const bodyMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.46, 1.05, 12), material(0xd46d52), 8);
    const headMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 14, 10), material(0xf1c9a3), 8);
    const hairMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.36, 12, 8), material(0x6f4934), 8);
    const armMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.09, 0.72, 8), material(0xf1c9a3), 16);
    const legMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.12, 0.68, 8), material(0x5d514a), 16);
    const shinMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 0.58, 8), material(0x5d514a), 16);
    const eyeMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 8, 6), material(0x17120f), 16);
    bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    hairMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    armMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    legMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    eyeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bodyMesh.frustumCulled = headMesh.frustumCulled = hairMesh.frustumCulled = armMesh.frustumCulled = legMesh.frustumCulled = shinMesh.frustumCulled = eyeMesh.frustumCulled = false;
    for (let index = 0; index < 8; index += 1) {
      this.customerViews.push({
        position: new THREE.Vector3(this.customerSeatX, 0, -4.3 + index * 1.25),
        rotationY: -Math.PI / 2,
        scale: 0,
        visible: false,
        payBounceUntil: 0
      });
    }
    this.customerMeshes = { bodyMesh, headMesh, hairMesh, armMesh, legMesh, shinMesh, eyeMesh };
    this.scene.add(bodyMesh, headMesh, hairMesh, armMesh, legMesh, shinMesh, eyeMesh);

    this.mealPlateMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.48, 0.52, 0.06, 24),
      material(0xf7f2e6),
      8
    );
    this.mealCrepeMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.37, 0.39, 0.055, 24),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: this._makeCrepeBaseTexture() }),
      8
    );
    this.mealToppingMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.075, 9, 6),
      new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
      24
    );
    for (const instanced of [this.mealPlateMesh, this.mealCrepeMesh, this.mealToppingMesh]) {
      instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instanced.frustumCulled = false;
    }
    this.scene.add(this.mealPlateMesh, this.mealCrepeMesh, this.mealToppingMesh);
    this.mealScales = Array(8).fill(0);
    this.mealPositions = Array.from({ length: 8 }, () => new THREE.Vector3(0, -100, 0));
    this.visibleMealCount = 0;
  }

  _buildPlayers() {
    const configs = [
      { color: 0xe45b5b, apron: 0xffe1bd, x: -2.5, z: -1 },
      { color: 0x4f91d9, apron: 0xd9efff, x: -2.5, z: 1 }
    ];
    const torsoMeshes = configs.map((config) => {
      const torso = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.36, 0.5, 6, 12), material(config.color), 1);
      torso.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      torso.frustumCulled = false;
      return torso;
    });
    const headMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 16, 11), material(0xf1c9a3), 2);
    const armMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.085, 0.1, 0.78, 9), material(0xf1c9a3), 4);
    const legMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.13, 0.76, 9), material(0x4b403a), 4);
    const eyeMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), material(0x17120f), 4);
    const apronMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.58, 0.7, 0.08), material(0xffffff), 2);
    const hatMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.38, 14, 9), material(0xfffbef), 2);
    for (const instanced of [headMesh, armMesh, legMesh, eyeMesh, apronMesh, hatMesh]) {
      instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instanced.frustumCulled = false;
    }
    configs.forEach((config, index) => {
      apronMesh.setColorAt(index, new THREE.Color(config.apron));
      this.playerViews.set(index, {
        seat: index,
        position: new THREE.Vector3(config.x, 0, config.z),
        targetPosition: new THREE.Vector3(config.x, 0, config.z),
        rotationY: Math.PI / 2,
        visible: true,
        moving: false,
        taskKind: null
      });
      apronMesh.instanceColor.needsUpdate = true;
    });
    this.playerMeshes = { torsoMeshes, headMesh, armMesh, legMesh, eyeMesh, apronMesh, hatMesh };
    this.scene.add(...torsoMeshes, headMesh, armMesh, legMesh, eyeMesh, apronMesh, hatMesh);
  }

  _makeToppingAtlas() {
    const width = 128 * C.RECIPES.length;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    C.RECIPES.forEach((_recipe, index) => {
      const left = index * 128;
      context.fillStyle = '#b96f35';
      context.fillRect(left, 0, 128, 128);
      context.save();
      context.beginPath();
      context.rect(left, 0, 128, 128);
      context.clip();
      this._drawCrepeArt(context, left + 64, 64, 60, index);
      context.restore();
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  _makeCrepeBaseTexture() {
    return makeCanvasTexture(128, 128, (context) => {
      const base = context.createRadialGradient(48, 42, 5, 64, 64, 60);
      base.addColorStop(0, '#f8d694');
      base.addColorStop(0.58, '#dfa45a');
      base.addColorStop(0.9, '#b96f35');
      base.addColorStop(1, '#804321');
      context.fillStyle = base;
      context.fillRect(0, 0, 128, 128);
      for (let spot = 0; spot < 18; spot += 1) {
        const angle = spot * 2.399;
        const distance = 14 + (spot * 19) % 42;
        context.fillStyle = `rgba(105,48,22,${0.14 + (spot % 4) * 0.04})`;
        context.beginPath();
        context.ellipse(64 + Math.cos(angle) * distance, 64 + Math.sin(angle) * distance, 4 + spot % 3, 2 + spot % 2, angle, 0, Math.PI * 2);
        context.fill();
      }
    });
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

    this.cropReadyRings = new THREE.InstancedMesh(
      new THREE.TorusGeometry(0.38, 0.055, 7, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd95a, transparent: true, opacity: 0.82, depthWrite: false }),
      B.PLOT_COUNT
    );
    this.cropReadyRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cropReadyRings.frustumCulled = false;
    this.cropReadyRings.renderOrder = 7;
    this.scene.add(this.cropReadyRings);
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
    this.cameraPan.x = THREE.MathUtils.clamp(this.cameraPan.x - dx * 0.015 / this.cameraZoom, -24, 24);
    this.cameraPan.z = THREE.MathUtils.clamp(this.cameraPan.z - dy * 0.015 / this.cameraZoom, -16, 16);
    this._syncCamera();
  }

  panWorld(dx, dz) {
    this.cameraPan.x = THREE.MathUtils.clamp(this.cameraPan.x + dx, -24, 24);
    this.cameraPan.z = THREE.MathUtils.clamp(this.cameraPan.z + dz, -16, 16);
    this._syncCamera();
  }

  zoomBy(amount) {
    this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom * amount, 0.4, 1.8);
    this.resize();
    this._syncCamera();
  }

  resetView() {
    this.cameraPan.set(0, 0, 0);
    this.cameraZoom = this._phoneViewZoom();
    this.resize();
    this._syncCamera();
  }

  _phoneViewZoom() {
    return Math.min(window.innerWidth || 1000, window.innerHeight || 1000) < 700 ? 0.72 : 1;
  }

  _syncCamera() {
    const target = new THREE.Vector3(this.cameraPan.x, 0, this.cameraPan.z);
    this.camera.position.set(22 + target.x, CAMERA_HEIGHT, 22 + target.z);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld(true);
  }

  setReducedMotion(value) {
    this.reducedMotion = !!value;
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.interactive, false).find((candidate) => {
      const target = candidate.object.userData.target;
      return !(target && target.type === 'pail' && this.lastSnapshot && this.lastSnapshot.pail.holder);
    });
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
    this.readyCropCount = 0;
    let plotIndex = 0;
    for (const plot of snapshot.plots) {
      const view = this.plotViews.get(plot.id);
      const crop = view.crop;
      if (!plot.crop || plot.state === 'empty') {
        crop.visible = false;
        view.soil.material.color.setHex(0x5a3926);
        this._setInstance(this.cropReadyRings, plotIndex, new THREE.Vector3(0, -100, 0), 0);
        plotIndex += 1;
        continue;
      }
      crop.visible = true;
      if (crop.userData.currentCrop !== plot.crop) {
        crop.userData.currentCrop = plot.crop;
        crop.userData.plantMaterial.map = this.cropTextures[plot.crop];
        crop.userData.plantMaterial.needsUpdate = true;
      }
      let stage = plot.state === 'dry' ? 0.18 : plot.state === 'ripe' ? 1 : 0.35;
      if (plot.state === 'growing') {
        const total = C.CROPS[plot.crop].growSeconds * snapshot.effects.growthMultiplier;
        stage = THREE.MathUtils.clamp(1 - (plot.readyAt - snapshot.elapsed) / total, 0.24, 0.96);
      }
      crop.scale.set(0.42 + stage * 0.62, 0.3 + stage * 0.74, 0.42 + stage * 0.62);
      crop.rotation.z = this.reducedMotion ? 0 : Math.sin(performance.now() * 0.0015 + Number(plot.id.split('-')[1])) * 0.035;
      crop.position.y = 0.56 + (plot.state === 'ripe' && !this.reducedMotion ? Math.sin(performance.now() * 0.004 + plotIndex) * 0.035 : 0);
      crop.userData.plantMaterial.opacity = plot.state === 'dry' ? 0.78 : 1;
      view.soil.material.color.setHex(plot.state === 'dry' ? 0x76513a : 0x493526);
      if (plot.state === 'ripe') {
        const pulse = this.reducedMotion ? 0.86 : 0.82 + Math.sin(performance.now() * 0.005 + plotIndex) * 0.06;
        this._setInstance(this.cropReadyRings, plotIndex, view.group.position.clone().add(new THREE.Vector3(0, 2.45, 0)), pulse);
        this.readyCropCount += 1;
      } else {
        this._setInstance(this.cropReadyRings, plotIndex, new THREE.Vector3(0, -100, 0), 0);
      }
      plotIndex += 1;
    }
    this.cropReadyRings.instanceMatrix.needsUpdate = true;

    const cow = this.targets.get('cow-group');
    cow.userData.milkBadge.visible = snapshot.cow.milk > 0;
    cow.userData.milkBadge.position.y = 2.15 + (this.reducedMotion ? 0 : Math.sin(performance.now() * 0.005) * 0.08);

    const pail = this.targets.get('pail-group');
    const waterRatio = snapshot.pail.capacity ? snapshot.pail.water / snapshot.pail.capacity : 0;
    pail.userData.bucket.material.color.setRGB(0.43 - waterRatio * 0.12, 0.62 + waterRatio * 0.12, 0.76 + waterRatio * 0.16);
    pail.userData.waterSurface.visible = waterRatio > 0;
    pail.userData.waterSurface.position.y = 0.13 + waterRatio * 0.5;
    pail.userData.waterSurface.scale.set(0.82 + waterRatio * 0.18, 1, 0.82 + waterRatio * 0.18);
    if (snapshot.pail.holder && snapshot.players[snapshot.pail.holder]) {
      const holder = snapshot.players[snapshot.pail.holder];
      const avatar = this.playerViews.get(holder ? holder.seat : 0);
      const handOffset = new THREE.Vector3(0.52, 0.68, 0.12).applyAxisAngle(new THREE.Vector3(0, 1, 0), avatar.rotationY);
      pail.position.lerp(avatar.position.clone().add(handOffset), 0.28);
      pail.rotation.y += (avatar.rotationY - pail.rotation.y) * 0.25;
    } else {
      pail.position.lerp(new THREE.Vector3(-0.55, 0, 4.3), 0.18);
    }

    for (const stove of snapshot.stoves) {
      const view = this.stoveViews.get(stove.id);
      if (!view.flipInitialized) {
        view.flipInitialized = true;
        view.lastFlippedAt = stove.flippedAt;
        if (stove.flippedAt > 0 && snapshot.elapsed - stove.flippedAt < 1.2) {
          view.flipStartedAt = performance.now();
        }
      } else if (stove.flippedAt > 0 && stove.flippedAt !== view.lastFlippedAt) {
        view.lastFlippedAt = stove.flippedAt;
        view.flipStartedAt = performance.now();
      }
      const colors = {
        empty: 0x555555,
        cooking: 0xe18435,
        needsFlip: 0x329fe3,
        cookingSecond: 0xe18435,
        ready: 0x4aa85a,
        serving: 0x66c878,
        burnt: 0xc43c35
      };
      view.ring.material.color.setHex(colors[stove.state]);
      const flipPulse = stove.state === 'needsFlip' && !this.reducedMotion ? 1 + Math.sin(performance.now() * 0.018) * 0.13 : 1;
      view.ring.scale.setScalar(flipPulse);
      view.crepe.visible = stove.state !== 'empty';
      const hasToppings = ['cookingSecond', 'ready', 'serving'].includes(stove.state);
      if (hasToppings !== view.hasToppings) {
        view.hasToppings = hasToppings;
        view.crepe.material.map = hasToppings ? view.toppingTexture : view.baseCrepeTexture;
        view.crepe.material.needsUpdate = true;
      }
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
        view.scale = 0;
        this._setInstance(this.patienceRings, index, new THREE.Vector3(0, -100, 0), 0);
        return;
      }
      const targetX = 13.5;
      view.position.x += (targetX - view.position.x) * 0.08;
      view.rotationY = -Math.PI / 2;
      view.scale = order.status === 'eating' ? 1.06 : 1;
      const patience = Math.max(0, Math.min(1, (order.expiresAt - snapshot.elapsed) / Math.max(0.01, order.expiresAt - order.createdAt)));
      const ringScale = order.status === 'eating' ? 0 : 0.35 + patience * 0.65;
      this._setInstance(this.patienceRings, index, new THREE.Vector3(view.position.x, 0.05, view.position.z), ringScale);
      this.patienceRings.setColorAt(index, new THREE.Color(patience < 0.25 ? 0xc43c35 : patience < 0.5 ? 0xe5a43b : 0x4aa85a));
    });
    this.patienceRings.instanceMatrix.needsUpdate = true;
    if (this.patienceRings.instanceColor) this.patienceRings.instanceColor.needsUpdate = true;
    this._updateCustomerInstances(activeOrders);
    this._updateMealInstances(activeOrders, snapshot);

    for (const avatar of this.playerViews.values()) avatar.visible = false;
    const playerEntries = Object.values(snapshot.players).sort((a, b) => a.seat - b.seat);
    playerEntries.forEach((player) => {
      const avatar = this.playerViews.get(player.seat);
      if (!avatar) return;
      avatar.visible = player.connected;
      const target = this._positionForAction(player.lastAction);
      if (target) avatar.targetPosition.copy(target);
      const deltaX = avatar.targetPosition.x - avatar.position.x;
      const deltaZ = avatar.targetPosition.z - avatar.position.z;
      avatar.moving = Math.hypot(deltaX, deltaZ) > 0.12;
      if (avatar.moving) avatar.rotationY = Math.atan2(deltaX, deltaZ);
      avatar.position.lerp(avatar.targetPosition, 0.1);
      avatar.taskKind = player.task ? player.task.kind : null;
    });
    this._updatePlayerInstances();

    const mixer = this.targets.get('mixer-group');
    this._updateMixer(mixer, snapshot);
    this._updateKitchenProps(snapshot);
    this._updateCow(cow, snapshot);
    this._updateStoveAnimations(snapshot);
    this._updateContactShadows(snapshot, playerEntries, activeOrders, pail, cow);
    this._consumeEffects(snapshot.events || []);
  }

  _updateCustomerInstances(activeOrders) {
    const { bodyMesh, headMesh, hairMesh, armMesh, legMesh, shinMesh, eyeMesh } = this.customerMeshes;
    const now = performance.now() * 0.001;
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (let index = 0; index < 8; index += 1) {
      const view = this.customerViews[index];
      const order = activeOrders[index];
      const scale = view.visible ? view.scale : 0;
      const eating = !!order && order.status === 'eating';
      const bounce = this.reducedMotion ? 0 : Math.sin(now * (eating ? 8 : 3) + index) * (eating ? 0.055 : 0.018);
      const quaternion = new THREE.Quaternion().setFromAxisAngle(yAxis, view.rotationY);
      bodyMesh.setMatrixAt(index, new THREE.Matrix4().compose(
        new THREE.Vector3(view.position.x, 1.28 + bounce, view.position.z),
        quaternion,
        new THREE.Vector3(scale, scale, scale)
      ));
      headMesh.setMatrixAt(index, new THREE.Matrix4().compose(
        new THREE.Vector3(view.position.x, 1.98 + bounce, view.position.z),
        quaternion,
        new THREE.Vector3(scale, scale, scale)
      ));
      hairMesh.setMatrixAt(index, new THREE.Matrix4().compose(
        new THREE.Vector3(view.position.x, 2.22 + bounce, view.position.z),
        quaternion,
        new THREE.Vector3(scale * 0.94, scale * 0.43, scale * 0.94)
      ));
      for (let side = 0; side < 2; side += 1) {
        const armIndex = index * 2 + side;
        const sideSign = side === 0 ? -1 : 1;
        const local = new THREE.Vector3(sideSign * 0.42, 1.42, eating ? 0.28 : 0).applyAxisAngle(yAxis, view.rotationY);
        const armSwing = this.reducedMotion ? 0
          : eating ? Math.sin(now * 9 + side * Math.PI) * 0.45 : Math.sin(now * 3 + index) * 0.08;
        const armQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(armSwing, 0, sideSign * 0.22));
        armQuat.premultiply(quaternion);
        armMesh.setMatrixAt(armIndex, new THREE.Matrix4().compose(
          view.position.clone().add(local),
          armQuat,
          new THREE.Vector3(scale, scale, scale)
        ));
        const legLocal = new THREE.Vector3(sideSign * 0.2, 0.78, 0.28).applyAxisAngle(yAxis, view.rotationY);
        const thighQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
        thighQuaternion.premultiply(quaternion);
        legMesh.setMatrixAt(armIndex, new THREE.Matrix4().compose(
          view.position.clone().add(legLocal),
          thighQuaternion,
          new THREE.Vector3(scale, scale, scale)
        ));
        const shinLocal = new THREE.Vector3(sideSign * 0.2, 0.43, 0.55).applyAxisAngle(yAxis, view.rotationY);
        shinMesh.setMatrixAt(armIndex, new THREE.Matrix4().compose(
          view.position.clone().add(shinLocal),
          quaternion,
          new THREE.Vector3(scale, scale, scale)
        ));
        const eyeLocal = new THREE.Vector3(sideSign * 0.14, 2.03 + bounce, 0.3).applyAxisAngle(yAxis, view.rotationY);
        eyeMesh.setMatrixAt(armIndex, new THREE.Matrix4().compose(
          view.position.clone().add(eyeLocal),
          quaternion,
          new THREE.Vector3(scale, scale, scale)
        ));
      }
    }
    for (const instanced of [bodyMesh, headMesh, hairMesh, armMesh, legMesh, shinMesh, eyeMesh]) instanced.instanceMatrix.needsUpdate = true;
  }

  _updateMealInstances(activeOrders, snapshot) {
        const toppingColors = {
          lemon: 0xffdc28,
          sugar: 0xfff4d2,
          strawberry: 0xdf4055,
          blackberry: 0x642c88,
          banana: 0xefc94c
        };
        this.visibleMealCount = 0;
        for (let index = 0; index < 8; index += 1) {
          const order = activeOrders[index];
          if (!order || order.status !== 'eating') {
            this._setMealMatrix(this.mealPlateMesh, index, new THREE.Vector3(0, -100, 0), 0);
            this._setMealMatrix(this.mealCrepeMesh, index, new THREE.Vector3(0, -100, 0), 0);
            this.mealScales[index] = 0;
            this.mealPositions[index].set(0, -100, 0);
            for (let topping = 0; topping < 3; topping += 1) {
              this._setMealMatrix(this.mealToppingMesh, index * 3 + topping, new THREE.Vector3(0, -100, 0), 0);
            }
            continue;
          }
          const customer = this.customerViews[index];
          const transferProgress = THREE.MathUtils.clamp((snapshot.elapsed - order.servedAt) / 0.75, 0, 1);
          const easedTransfer = transferProgress * transferProgress * (3 - 2 * transferProgress);
          const eatDuration = Math.max(0.01, order.payAt - order.servedAt);
          const eatProgress = THREE.MathUtils.clamp((snapshot.elapsed - order.servedAt - 0.6) / Math.max(0.01, eatDuration - 0.6), 0, 1);
          const bitePulse = this.reducedMotion ? 0 : Math.sin(eatProgress * Math.PI * 10) * 0.025;
          const mealScale = Math.max(0.14, 1 - eatProgress * 0.86 + bitePulse);
          const mealPosition = new THREE.Vector3(
            THREE.MathUtils.lerp(10.85, 12.28, easedTransfer),
            1.56 + (this.reducedMotion ? 0 : Math.sin(transferProgress * Math.PI) * 0.08),
            customer.position.z
          );
          this._setMealMatrix(this.mealPlateMesh, index, mealPosition, 1);
          this._setMealMatrix(this.mealCrepeMesh, index, mealPosition.clone().add(new THREE.Vector3(0, 0.075, 0)), mealScale);
          this.mealScales[index] = mealScale;
          this.mealPositions[index].copy(mealPosition);
          this.visibleMealCount += 1;
          const recipe = C.RECIPE_BY_ID[order.recipeId];
          const toppings = recipe ? Object.keys(recipe.toppings).slice(0, 3) : [];
          for (let topping = 0; topping < 3; topping += 1) {
            const key = toppings[topping];
            if (!key) {
              this._setMealMatrix(this.mealToppingMesh, index * 3 + topping, new THREE.Vector3(0, -100, 0), 0);
              continue;
            }
            const angle = topping / Math.max(1, toppings.length) * Math.PI * 2;
            const toppingPosition = mealPosition.clone().add(new THREE.Vector3(
              Math.cos(angle) * 0.18 * mealScale,
              0.13,
              Math.sin(angle) * 0.18 * mealScale
            ));
            this._setMealMatrix(this.mealToppingMesh, index * 3 + topping, toppingPosition, mealScale);
            this.mealToppingMesh.setColorAt(index * 3 + topping, new THREE.Color(toppingColors[key] || 0xffffff));
          }
        }
        this.mealPlateMesh.instanceMatrix.needsUpdate = true;
        this.mealCrepeMesh.instanceMatrix.needsUpdate = true;
        this.mealToppingMesh.instanceMatrix.needsUpdate = true;
        if (this.mealToppingMesh.instanceColor) this.mealToppingMesh.instanceColor.needsUpdate = true;
      }

  _setMealMatrix(instancedMesh, index, position, scale) {
        instancedMesh.setMatrixAt(index, new THREE.Matrix4().compose(
          position,
          new THREE.Quaternion(),
          new THREE.Vector3(scale, scale, scale)
        ));
  }

  _updatePlayerInstances() {
        const { torsoMeshes, headMesh, armMesh, legMesh, eyeMesh, apronMesh, hatMesh } = this.playerMeshes;
        const now = performance.now() * 0.001;
        const yAxis = new THREE.Vector3(0, 1, 0);
        for (let seat = 0; seat < 2; seat += 1) {
          const view = this.playerViews.get(seat);
          const scale = view.visible ? 1 : 0;
          const quaternion = new THREE.Quaternion().setFromAxisAngle(yAxis, view.rotationY);
          const working = !!view.taskKind;
          const step = this.reducedMotion ? 0 : view.moving ? Math.sin(now * 11 + seat) : 0;
          const work = this.reducedMotion ? 0 : working ? Math.sin(now * 13 + seat) : 0;
          const bob = this.reducedMotion ? 0 : view.moving ? Math.abs(Math.sin(now * 11 + seat)) * 0.07 : Math.sin(now * 2 + seat) * 0.012;

          torsoMeshes[seat].setMatrixAt(0, new THREE.Matrix4().compose(
            new THREE.Vector3(view.position.x, 1.02 + bob, view.position.z),
            quaternion,
            new THREE.Vector3(scale, scale, scale)
          ));
          headMesh.setMatrixAt(seat, new THREE.Matrix4().compose(
            new THREE.Vector3(view.position.x, 1.74 + bob, view.position.z),
            quaternion,
            new THREE.Vector3(scale, scale, scale)
          ));
          hatMesh.setMatrixAt(seat, new THREE.Matrix4().compose(
            new THREE.Vector3(view.position.x, 2.18 + bob, view.position.z),
            quaternion,
            new THREE.Vector3(scale * 1.12, scale * 0.58, scale * 1.12)
          ));
          const apronOffset = new THREE.Vector3(0, 1.02, 0.35).applyAxisAngle(yAxis, view.rotationY);
          apronMesh.setMatrixAt(seat, new THREE.Matrix4().compose(
            view.position.clone().add(apronOffset).add(new THREE.Vector3(0, bob, 0)),
            quaternion,
            new THREE.Vector3(scale, scale, scale)
          ));

          for (let side = 0; side < 2; side += 1) {
            const index = seat * 2 + side;
            const sign = side === 0 ? -1 : 1;
            const armOffset = new THREE.Vector3(sign * 0.43, 1.12 + bob, working ? 0.18 : 0).applyAxisAngle(yAxis, view.rotationY);
            const armAngle = working ? work * 0.55 : step * sign * 0.5;
            const armQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(armAngle, 0, sign * 0.18));
            armQuaternion.premultiply(quaternion);
            armMesh.setMatrixAt(index, new THREE.Matrix4().compose(
              view.position.clone().add(armOffset),
              armQuaternion,
              new THREE.Vector3(scale, scale, scale)
            ));
            const legOffset = new THREE.Vector3(sign * 0.2, 0.38, 0).applyAxisAngle(yAxis, view.rotationY);
            const legQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-step * sign * 0.48, 0, 0));
            legQuaternion.premultiply(quaternion);
            legMesh.setMatrixAt(index, new THREE.Matrix4().compose(
              view.position.clone().add(legOffset),
              legQuaternion,
              new THREE.Vector3(scale, scale, scale)
            ));
            const eyeOffset = new THREE.Vector3(sign * 0.14, 1.79 + bob, 0.3).applyAxisAngle(yAxis, view.rotationY);
            eyeMesh.setMatrixAt(index, new THREE.Matrix4().compose(
              view.position.clone().add(eyeOffset),
              quaternion,
              new THREE.Vector3(scale, scale, scale)
            ));
          }
        }
        for (const instanced of [...torsoMeshes, headMesh, armMesh, legMesh, eyeMesh, apronMesh, hatMesh]) {
          instanced.instanceMatrix.needsUpdate = true;
        }
  }

  _updateMixer(mixer, snapshot) {
    const parts = mixer.userData;
    const mixing = snapshot.mixer.state === 'mixing';
    const progress = mixing
      ? THREE.MathUtils.clamp(1 - (snapshot.mixer.readyAt - snapshot.elapsed) / Math.max(0.01, snapshot.effects.mixSeconds), 0, 1)
      : 0;
    parts.ingredientMesh.visible = mixing && progress < 0.38;
    parts.batterSurface.visible = mixing && progress >= 0.18;
    if (parts.batterSurface.visible) {
      const fill = THREE.MathUtils.clamp((progress - 0.18) / 0.55, 0.2, 1);
      parts.batterSurface.scale.set(0.7 + fill * 0.3, 1, 0.7 + fill * 0.3);
      if (!this.reducedMotion) parts.batterSurface.material.map.rotation += 0.055;
    }
    const targetPosition = mixing ? new THREE.Vector3(0, 2.65, 0) : new THREE.Vector3(-0.78, 2.82, -0.22);
    parts.mixerAppliance.position.lerp(targetPosition, this.reducedMotion ? 1 : 0.16);
    const targetRotation = mixing ? 0 : -0.24;
    parts.mixerAppliance.rotation.z += (targetRotation - parts.mixerAppliance.rotation.z) * (this.reducedMotion ? 1 : 0.16);
    const vibration = mixing && !this.reducedMotion ? Math.sin(performance.now() * 0.05) * 0.012 : 0;
    parts.mixerAppliance.position.x += vibration;
    parts.beaterAngle = (parts.beaterAngle || 0) + (mixing && !this.reducedMotion ? 0.7 : 0);
    for (let index = 0; index < 2; index += 1) {
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, parts.beaterAngle * (index ? -1 : 1), 0));
      parts.beaters.setMatrixAt(index, new THREE.Matrix4().compose(
        new THREE.Vector3(index ? 0.16 : -0.16, -1.05, 0),
        quaternion,
        new THREE.Vector3(1, 1, 1)
      ));
    }
    parts.beaters.instanceMatrix.needsUpdate = true;
  }

  _updateKitchenProps(snapshot) {
    const sink = this.targets.get('sink-group');
    const fillingPlayer = Object.values(snapshot.players).find((player) => player.task && player.task.kind === 'fillPail');
    const filling = !!fillingPlayer;
    sink.userData.waterStream.visible = filling;
    sink.userData.sinkWater.visible = filling;
    if (filling) {
      const task = fillingPlayer.task;
      const progress = THREE.MathUtils.clamp((snapshot.elapsed - task.startedAt) / Math.max(0.01, task.completeAt - task.startedAt), 0, 1);
      const pulse = this.reducedMotion ? 0 : Math.sin(performance.now() * 0.025);
      sink.userData.waterStream.scale.y = 0.88 + pulse * 0.08;
      sink.userData.waterStream.material.opacity = 0.66 + pulse * 0.1;
      sink.userData.sinkWater.scale.set(0.55 + progress * 0.45, 1, 0.55 + progress * 0.45);
      sink.userData.sinkWater.position.y = 1.37 + progress * 0.035;
      if (!this.reducedMotion) {
        const wave = (performance.now() * 0.003) % 1;
        sink.userData.sinkWater.scale.x += Math.sin(wave * Math.PI * 2) * 0.018;
        sink.userData.sinkWater.scale.z -= Math.sin(wave * Math.PI * 2) * 0.018;
      }
    }
    const fridge = this.targets.get('fridge-group');
    const opened = snapshot.events.some((event) => ['harvested', 'milked'].includes(event.type) && snapshot.elapsed - event.at < 0.9);
    fridge.userData.doorPivot.rotation.y += ((opened ? -0.88 : 0) - fridge.userData.doorPivot.rotation.y) * 0.16;
  }

  _updateCow(cow, snapshot) {
    const now = performance.now() * 0.001;
    cow.userData.headPivot.rotation.z = this.reducedMotion ? 0 : Math.sin(now * 1.5) * 0.075;
    cow.userData.headPivot.rotation.y = this.reducedMotion ? 0 : Math.sin(now * 0.85) * 0.12;
    cow.userData.tail.rotation.z = -1.1 + (this.reducedMotion ? 0 : Math.sin(now * 4.2) * 0.38);
    cow.userData.body.scale.y = 0.82 + (this.reducedMotion ? 0 : Math.sin(now * 1.8) * 0.018);
    cow.userData.milkBadge.visible = snapshot.cow.milk > 0;
  }

  _updateStoveAnimations() {
    const now = performance.now();
    for (const view of this.stoveViews.values()) {
      if (!view.flipStartedAt) continue;
      const progress = (now - view.flipStartedAt) / 950;
      if (progress >= 1 || this.reducedMotion) {
        view.crepe.rotation.x = 0;
        view.crepe.rotation.z = 0;
        view.crepe.position.y = 1.57;
        view.crepe.position.x = 0;
        view.flipStartedAt = 0;
      } else {
        view.crepe.rotation.x = progress * Math.PI * 4;
        view.crepe.rotation.z = Math.sin(progress * Math.PI) * 0.28;
        view.crepe.position.y = 1.57 + Math.sin(progress * Math.PI) * 1.05;
        view.crepe.position.x = Math.sin(progress * Math.PI * 2) * 0.16;
      }
    }
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
        position = new THREE.Vector3();
        sink.getWorldPosition(position);
        position.add(new THREE.Vector3(0, 0.8, 0));
      } else if (event.type === 'served' || event.type === 'customerPaid') {
        position = new THREE.Vector3(12.3, 1.4, 0);
      }
      if (!position) continue;
      if (event.type === 'watered' || event.type === 'pailFilled') { color = 0x62b9ef; mode = 'water'; }
      else if (event.type === 'mixerStarted') { color = 0xfff0cf; mode = 'steam'; }
      else if (event.type === 'crepeReady') { color = 0xf5e4bd; mode = 'steam'; }
      else if (event.type === 'crepeNeedsFlip' || event.type === 'crepeFlipped') color = 0x62b9ef;
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
    if (lastAction.kind === 'milk') return new THREE.Vector3(-13.2, 0, 7.1);
    if (lastAction.kind === 'fillPail') return new THREE.Vector3(0.2, 0, 3.8);
    if (lastAction.kind === 'mixBatter') return new THREE.Vector3(3.1, 0, -4.1);
    if (lastAction.kind === 'pickupPail' || lastAction.kind === 'dropPail') return new THREE.Vector3(-1.45, 0, 4.3);
    return null;
  }

  render(time) {
    this._syncCamera();
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
