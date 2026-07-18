/**
 * 3D physics dice overlay — Three.js + cannon-es. Dice spawn above the felt
 * and tumble under gravity inside invisible walls until they come to a natural
 * rest, then glide a short distance into their row.
 *
 * Truthfulness (the load-bearing correctness property): a die must settle
 * showing exactly the value the server rolled. We get this *physically* rather
 * than by snapping: before animating, each die's throw is pre-simulated
 * (rejection sampling) until it comes to rest showing the target value, and the
 * visible roll replays that exact throw. Dice don't collide with each other
 * (collision groups), so each die is deterministic and its solo pre-sim matches
 * the live roll. Each die drops in from just above its own slot, so the tumble
 * stays over the tray. As it settles, the die eases into the nearest clean,
 * axis-aligned orientation showing the target value — squaring up yaw and
 * levelling any resting tilt so the dice land in a tidy, lined-up row without
 * ever showing a face other than the server's. The sim asserts the settled
 * `data-face-up` equals the server's die.
 *
 * Deliberately imperative (no React inside): GameRoom owns an instance via ref
 * and calls roll()/snapToState(). Call destroy() on unmount.
 */
import * as THREE from "three";
import * as CANNON from "cannon-es";

const GRAVITY = -34; // a touch gentler than before → a longer, rollier tumble
const MIN_ROLL_MS = 800; // always show at least this much tumble
const MAX_ROLL_MS = 2800; // safety cap if a die never fully rests
const GLIDE_MS = 420; // gentle slide + square-up from rest pose into the slot row
const REST_LIN = 0.35; // linear speed² below which a die counts as at rest
const REST_ANG = 0.45; // angular speed² below which a die counts as at rest
const DICE_GROUP = 2;
const STATIC_GROUP = 1;

/** Cube face normals → the value printed on that face (see faceMaterials). */
const FACE_NORMALS: { n: THREE.Vector3; v: number }[] = [
  { n: new THREE.Vector3(1, 0, 0), v: 3 },
  { n: new THREE.Vector3(-1, 0, 0), v: 4 },
  { n: new THREE.Vector3(0, 1, 0), v: 1 },
  { n: new THREE.Vector3(0, -1, 0), v: 6 },
  { n: new THREE.Vector3(0, 0, 1), v: 2 },
  { n: new THREE.Vector3(0, 0, -1), v: 5 },
];

interface Throw {
  pos: CANNON.Vec3;
  vel: CANNON.Vec3;
  angVel: CANNON.Vec3;
  quat: CANNON.Quaternion;
}

interface RollData {
  finalValues: number[];
  unheldIndices: number[];
  slotPos: THREE.Vector3[];
  onComplete?: () => void;
  rested: boolean[];
  restPos: (THREE.Vector3 | null)[];
  restQuat: (THREE.Quaternion | null)[];
  finalQuat: (THREE.Quaternion | null)[];
  gliding: boolean;
  glideStart: number;
}

interface SnapData {
  finalValues: number[];
  heldState: boolean[];
  targetElements: (HTMLElement | null)[];
}

export class Dice3D {
  private container: HTMLDivElement;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private world: CANNON.World;
  private diceMaterial: CANNON.Material;
  private diceMeshes: THREE.Mesh[] = [];
  private diceBodies: CANNON.Body[] = [];
  private normalMaterials: THREE.MeshLambertMaterial[];
  private heldMaterials: THREE.MeshLambertMaterial[];
  /** A throwaway world + die used to pre-solve each throw off-screen. */
  private solverWorld: CANNON.World;
  private solverBody: CANNON.Body;
  rolling = false;
  private settling = false; // true once every unheld die has come to rest
  private destroyed = false;
  private rollData: RollData | null = null;
  private snapData: SnapData | null = null;
  private rollStartTime = 0;
  private orientationsByValue = new Map<number, THREE.Quaternion[]>();
  private restQuats: (THREE.Quaternion | null)[] = [null, null, null, null, null];
  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    Object.assign(this.container.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "999",
    });
    parent.appendChild(this.container);

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      100,
    );
    this.camera.position.set(0, 15, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);

    // A device without WebGL must not crash the game — the caller catches this
    // and falls back to the 2D dice.
    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch (err) {
      this.container.remove();
      throw err;
    }
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    this.scene.add(dirLight);

    // Visible physics world + an identical off-screen solver world.
    this.diceMaterial = new CANNON.Material();
    this.world = Dice3D.buildArena(this.diceMaterial);
    this.solverWorld = Dice3D.buildArena(this.diceMaterial);
    this.solverBody = Dice3D.makeDieBody(this.diceMaterial);
    this.solverWorld.addBody(this.solverBody);

    // Ivory dice with espresso pips; held dice take a warm gold tint.
    this.normalMaterials = this.createDiceMaterials("#f4ede0", "#ddccae", "#241c14");
    this.heldMaterials = this.createDiceMaterials("#f3d98c", "#c99a34", "#3a2a0e");

    for (let i = 0; i < 5; i++) {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(geometry, this.faceMaterials(false));
      this.scene.add(mesh);
      this.diceMeshes.push(mesh);

      const body = Dice3D.makeDieBody(this.diceMaterial);
      this.world.addBody(body);
      this.diceBodies.push(body);

      body.position.set(100, 100, 100); // hidden until first roll
      mesh.position.set(100, 100, 100);
    }

    this.buildOrientations();

    window.addEventListener("resize", this.onResize);
    document.body.classList.add("dice3d-active");
    this.animate();
  }

  /** A world with the floor + four walls forming the tumbling arena. */
  private static buildArena(mat: CANNON.Material): CANNON.World {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
    const addPlane = (
      position: [number, number, number],
      euler: [number, number, number],
    ): void => {
      const body = new CANNON.Body({ mass: 0 });
      body.addShape(new CANNON.Plane());
      body.position.set(...position);
      body.quaternion.setFromEuler(...euler);
      body.collisionFilterGroup = STATIC_GROUP;
      body.collisionFilterMask = -1; // collide with everything (incl. dice)
      world.addBody(body);
    };
    addPlane([0, 0, 0], [-Math.PI / 2, 0, 0]); // floor
    addPlane([0, 0, -5], [0, 0, 0]);
    addPlane([0, 0, 5], [0, Math.PI, 0]);
    addPlane([-4, 0, 0], [0, Math.PI / 2, 0]);
    addPlane([4, 0, 0], [0, -Math.PI / 2, 0]);
    world.addContactMaterial(
      new CANNON.ContactMaterial(mat, mat, { friction: 0.35, restitution: 0.4 }),
    );
    return world;
  }

  /** A unit die body that collides with the arena but NOT with other dice. */
  private static makeDieBody(mat: CANNON.Material): CANNON.Body {
    const body = new CANNON.Body({ mass: 1, material: mat });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)));
    body.collisionFilterGroup = DICE_GROUP;
    body.collisionFilterMask = STATIC_GROUP; // ignore other dice → deterministic
    return body;
  }

  /** Map face values 1–6 onto BoxGeometry face order (r, l, t, b, f, back). */
  private faceMaterials(held: boolean): THREE.MeshLambertMaterial[] {
    const m = held ? this.heldMaterials : this.normalMaterials;
    return [m[2]!, m[3]!, m[0]!, m[5]!, m[1]!, m[4]!];
  }

  private createDiceMaterials(
    bg: string,
    border: string,
    pipColor: string,
  ): THREE.MeshLambertMaterial[] {
    const materials: THREE.MeshLambertMaterial[] = [];
    for (let i = 1; i <= 6; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = border;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 248, 248);
      ctx.fillStyle = pipColor;
      const drawPip = (x: number, y: number): void => {
        ctx.beginPath();
        ctx.arc(x, y, 22, 0, Math.PI * 2);
        ctx.fill();
      };
      const c = 128;
      const d = 64;
      if (i === 1 || i === 3 || i === 5) drawPip(c, c);
      if (i !== 1) {
        drawPip(c - d, c - d);
        drawPip(c + d, c + d);
      }
      if (i === 4 || i === 5 || i === 6) {
        drawPip(c + d, c - d);
        drawPip(c - d, c + d);
      }
      if (i === 6) {
        drawPip(c - d, c);
        drawPip(c + d, c);
      }
      materials.push(
        new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(canvas) }),
      );
    }
    return materials;
  }

  private get3DTarget(x: number, y: number, targetSize: number): THREE.Vector3 {
    const ndcX = (x / window.innerWidth) * 2 - 1;
    const ndcY = -(y / window.innerHeight) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(targetSize / 2));
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, target);
    return target;
  }

  private getTargetRotation(value: number): THREE.Quaternion {
    const rot = new THREE.Euler();
    switch (value) {
      case 1: rot.set(0, 0, 0); break;
      case 6: rot.set(Math.PI, 0, 0); break;
      case 2: rot.set(-Math.PI / 2, 0, 0); break;
      case 5: rot.set(Math.PI / 2, 0, 0); break;
      case 3: rot.set(0, 0, Math.PI / 2); break;
      case 4: rot.set(0, 0, -Math.PI / 2); break;
    }
    return new THREE.Quaternion().setFromEuler(rot);
  }

  private buildOrientations(): void {
    const ySpins = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) =>
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a),
    );
    for (let v = 1; v <= 6; v++) {
      const base = this.getTargetRotation(v);
      this.orientationsByValue.set(
        v,
        ySpins.map((s) => s.clone().multiply(base)),
      );
    }
  }

  private closestOrientation(
    value: number,
    current: THREE.Quaternion,
  ): THREE.Quaternion {
    const candidates = this.orientationsByValue.get(value)!;
    let best = candidates[0]!;
    let bestDot = -Infinity;
    for (const c of candidates) {
      const dot = Math.abs(c.dot(current));
      if (dot > bestDot) {
        bestDot = dot;
        best = c;
      }
    }
    return best.clone();
  }

  /** The die value currently facing the camera (largest +Y world component). */
  private faceUp(q: THREE.Quaternion): number {
    let bestV = 0;
    let bestY = -Infinity;
    const tmp = new THREE.Vector3();
    for (const f of FACE_NORMALS) {
      const y = tmp.copy(f.n).applyQuaternion(q).y;
      if (y > bestY) {
        bestY = y;
        bestV = f.v;
      }
    }
    return bestV;
  }

  private setFaceAttr(el: HTMLElement | null, q: THREE.Quaternion): void {
    if (el) el.dataset.faceUp = String(this.faceUp(q));
  }

  private targetFor(
    el: HTMLElement | null,
  ): { pos: THREE.Vector3; size: number } {
    if (!el) return { pos: new THREE.Vector3(100, 100, 100), size: 1 };
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return { pos: new THREE.Vector3(100, 100, 100), size: 1 };
    const vFov = (this.camera.fov * Math.PI) / 180;
    const visibleHeight = 2 * Math.tan(vFov / 2) * this.camera.position.y;
    const pixelsPerUnit = window.innerHeight / visibleHeight;
    const size = rect.width / pixelsPerUnit;
    const pos = this.get3DTarget(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      size,
    );
    return { pos, size };
  }

  /**
   * Rejection-sample a throw whose die comes to rest showing `target`, by
   * fast-forwarding the off-screen solver world. Returns the winning initial
   * conditions, or null if none landed on target in the try budget.
   */
  private solveThrow(size: number, slot: THREE.Vector3, target: number): Throw | null {
    const half = size / 2;
    this.solverBody.shapes[0] = new CANNON.Box(new CANNON.Vec3(half, half, half));
    this.solverBody.updateBoundingRadius();
    for (let attempt = 0; attempt < 80; attempt++) {
      const t: Throw = {
        // Drop in from just above this die's slot with only a small lateral
        // nudge, so it tumbles down over the tray rather than flying sideways.
        pos: new CANNON.Vec3(
          slot.x + (Math.random() - 0.5) * 0.5,
          5 + Math.random() * 1.5,
          slot.z + (Math.random() - 0.5) * 0.5,
        ),
        vel: new CANNON.Vec3(
          (Math.random() - 0.5) * 1.8,
          -7 - Math.random() * 2,
          (Math.random() - 0.5) * 1.8,
        ),
        angVel: new CANNON.Vec3(
          (Math.random() - 0.5) * 24,
          (Math.random() - 0.5) * 24,
          (Math.random() - 0.5) * 24,
        ),
        quat: new CANNON.Quaternion().setFromEuler(
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
        ),
      };
      this.applyThrow(this.solverBody, t);
      let rested = false;
      for (let step = 0; step < 480; step++) {
        this.solverWorld.step(1 / 60);
        if (this.isAtRest(this.solverBody, half)) {
          rested = true;
          break;
        }
      }
      if (!rested) continue;
      if (this.faceUp(this.cannonQuat(this.solverBody)) === target) return t;
    }
    return null;
  }

  private applyThrow(body: CANNON.Body, t: Throw): void {
    body.type = CANNON.Body.DYNAMIC;
    body.position.copy(t.pos);
    body.velocity.copy(t.vel);
    body.angularVelocity.copy(t.angVel);
    body.quaternion.copy(t.quat);
    body.wakeUp();
  }

  private isAtRest(body: CANNON.Body, half: number): boolean {
    return (
      body.velocity.lengthSquared() < REST_LIN &&
      body.angularVelocity.lengthSquared() < REST_ANG &&
      body.position.y < half * 1.6
    );
  }

  private cannonQuat(body: CANNON.Body): THREE.Quaternion {
    return new THREE.Quaternion(
      body.quaternion.x,
      body.quaternion.y,
      body.quaternion.z,
      body.quaternion.w,
    );
  }

  roll(
    finalValues: number[],
    unheldIndices: number[],
    targetElements: (HTMLElement | null)[],
    onComplete?: () => void,
  ): void {
    this.rolling = true;
    this.settling = false;
    this.rollStartTime = performance.now();
    this.snapData = {
      finalValues,
      heldState: targetElements.map((_, i) => !unheldIndices.includes(i)),
      targetElements,
    };
    this.restQuats = [null, null, null, null, null];

    this.rollData = {
      finalValues,
      unheldIndices,
      slotPos: [],
      onComplete,
      rested: [false, false, false, false, false],
      restPos: [null, null, null, null, null],
      restQuat: [null, null, null, null, null],
      finalQuat: [null, null, null, null, null],
      gliding: false,
      glideStart: 0,
    };

    for (let i = 0; i < 5; i++) {
      const { pos, size } = this.targetFor(targetElements[i] ?? null);
      this.diceMeshes[i]!.scale.setScalar(size);
      const half = size / 2;
      this.diceBodies[i]!.shapes[0] = new CANNON.Box(new CANNON.Vec3(half, half, half));
      this.diceBodies[i]!.updateBoundingRadius();
      this.rollData.slotPos.push(pos);

      if (unheldIndices.includes(i)) {
        this.diceMeshes[i]!.material = this.faceMaterials(false);
        // Pre-solve a throw that physically rests on the target value, dropping
        // in from just above this die's own slot so the tumble stays over the
        // tray instead of flinging the die across the screen.
        const solved = this.solveThrow(size, pos, finalValues[i]!);
        const t: Throw = solved ?? {
          pos: new CANNON.Vec3(pos.x, 6, pos.z),
          vel: new CANNON.Vec3(0, -9, 0),
          angVel: new CANNON.Vec3(10, 12, 8),
          quat: new CANNON.Quaternion(),
        };
        this.applyThrow(this.diceBodies[i]!, t);
      } else {
        // Held die: snap in place at the canonical orientation.
        const rot = this.getTargetRotation(finalValues[i]!);
        this.diceMeshes[i]!.material = this.faceMaterials(true);
        this.diceBodies[i]!.type = CANNON.Body.KINEMATIC;
        this.diceBodies[i]!.position.copy(pos as unknown as CANNON.Vec3);
        this.diceBodies[i]!.quaternion.copy(rot as unknown as CANNON.Quaternion);
        this.diceBodies[i]!.velocity.set(0, 0, 0);
        this.diceBodies[i]!.angularVelocity.set(0, 0, 0);
        this.diceMeshes[i]!.position.copy(pos);
        this.diceMeshes[i]!.quaternion.copy(rot);
        this.restQuats[i] = rot.clone();
        this.setFaceAttr(targetElements[i] ?? null, rot);
      }
    }
  }

  snapToState(
    finalValues: number[],
    heldState: boolean[],
    targetElements: (HTMLElement | null)[],
  ): void {
    this.rolling = false;
    this.settling = false;
    this.restQuats = [null, null, null, null, null];
    this.snapData = { finalValues, heldState, targetElements };
    this.applySnap();
  }

  private applySnap(): void {
    if (!this.snapData) return;
    const { finalValues, heldState, targetElements } = this.snapData;
    for (let i = 0; i < 5; i++) {
      const { pos, size } = this.targetFor(targetElements[i] ?? null);
      if (pos.x === 100) {
        this.diceBodies[i]!.position.set(100, 100, 100);
        this.diceMeshes[i]!.position.set(100, 100, 100);
        continue;
      }
      this.diceMeshes[i]!.scale.setScalar(size);
      const rot = this.restQuats[i] ?? this.getTargetRotation(finalValues[i]!);
      this.diceBodies[i]!.type = CANNON.Body.KINEMATIC;
      this.diceBodies[i]!.position.copy(pos as unknown as CANNON.Vec3);
      this.diceBodies[i]!.quaternion.copy(rot as unknown as CANNON.Quaternion);
      this.diceBodies[i]!.velocity.set(0, 0, 0);
      this.diceBodies[i]!.angularVelocity.set(0, 0, 0);
      this.diceMeshes[i]!.material = this.faceMaterials(!!heldState[i]);
      this.diceMeshes[i]!.position.copy(pos);
      this.diceMeshes[i]!.quaternion.copy(rot);
      this.setFaceAttr(targetElements[i] ?? null, rot);
    }
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener("resize", this.onResize);
    document.body.classList.remove("dice3d-active");
    this.renderer.dispose();
    this.container.remove();
  }

  private animate = (): void => {
    if (this.destroyed) return;
    requestAnimationFrame(this.animate);
    const rd = this.rollData;

    if (this.rolling && !this.settling && rd) {
      this.world.step(1 / 60);
      const elapsed = performance.now() - this.rollStartTime;
      const half = this.diceMeshes[rd.unheldIndices[0] ?? 0]!.scale.x / 2;

      for (const i of rd.unheldIndices) {
        if (rd.rested[i]) continue;
        this.diceMeshes[i]!.position.copy(
          this.diceBodies[i]!.position as unknown as THREE.Vector3,
        );
        this.diceMeshes[i]!.quaternion.copy(
          this.diceBodies[i]!.quaternion as unknown as THREE.Quaternion,
        );
        // Rest once it has actually settled on the felt (after a minimum tumble),
        // or when the safety cap hits.
        const settled = elapsed > MIN_ROLL_MS && this.isAtRest(this.diceBodies[i]!, half);
        if (settled || elapsed > MAX_ROLL_MS) {
          this.freezeAtRest(i);
        }
      }

      if (rd.unheldIndices.every((i) => rd.rested[i])) {
        this.settling = true;
        rd.gliding = true;
        rd.glideStart = performance.now();
      }
    } else if (this.settling && rd) {
      const t = Math.min((performance.now() - rd.glideStart) / GLIDE_MS, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      for (const i of rd.unheldIndices) {
        this.diceMeshes[i]!.position.lerpVectors(rd.restPos[i]!, rd.slotPos[i]!, ease);
        // Orientation only moves in the rare correction case (identity slerp
        // when the die already rested on the target).
        this.diceMeshes[i]!.quaternion.slerpQuaternions(rd.restQuat[i]!, rd.finalQuat[i]!, ease);
        this.diceBodies[i]!.position.copy(this.diceMeshes[i]!.position as unknown as CANNON.Vec3);
        this.diceBodies[i]!.quaternion.copy(this.diceMeshes[i]!.quaternion as unknown as CANNON.Quaternion);
      }
      if (t >= 1) {
        for (const i of rd.unheldIndices) {
          this.restQuats[i] = rd.finalQuat[i]!.clone();
          this.setFaceAttr(this.snapData?.targetElements[i] ?? null, rd.finalQuat[i]!);
        }
        this.rolling = false;
        this.settling = false;
        rd.onComplete?.();
      }
    } else if (this.snapData) {
      this.applySnap();
    }

    this.renderer.render(this.scene, this.camera);
  };

  /** Freeze die i at its resting pose and compute its honest final orientation. */
  private freezeAtRest(i: number): void {
    const rd = this.rollData!;
    const body = this.diceBodies[i]!;
    body.type = CANNON.Body.KINEMATIC;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    const restQuat = this.diceMeshes[i]!.quaternion.clone();
    rd.rested[i] = true;
    rd.restPos[i] = this.diceMeshes[i]!.position.clone();
    rd.restQuat[i] = restQuat;
    // Square up to the nearest clean, axis-aligned orientation that shows the
    // target value: this levels any resting tilt and snaps yaw to a right angle
    // so the dice land in a tidy, lined-up row (the glide slerps from the
    // physics pose into it). closestOrientation always shows `target` face-up,
    // so the die is squared without ever resting on a lie.
    rd.finalQuat[i] = this.closestOrientation(rd.finalValues[i]!, restQuat);
  }
}
