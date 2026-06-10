import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

import type { AffectedRegion, LobeRegion, SeverityLevel } from '@core/models';

const LOBE_IDS: LobeRegion[] = [
  'right_upper',
  'right_middle',
  'right_lower',
  'left_upper',
  'left_lower',
];

const NON_LOBE_REGIONS: LobeRegion[] = [
  'bilateral',
  'pleural',
  'mediastinal',
  'airways',
];

/** BodyParts3D / Anatomography FMA codes for the five lobes. The five STL
 * files live under `/models/lungs/<FMA>.stl` and are licensed CC BY-SA 2.1 JP. */
const LOBE_FMA: Record<LobeRegion, string | null> = {
  right_upper: 'FMA7333',
  right_middle: 'FMA7383',
  right_lower: 'FMA7337',
  left_upper: 'FMA7370',
  left_lower: 'FMA7371',
  bilateral: null,
  pleural: null,
  mediastinal: null,
  airways: null,
};

const SEVERITY_COLOR: Record<SeverityLevel, number> = {
  mild: 0xfacc15,
  moderate: 0xf59e0b,
  severe: 0xef4444,
};

/** Halo opacity per severity at the centroid (peak). Falloff is squared so
 * the saturated paint-cloud core fades smoothly into adjacent regions. */
const SEVERITY_HALO_OPACITY: Record<SeverityLevel, number> = {
  mild: 0.85,
  moderate: 1.0,
  severe: 1.0,
};

/** Healthy-lung tint applied when a lobe is not affected. Light/dark variants
 * are picked at paint time based on the `app-dark` class on <html>. */
const UNAFFECTED_COLOR_LIGHT = 0xd1fae5; // emerald-100 (paler so paint dominates)
const UNAFFECTED_COLOR_DARK = 0x14532d; // emerald-900

@Component({
  selector: 'app-lung-diagram',
  imports: [TranslatePipe],
  templateUrl: './lung-diagram.html',
  styleUrl: './lung-diagram.scss',
})
export class LungDiagram implements AfterViewInit, OnDestroy {
  private readonly zone = inject(NgZone);

  readonly regions = input<AffectedRegion[]>([]);

  @ViewChild('canvas', { static: true })
  protected canvasRef!: ElementRef<HTMLCanvasElement>;

  // Loading state for the heavy STL fetch (~10 MB total).
  protected readonly modelLoading = signal(true);
  protected readonly modelError = signal<string | null>(null);

  // ---- Three.js state ----
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private renderer?: THREE.WebGLRenderer;
  private controls?: OrbitControls;
  private animationId: number | null = null;
  private resizeObserver?: ResizeObserver;
  private readonly lobeMeshes = new Map<LobeRegion, THREE.Mesh>();
  /** Soft halo sphere per lobe — drives the "diffuse fog" overlay. The lobe
   * mesh keeps the healthy green tint; the halo on top conveys severity with
   * a radial-alpha falloff so adjacent affected lobes blend visually. */
  private readonly lobeHalos = new Map<LobeRegion, THREE.Mesh>();
  private readonly lobeHaloMaterials = new Map<LobeRegion, THREE.ShaderMaterial>();
  private haloGeometry?: THREE.SphereGeometry;
  /** Outer group: applies world rotation/scale around scene origin. */
  private readonly lungGroup = new THREE.Group();
  /** Inner group: holds the meshes; we translate this so the model's centroid
   * sits at (0,0,0) in lungGroup-local space, decoupling centering from
   * rotation/scale on the outer group. */
  private readonly lungInner = new THREE.Group();

  // ---- Side-panel computeds ----

  protected readonly lobeIds = LOBE_IDS;
  protected readonly nonLobeRegionIds = NON_LOBE_REGIONS;

  protected readonly bilateralSeverity = computed<SeverityLevel | null>(() => {
    const r = this.regions().find((x) => x.region === 'bilateral');
    return r?.severity ?? null;
  });

  /** Severity level used to tint lobes that have no direct finding. We treat
   * `bilateral`, `airways`, `pleural`, and `mediastinal` as "whole-lung"
   * findings — the side panel still shows the precise region, but the 3D
   * model can't render airways or pleura as discrete meshes, so failing to
   * tint anything for those findings looks like a healthy lung to the doctor.
   * Worst-of severity wins so a severe airway obstruction lights up red. */
  protected readonly globalSeverity = computed<SeverityLevel | null>(() => {
    const globalRegionTypes: LobeRegion[] = [
      'bilateral',
      'airways',
      'pleural',
      'mediastinal',
    ];
    const sevs = this.regions()
      .filter((r) => globalRegionTypes.includes(r.region))
      .map((r) => r.severity);
    if (sevs.length === 0) return null;
    return this.maxSeverity(sevs);
  });

  protected readonly findingsByRegion = computed<Map<LobeRegion, AffectedRegion[]>>(() => {
    const map = new Map<LobeRegion, AffectedRegion[]>();
    for (const r of this.regions()) {
      const list = map.get(r.region) ?? [];
      list.push(r);
      map.set(r.region, list);
    }
    return map;
  });

  protected readonly otherFindings = computed<AffectedRegion[]>(() =>
    this.regions().filter((r) => NON_LOBE_REGIONS.includes(r.region)),
  );

  protected readonly lobeFindings = computed<AffectedRegion[]>(() =>
    this.regions().filter((r) => !NON_LOBE_REGIONS.includes(r.region)),
  );

  constructor() {
    // Re-paint materials whenever the regions input changes.
    effect(() => {
      this.regions();
      this.bilateralSeverity();
      this.globalSeverity();
      this.applyLobeMaterials();
    });
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.initThree();
      this.loadLobes();
    });
  }

  ngOnDestroy(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.lobeMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.lobeMeshes.clear();
    this.lobeHaloMaterials.forEach((mat) => mat.dispose());
    this.lobeHaloMaterials.clear();
    this.lobeHalos.clear();
    this.haloGeometry?.dispose();
    this.renderer?.dispose();
  }

  // ---- Three.js setup ----

  private initThree(): void {
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement!;
    const { clientWidth: w, clientHeight: h } = parent;

    this.scene = new THREE.Scene();
    this.lungGroup.add(this.lungInner);
    this.scene.add(this.lungGroup);

    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
    this.camera.position.set(0, 0.2, 6);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);

    this.addLights();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 10;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.addEventListener('start', () => {
      if (this.controls) this.controls.autoRotate = false;
    });

    this.startLoop();

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(parent);
  }

  private addLights(): void {
    if (!this.scene) return;
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(4, 6, 5);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xfecaca, 0.45);
    rim.position.set(-4, 2, -3);
    this.scene.add(rim);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x1e293b, 0.4));
  }

  private async loadLobes(): Promise<void> {
    const loader = new STLLoader();
    try {
      const lobeEntries = LOBE_IDS.map((lobe) => ({ lobe, fma: LOBE_FMA[lobe]! }));

      const geometries = await Promise.all(
        lobeEntries.map(({ fma }) => loader.loadAsync(`/models/lungs/${fma}.stl`)),
      );

      // Build one mesh per lobe, parented to the inner group so that the
      // outer group can freely rotate/scale around the scene origin.
      const combinedBox = new THREE.Box3();
      lobeEntries.forEach(({ lobe }, i) => {
        const geom = geometries[i];
        geom.computeVertexNormals();
        geom.computeBoundingBox();
        if (geom.boundingBox) combinedBox.union(geom.boundingBox);

        const mat = new THREE.MeshStandardMaterial({
          color: UNAFFECTED_COLOR_LIGHT,
          roughness: 0.55,
          metalness: 0.05,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.userData['lobe'] = lobe;
        this.lungInner.add(mesh);
        this.lobeMeshes.set(lobe, mesh);
      });

      // Build per-lobe halo overlays. Each halo is a sphere centered on the
      // lobe's bounding-box centroid with a radial-alpha shader so the
      // strongest color is at the centroid and softly fades at the lobe edge,
      // bleeding into adjacent regions. This produces the diffuse "fog"
      // appearance the doctor expects when findings are not sharply
      // delimited (e.g. interstitial disease).
      this.haloGeometry = new THREE.SphereGeometry(1, 32, 32);
      lobeEntries.forEach(({ lobe }, i) => {
        const geom = geometries[i];
        const lobeBox = geom.boundingBox ?? new THREE.Box3().setFromBufferAttribute(
          geom.getAttribute('position') as THREE.BufferAttribute,
        );
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        lobeBox.getCenter(center);
        lobeBox.getSize(size);

        const haloMat = new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: new THREE.Color(0xffffff) },
            uOpacity: { value: 0 },
          },
          vertexShader: /* glsl */ `
            varying vec3 vLocal;
            void main() {
              vLocal = position;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          // Radial alpha: peak at the centroid, smooth falloff to zero at the
          // sphere edge. NB: GLSL smoothstep(edge0, edge1, x) requires
          // edge0 < edge1 — using (0.0, 1.0) and inverting gives a defined
          // result, unlike (1.0, 0.0) which is undefined and reads as black
          // on most drivers. The squared falloff keeps a saturated core and
          // a long, painterly fade — the paint-cloud look the doctor expects
          // for diffuse disease.
          fragmentShader: /* glsl */ `
            uniform vec3 uColor;
            uniform float uOpacity;
            varying vec3 vLocal;
            void main() {
              float d = clamp(length(vLocal), 0.0, 1.0);
              float t = 1.0 - smoothstep(0.0, 1.0, d);
              float a = t * t * uOpacity;
              gl_FragColor = vec4(uColor, a);
            }
          `,
          transparent: true,
          depthWrite: false,
          blending: THREE.NormalBlending,
          side: THREE.DoubleSide,
        });

        const halo = new THREE.Mesh(this.haloGeometry!, haloMat);
        halo.position.copy(center);
        // Cover the lobe and bleed past its boundary so adjacent affected
        // lobes blend visually instead of meeting at a hard line.
        const radius = Math.max(size.x, size.y, size.z) * 0.95;
        halo.scale.setScalar(radius);
        halo.renderOrder = 2; // draw after the opaque lobe meshes
        this.lungInner.add(halo);
        this.lobeHalos.set(lobe, halo);
        this.lobeHaloMaterials.set(lobe, haloMat);
      });

      // Center the model around (0,0,0) in inner-group local coords by
      // translating the inner group by the negated centroid of the raw
      // anatomical mesh data.
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      combinedBox.getCenter(center);
      combinedBox.getSize(size);
      this.lungInner.position.copy(center).multiplyScalar(-1);

      // BodyParts3D coordinate system: anatomical mm with X = right→left of
      // the body, Y = anterior→posterior, Z = inferior→superior. Rotate so
      // Z (caudo-cranial) maps to Three.js +Y (up) and we view the body
      // from the front.
      this.lungGroup.rotation.x = -Math.PI / 2;
      this.lungGroup.rotation.y = 0;

      // Scale so the longest axis becomes ~4 units, fitting nicely in the
      // 38° fov camera at distance 6.
      const targetSize = 4;
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      this.lungGroup.scale.setScalar(targetSize / maxDim);

      this.applyLobeMaterials();
      this.zone.run(() => this.modelLoading.set(false));
    } catch (err) {
      console.error('Failed to load lung STLs', err);
      this.zone.run(() => {
        this.modelError.set('Model yuklanmadi');
        this.modelLoading.set(false);
      });
    }
  }

  private startLoop(): void {
    const tick = () => {
      this.animationId = requestAnimationFrame(tick);
      this.controls?.update();
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    };
    tick();
  }

  private onResize(): void {
    if (!this.renderer || !this.camera) return;
    const parent = this.canvasRef.nativeElement.parentElement!;
    const { clientWidth: w, clientHeight: h } = parent;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- Severity → material color ----

  private applyLobeMaterials(): void {
    if (this.lobeMeshes.size === 0) return;
    const isDark = document.documentElement.classList.contains('app-dark');
    const baseColor = isDark ? UNAFFECTED_COLOR_DARK : UNAFFECTED_COLOR_LIGHT;

    for (const lobe of LOBE_IDS) {
      const mesh = this.lobeMeshes.get(lobe);
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const sev = this.severityFor(lobe);
      // Lobe mesh stays a soft healthy green; the halo overlay carries the
      // severity signal. We only nudge the lobe with a faint emissive tint
      // so the affected lobe still reads as "warm" even when viewed from
      // an angle that hides the halo.
      mat.color.setHex(baseColor);
      if (sev) {
        // Lobe mesh keeps a faint severity tint so the affected region
        // reads as "warm" even from angles where the halo is occluded.
        mat.emissive.setHex(SEVERITY_COLOR[sev]);
        mat.emissiveIntensity = sev === 'severe' ? 0.45 : sev === 'moderate' ? 0.32 : 0.2;
        mat.opacity = 0.85;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
        mat.opacity = 0.8;
      }
      mat.needsUpdate = true;

      // Halo: this is what creates the soft fog over the affected region.
      const haloMat = this.lobeHaloMaterials.get(lobe);
      if (haloMat) {
        if (sev) {
          (haloMat.uniforms['uColor'].value as THREE.Color).setHex(SEVERITY_COLOR[sev]);
          haloMat.uniforms['uOpacity'].value = SEVERITY_HALO_OPACITY[sev];
        } else {
          haloMat.uniforms['uOpacity'].value = 0;
        }
      }
    }
  }

  // ---- Helpers used by the side-panel template ----

  protected severityFor(lobe: LobeRegion): SeverityLevel | null {
    const direct = this.findingsByRegion().get(lobe);
    if (direct && direct.length > 0) {
      return this.maxSeverity(direct.map((r) => r.severity));
    }
    // Fall through to whole-lung findings (bilateral / airways / pleural /
    // mediastinal). These don't map to a single lobe, so we tint all lobes
    // with the worst severity among them — the side panel still names which
    // specific region was reported.
    return this.globalSeverity();
  }

  protected severityChipClass(severity: SeverityLevel): string {
    if (severity === 'severe')
      return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
    if (severity === 'moderate')
      return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300';
  }

  protected modalityIcon(modality: string): string {
    if (modality === 'audio') return 'pi-microphone';
    if (modality === 'parameters') return 'pi-chart-line';
    return 'pi-image';
  }

  private maxSeverity(severities: SeverityLevel[]): SeverityLevel {
    if (severities.includes('severe')) return 'severe';
    if (severities.includes('moderate')) return 'moderate';
    return 'mild';
  }
}
