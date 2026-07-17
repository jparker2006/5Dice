/**
 * 3D physics dice overlay — a TypeScript port of legacy/dice3d.js (Three.js +
 * cannon-es). The math and choreography are preserved from the original:
 * dice spawn above the viewport, tumble under heavy gravity inside invisible
 * walls for ~1.5s, then lerp-settle onto the 2D dice slots with the correct
 * face up. Held dice snap in place with a blue tint.
 *
 * Deliberately imperative (no React inside): the Dice3DOverlay component owns
 * an instance via ref and calls roll()/snapToState(). Consumers must call
 * destroy() on unmount.
 */
import * as THREE from "three";
import * as CANNON from "cannon-es";

const ROLL_MS = 1500;
const SETTLE_MS = 500;

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

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
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

    this.normalMaterials = this.createDiceMaterials("#f8f8f8", "#e0e0e0", "#222222");
    this.heldMaterials = this.createDiceMaterials("#007BFF", "#0056b3", "#ffffff");

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

    window.addEventListener("resize", this.onResize);
    // The 2D dice hide themselves while the overlay owns the visuals.
    document.body.classList.add("dice3d-active");
    this.animate();
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
        this.diceMeshes[i]!.material = this.faceMaterials(true);
        this.diceBodies[i]!.type = CANNON.Body.KINEMATIC;
        this.diceBodies[i]!.position.copy(pos as unknown as CANNON.Vec3);
        this.diceBodies[i]!.quaternion.copy(rot as unknown as CANNON.Quaternion);
        this.diceBodies[i]!.velocity.set(0, 0, 0);
        this.diceBodies[i]!.angularVelocity.set(0, 0, 0);
        this.diceMeshes[i]!.position.copy(pos);
        this.diceMeshes[i]!.quaternion.copy(rot);
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
      const rot = this.getTargetRotation(finalValues[i]!);
      this.diceBodies[i]!.type = CANNON.Body.KINEMATIC;
      this.diceBodies[i]!.position.copy(pos as unknown as CANNON.Vec3);
      this.diceBodies[i]!.quaternion.copy(rot as unknown as CANNON.Quaternion);
      this.diceBodies[i]!.velocity.set(0, 0, 0);
      this.diceBodies[i]!.angularVelocity.set(0, 0, 0);
      this.diceMeshes[i]!.material = this.faceMaterials(!!heldState[i]);
      this.diceMeshes[i]!.position.copy(pos);
      this.diceMeshes[i]!.quaternion.copy(rot);
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
