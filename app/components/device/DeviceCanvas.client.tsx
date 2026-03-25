import { Canvas, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  ContactShadows,
  Environment,
} from "@react-three/drei";
import { useRef, useMemo } from "react";
import * as THREE from "three";
import { STEMS, type StemName } from "~/lib/constants";

const STEM_NAMES = Object.keys(STEMS) as StemName[];

// ── Dimensions ───────────────────────────────────────────
const A = 1.15; // equatorial radius
const B = 0.48; // polar radius (half-height)
const SEGMENTS = 96;

// ── Grooves ──────────────────────────────────────────────
const GROOVE_WIDTH = 0.045; // very thin score line
const GROOVE_ARM_FRAC = 0.80;
const CENTER_GAP = 0.14;
const LEDS_PER_ARM = 8;

const GROOVE_MAP: { stem: StemName; rotation: number }[] = [
  { stem: "vocals", rotation: 0 },
  { stem: "bass", rotation: Math.PI },
  { stem: "drums", rotation: Math.PI / 2 },
  { stem: "other", rotation: -Math.PI / 2 },
];

interface Props {
  volumes: Record<StemName, number>;
  amplitudes: Record<StemName, number>;
}

// ── Surface Y at radius r ────────────────────────────────
function surfaceY(r: number): number {
  const clamped = Math.min(Math.abs(r), A * 0.999);
  return B * Math.sqrt(1 - (clamped * clamped) / (A * A));
}

// ── Canvas ───────────────────────────────────────────────
export default function DeviceCanvas({ volumes, amplitudes }: Props) {
  return (
    <div className="relative w-full" style={{ height: "clamp(340px, 45vw, 480px)" }}>
      <Canvas
        camera={{ position: [0, 2.2, 2.8], fov: 28 }}
        dpr={[1, 2]}
        shadows
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
        style={{ background: "transparent" }}
      >
        {/* Soft warm ambient — flat product lighting */}
        <ambientLight intensity={0.6} color="#f5ede0" />

        {/* Key — soft, broad, directly above-front */}
        <directionalLight
          position={[1, 5, 2]}
          intensity={0.7}
          color="#fff8f0"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-bias={-0.0003}
        />

        {/* Fill — very subtle, opposite side */}
        <directionalLight position={[-3, 3, 1]} intensity={0.15} color="#e8e0d8" />

        {/* Rim — subtle edge definition */}
        <directionalLight position={[0, 2, -4]} intensity={0.2} color="#f0e8dc" />

        <Environment preset="apartment" environmentIntensity={0.08} />

        <StemPlayerDevice volumes={volumes} amplitudes={amplitudes} />

        <ContactShadows
          position={[0, -B - 0.015, 0]}
          opacity={0.25}
          scale={3.5}
          blur={3}
          far={1.2}
          resolution={512}
          color="#8a7e6e"
        />

        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.4}
          autoRotate
          autoRotateSpeed={0.3}
          dampingFactor={0.05}
          rotateSpeed={0.5}
        />
      </Canvas>
    </div>
  );
}

// ── Spheroid profile ─────────────────────────────────────
function createProfile(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];

  // Flat bottom spot (so it sits on a surface)
  const flatR = A * 0.2;
  pts.push(new THREE.Vector2(0, -B));
  pts.push(new THREE.Vector2(flatR, -B));

  // Bottom elliptical arc
  for (let i = 1; i <= 30; i++) {
    const angle = (Math.PI / 2) * (i / 30);
    const r = A * Math.sin(angle);
    const y = -B * Math.cos(angle);
    if (r > flatR) pts.push(new THREE.Vector2(r, y));
  }

  // Top half — pure ellipse
  for (let i = 1; i <= 40; i++) {
    const angle = (Math.PI / 2) * (i / 40);
    const r = A * Math.cos(angle);
    const y = B * Math.sin(angle);
    pts.push(new THREE.Vector2(r, y));
  }

  return pts;
}

// ── Device assembly ──────────────────────────────────────
function StemPlayerDevice({ volumes, amplitudes }: Props) {
  const geo = useMemo(() => {
    const g = new THREE.LatheGeometry(createProfile(), SEGMENTS);
    g.computeVertexNormals();
    return g;
  }, []);

  return (
    <group>
      {/* Body — matte silicone */}
      <mesh geometry={geo} castShadow receiveShadow>
        <meshPhysicalMaterial
          color="#C9AB94"
          roughness={0.9}
          metalness={0.0}
          clearcoat={0.02}
          clearcoatRoughness={1.0}
          sheen={0.15}
          sheenColor="#D8C4B0"
          sheenRoughness={0.85}
          envMapIntensity={0.08}
        />
      </mesh>

      {/* Center button */}
      <mesh position={[0, surfaceY(0) + 0.006, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.012, 32]} />
        <meshPhysicalMaterial
          color="#C0A48C"
          roughness={0.85}
          metalness={0.0}
          sheen={0.1}
          sheenColor="#D0B8A4"
        />
      </mesh>

      {/* Grooves + LEDs */}
      {GROOVE_MAP.map(({ stem, rotation }) => (
        <GrooveArm
          key={stem}
          stemName={stem}
          rotation={rotation}
          volume={volumes[stem]}
          amplitude={amplitudes[stem]}
        />
      ))}
    </group>
  );
}

// ── Groove arm ───────────────────────────────────────────
function GrooveArm({
  stemName,
  rotation,
  volume,
  amplitude,
}: {
  stemName: StemName;
  rotation: number;
  volume: number;
  amplitude: number;
}) {
  const armLen = A * GROOVE_ARM_FRAC - CENTER_GAP;
  const litCount = Math.round(volume * LEDS_PER_ARM);
  const colour = STEMS[stemName].colour;

  // Build smooth groove ribbon following the surface
  const grooveGeo = useMemo(() => {
    const segs = 32;
    const hw = GROOVE_WIDTH / 2;
    const verts: number[] = [];
    const idx: number[] = [];

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const d = CENTER_GAP + armLen * t;
      const y = surfaceY(d) - 0.008; // barely recessed
      verts.push(-hw, y, d);
      verts.push(hw, y, d);
    }

    for (let i = 0; i < segs; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [armLen]);

  return (
    <group rotation={[0, rotation, 0]}>
      {/* Groove — same hue as body, just slightly darker */}
      <mesh geometry={grooveGeo}>
        <meshStandardMaterial
          color="#B89E8A"
          roughness={0.95}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Small notch/bump at outer end of groove */}
      <GrooveEndCap distance={CENTER_GAP + armLen} />

      {/* LED dots */}
      {Array.from({ length: LEDS_PER_ARM }).map((_, i) => {
        const d = CENTER_GAP + (armLen / LEDS_PER_ARM) * (i + 0.5);
        return (
          <LED
            key={i}
            lit={i < litCount}
            distance={d}
            colour={colour}
            amplitude={amplitude}
          />
        );
      })}
    </group>
  );
}

// ── Groove end cap (small notch at the tip) ──────────────
function GrooveEndCap({ distance }: { distance: number }) {
  const y = surfaceY(distance) - 0.004;
  return (
    <mesh position={[0, y, distance]}>
      <boxGeometry args={[GROOVE_WIDTH * 1.4, 0.01, 0.025]} />
      <meshStandardMaterial color="#B89E8A" roughness={0.95} />
    </mesh>
  );
}

// ── Single LED ───────────────────────────────────────────
function LED({
  lit,
  distance,
  colour,
  amplitude,
}: {
  lit: boolean;
  distance: number;
  colour: string;
  amplitude: number;
}) {
  const coreRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);

  const sy = surfaceY(distance);
  const dotY = sy - 0.003;
  const r = 0.012; // very small dot

  useFrame(() => {
    if (!lit) return;
    const p = 0.8 + amplitude * 1.5;
    if (coreRef.current) {
      (coreRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = p;
    }
    if (glowRef.current) {
      (glowRef.current.material as THREE.MeshStandardMaterial).opacity =
        0.12 + amplitude * 0.18;
    }
    if (haloRef.current) {
      (haloRef.current.material as THREE.MeshStandardMaterial).opacity =
        0.04 + amplitude * 0.06;
    }
  });

  if (!lit) {
    // Unlit — faintest hint of a dot
    return (
      <mesh position={[0, dotY, distance]}>
        <sphereGeometry args={[r * 0.6, 6, 6]} />
        <meshStandardMaterial color="#B0A090" roughness={0.95} transparent opacity={0.08} />
      </mesh>
    );
  }

  return (
    <group>
      {/* Core dot */}
      <mesh ref={coreRef} position={[0, dotY, distance]}>
        <sphereGeometry args={[r, 8, 8]} />
        <meshStandardMaterial
          color={colour}
          emissive={colour}
          emissiveIntensity={0.8}
          roughness={0.2}
          toneMapped={false}
        />
      </mesh>

      {/* Inner glow — tight diffusion through silicone */}
      <mesh
        ref={glowRef}
        position={[0, sy + 0.001, distance]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[r * 2.0, 12]} />
        <meshStandardMaterial
          color={colour}
          emissive={colour}
          emissiveIntensity={1.0}
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Outer halo — wide subtle bleed */}
      <mesh
        ref={haloRef}
        position={[0, sy + 0.002, distance]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[r * 4.5, 16]} />
        <meshStandardMaterial
          color={colour}
          emissive={colour}
          emissiveIntensity={0.6}
          transparent
          opacity={0.05}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
