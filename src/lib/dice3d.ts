/**
 * 3D physics dice overlay — a TypeScript port of legacy/dice3d.js (Three.js +
 * cannon-es). Dice spawn above the viewport and tumble under heavy gravity
 * inside invisible walls, then settle onto the 2D dice slots showing exactly
 * the server's roll. Held dice snap in place.
 *
 * Truthfulness (the key correctness property): a die can end in 24 distinct
 * orientations with the target value face-up (the target face × 4 in-plane
 * spins). Rather than snap to one canonical orientation — which visibly flips
 * the die from whatever physics showed to the "official" value — we take over
 * while the die is still moving and settle it to the orientation *closest* to
 * its live physics pose. The correction is a small final roll, not a lie, and
 * the settled top face always equals the server value (asserted by the sim via
 * the `data-face-up` attribute mirrored onto each die's target element).
 *
 * Deliberately imperative (no React inside): the GameRoom component owns an
 * instance via ref and calls roll()/snapToState(). Call destroy() on unmount.
 */
import * as THREE from "three";
import * as CANNON from "cannon-es";

// Take over from physics while the dice are still moving (they first hit the
// floor ~425ms in), so there is never a visible "rested on the wrong face,
// then flipped" moment — the settle reads as the die's final roll.
const ROLL_MS = 700;
const SETTLE_MS = 520;

/** Cube face normals → the value printed on that face (see faceMaterials). */
const FACE_NORMALS: { n: THREE.Vector3; v: number }[] = [
  { n: new THREE.Vector3(1, 0, 0), v: 3 },
  { n: new THREE.Vector3(-1, 0, 0), v: 4 },
  { n: new THREE.Vector3(0, 1, 0), v: 1 },
  { n: new THREE.Vector3(0, -1, 0), v: 6 },
  { n: new THREE.Vector3(0, 0, 1), v: 2 },
  { n: new THREE.Vector3(0, 0, -1), v: 5 },
];

interface RollData {
  finalValues: number[];
  unheldIndices: number[];
  targets: { pos: THREE.Vector3; rot: THREE.Quaternion }[];
  onComplete?: () => void;
  startLerpQuats: THREE.Quaternion[];
  startLerpPos: THREE.Vector3[];
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
  private diceMeshes: THREE.Mesh[] = [];
  private diceBodies: CANNON.Body[] = [];
  private normalMaterials: THREE.MeshLambertMaterial[];
  private heldMaterials: THREE.MeshLambertMaterial[];
  rolling = false;
  private settling = false;
  private destroyed = false;
  private rollData: RollData | null = null;
  private snapData: SnapData | null = null;
  private rollStartTime = 0;
  private settleStartTime = 0;
  /** The 4 face-up orientations (one per in-plane spin) for each value 1–6. */
  private orientationsByValue = new Map<number, THREE.Quaternion[]>();
  /** The settled orientation per die, so idle re-snapping preserves the roll. */
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

    // Physics: floor + four invisible walls forming the tumbling arena.
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -40, 0) });
    const addPlane = (
      position: [number, number, number],
      euler: [number, number, number],
    ): void => {
      const body = new CANNON.Body({ mass: 0 });
      body.addShape(new CANNON.Plane());
      body.position.set(...position);
      body.quaternion.setFromEuler(...euler);
      this.world.addBody(body);
    };
    addPlane([0, 0, 0], [-Math.PI / 2, 0, 0]); // floor
    addPlane([0, 0, -5], [0, 0, 0]);
    addPlane([0, 0, 5], [0, Math.PI, 0]);
    addPlane([-4, 0, 0], [0, Math.PI / 2, 0]);
    addPlane([4, 0, 0], [0, -Math.PI / 2, 0]);

    const material = new CANNON.Material();
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(material, material, {
        friction: 0.3,
        restitution: 0.5,
      }),
    );

    // Ivory dice with espresso pips; held dice take a warm gold tint.
    this.normalMaterials = this.createDiceMaterials("#f4ede0", "#ddccae", "#241c14");
    this.heldMaterials = this.createDiceMaterials("#f3d98c", "#c99a34", "#3a2a0e");

    for (let i = 0; i < 5; i++) {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(geometry, this.faceMaterials(false));
      this.scene.add(mesh);
      this.diceMeshes.push(mesh);

      const body = new CANNON.Body({ mass: 1, material });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)));
      this.world.addBody(body);
      this.diceBodies.push(body);

      body.position.set(100, 100, 100); // hidden until first roll
      mesh.position.set(100, 100, 100);
    }

    this.buildOrientations();

    window.addEventListener("resize", this.onResize);
    // The 2D dice hide themselves while the overlay owns the visuals.
    document.body.classList.add("dice3d-active");
    this.animate();
  }

  /** Precompute the 4 valid face-up orientations (in-plane spins) per value. */
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

  /** The face-up orientation for `value` requiring the least rotation from `current`. */
  private closestOrientation(
    value: number,
    current: THREE.Quaternion,
  ): THREE.Quaternion {
    const candidates = this.orientationsByValue.get(value)!;
    let best = candidates[0]!;
    let bestDot = -Infinity;
    for (const c of candidates) {
      const dot = Math.abs(c.dot(current)); // |dot| handles quaternion double-cover
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

  /** Mirror the actual on-screen face onto the die's target element for tests. */
  private setFaceAttr(el: HTMLElement | null, q: THREE.Quaternion): void {
    if (el) el.dataset.faceUp = String(this.faceUp(q));
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

  roll(
    finalValues: number[],
    unheldIndices: number[],
    targetElements: (HTMLElement | null)[],
    onComplete?: () => void,
  ): void {
    this.rolling = true;
    this.settling = false;
    this.rollStartTime = performance.now();
    this.rollData = {
      finalValues,
      unheldIndices,
      targets: [],
      onComplete,
      startLerpQuats: [],
      startLerpPos: [],
    };
    // Remember for post-roll snapping (scroll/resize while idle).
    this.snapData = {
      finalValues,
      heldState: targetElements.map((_, i) => !unheldIndices.includes(i)),
      targetElements,
    };
    // Fresh roll: forget last roll's settled orientations.
    this.restQuats = [null, null, null, null, null];

    for (let i = 0; i < 5; i++) {
      const { pos, size } = this.targetFor(targetElements[i] ?? null);
      this.diceMeshes[i]!.scale.setScalar(size);
      this.diceBodies[i]!.shapes[0] = new CANNON.Box(
        new CANNON.Vec3(size / 2, size / 2, size / 2),
      );
      const rot = this.getTargetRotation(finalValues[i]!);
      this.rollData.targets.push({ pos, rot });

      if (unheldIndices.includes(i)) {
        this.diceMeshes[i]!.material = this.faceMaterials(false);
        this.diceBodies[i]!.position.set(
          (Math.random() - 0.5) * 5,
          8 + Math.random() * 4,
          (Math.random() - 0.5) * 5,
        );
        this.diceBodies[i]!.velocity.set(
          (Math.random() - 0.5) * 10,
          -15,
          (Math.random() - 0.5) * 10,
        );
        this.diceBodies[i]!.angularVelocity.set(
          Math.random() * 20,
          Math.random() * 20,
          Math.random() * 20,
        );
        this.diceBodies[i]!.type = CANNON.Body.DYNAMIC;
        this.diceBodies[i]!.wakeUp();
      } else {
        // Held die: snap in place at the canonical orientation.
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
    // A fresh non-roll state (e.g. a new turn): no settled roll to preserve.
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
      // Preserve the just-settled orientation; fall back to canonical otherwise.
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

    if (this.rolling && !this.settling && this.rollData) {
      this.world.step(1 / 60);
      for (const i of this.rollData.unheldIndices) {
        this.diceMeshes[i]!.position.copy(
          this.diceBodies[i]!.position as unknown as THREE.Vector3,
        );
        this.diceMeshes[i]!.quaternion.copy(
          this.diceBodies[i]!.quaternion as unknown as THREE.Quaternion,
        );
      }
      if (performance.now() - this.rollStartTime > ROLL_MS) {
        this.settling = true;
        this.settleStartTime = performance.now();
        for (const i of this.rollData.unheldIndices) {
          this.diceBodies[i]!.type = CANNON.Body.KINEMATIC;
          this.diceBodies[i]!.velocity.set(0, 0, 0);
          this.diceBodies[i]!.angularVelocity.set(0, 0, 0);
          this.rollData.startLerpPos[i] = this.diceMeshes[i]!.position.clone();
          this.rollData.startLerpQuats[i] = this.diceMeshes[i]!.quaternion.clone();
          // Settle to the face-up orientation nearest the live physics pose,
          // so the die's last motion reads as a natural roll into place.
          this.rollData.targets[i]!.rot = this.closestOrientation(
            this.rollData.finalValues[i]!,
            this.diceMeshes[i]!.quaternion,
          );
        }
      }
    } else if (this.settling && this.rollData) {
      const t = Math.min(
        (performance.now() - this.settleStartTime) / SETTLE_MS,
        1,
      );
      const easeT = 1 - Math.pow(1 - t, 3);
      for (const i of this.rollData.unheldIndices) {
        this.diceMeshes[i]!.position.lerpVectors(
          this.rollData.startLerpPos[i]!,
          this.rollData.targets[i]!.pos,
          easeT,
        );
        this.diceMeshes[i]!.quaternion.slerpQuaternions(
          this.rollData.startLerpQuats[i]!,
          this.rollData.targets[i]!.rot,
          easeT,
        );
        this.diceBodies[i]!.position.copy(
          this.diceMeshes[i]!.position as unknown as CANNON.Vec3,
        );
        this.diceBodies[i]!.quaternion.copy(
          this.diceMeshes[i]!.quaternion as unknown as CANNON.Quaternion,
        );
      }
      if (t >= 1) {
        // Lock in the settled orientation and publish the true on-screen face.
        for (const i of this.rollData.unheldIndices) {
          this.restQuats[i] = this.rollData.targets[i]!.rot.clone();
          this.setFaceAttr(
            this.snapData?.targetElements[i] ?? null,
            this.diceMeshes[i]!.quaternion,
          );
        }
        this.rolling = false;
        this.settling = false;
        this.rollData.onComplete?.();
      }
    } else if (this.snapData) {
      this.applySnap();
    }

    this.renderer.render(this.scene, this.camera);
  };
}
