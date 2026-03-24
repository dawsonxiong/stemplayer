import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Environment } from "@react-three/drei";
import { useRef, useMemo } from "react";
import * as THREE from "three";
import { STEMS, type StemName } from "~/lib/constants";

const STEM_NAMES = Object.keys(STEMS) as StemName[];

// ── Real Stem Player proportions ─────────────────────────
// Real device: ~6.4cm diameter, ~2.5cm thick → ratio ~1:2.5
const RADIUS = 1.3;
const HEIGHT = 1.0;
const SEGMENTS = 64;

// ── Groove dimensions ────────────────────────────────────
const GROOVE_WIDTH = 0.1;
const GROOVE_DEPTH = 0.06;
const GROOVE_LENGTH_FRAC = 0.88; // fraction of radius per arm
const CENTER_GAP = 0.17;
const LEDS_PER_ARM = 8;

// ── Cross-pattern groove positions ───────────────────────
const GROOVE_POSITIONS: { stem: StemName; rotation: number }[] = [
  { stem: "vocals", rotation: 0 },
  { stem: "bass", rotation: Math.PI },
  { stem: "drums", rotation: Math.PI / 2 },
  { stem: "other", rotation: -Math.PI / 2 },
];

// ── Props ────────────────────────────────────────────────
interface DeviceCanvasProps {
  volumes: Record<StemName, number>;
  amplitudes: Record<StemName, number>;
}

export default function DeviceCanvas({
  volumes,
  amplitudes,
}: DeviceCanvasProps) {
  return (
    <div
      className="relative w-full"
      style={{ height: "clamp(340px, 45vw, 480px)" }}
    >
      <Canvas
        camera={{ position: [0, 2.8, 3.2], fov: 32 }}
        dpr={[1, 2]}
        shadows
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={0.3} color="#f5f0e8" />
        <directionalLight
          position={[3, 5, 4]}
          intensity={1.0}
          color="#fff5e6"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-bias={-0.001}
        />
        <directionalLight
          position={[-4, 3, 2]}
          intensity={0.3}
          color="#e0e8ff"
        />
        <directionalLight
          position={[-2, 4, -5]}
          intensity={0.6}
          color="#fff0dd"
        />

        <Environment preset="studio" environmentIntensity={0.2} />

        <StemPlayerPuck volumes={volumes} amplitudes={amplitudes} />

        <ContactShadows
          position={[0, -HEIGHT / 2 - 0.01, 0]}
          opacity={0.5}
          scale={5}
          blur={2.5}
          far={2}
          resolution={512}
          color="#1a1410"
        />

        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.3}
          autoRotate
          autoRotateSpeed={0.4}
          dampingFactor={0.05}
          rotateSpeed={0.5}
        />
      </Canvas>
    </div>
  );
}

// ── Generate rounded puck profile for LatheGeometry ──────
function createPuckProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const r = RADIUS;
  const h = HEIGHT;
  const bevel = 0.15; // edge rounding radius
  const domeCurve = 0.04; // how much the top domes upward

  // Bottom center
  points.push(new THREE.Vector2(0, -h / 2));
  // Bottom edge (flat)
  points.push(new THREE.Vector2(r - bevel, -h / 2));
  // Bottom-right bevel (quarter circle)
  for (let i = 0; i <= 8; i++) {
    const angle = (Math.PI / 2) * (i / 8);
    const x = r - bevel + Math.sin(angle) * bevel;
    const y = -h / 2 + bevel - Math.cos(angle) * bevel;
    points.push(new THREE.Vector2(x, y));
  }
  // Straight side going up
  points.push(new THREE.Vector2(r, h / 2 - bevel));
  // Top-right bevel (quarter circle)
  for (let i = 0; i <= 8; i++) {
    const angle = (Math.PI / 2) * (i / 8);
    const x = r - bevel + Math.cos(angle) * bevel;
    const y = h / 2 - bevel + Math.sin(angle) * bevel;
    points.push(new THREE.Vector2(x, y));
  }
  // Top surface with gentle dome curve (from edge to center)
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = (r - bevel) * (1 - t);
    // Parabolic dome: highest at center
    const y = h / 2 + domeCurve * (1 - (1 - t) * (1 - t));
    points.push(new THREE.Vector2(x, y));
  }

  return points;
}

// ── Main puck assembly ───────────────────────────────────
function StemPlayerPuck({ volumes, amplitudes }: DeviceCanvasProps) {
  const geometry = useMemo(() => {
    const profile = createPuckProfile();
    const geo = new THREE.LatheGeometry(profile, SEGMENTS);
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <group>
      {/* Puck body — lathe geometry for rounded edges + domed top */}
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color="#D2BFA5"
          roughness={0.78}
          metalness={0.02}
          envMapIntensity={0.25}
        />
      </mesh>

      {/* Center button — slightly raised */}
      <CenterButton />

      {/* Cross-pattern groove arms with discrete LED dots */}
      {GROOVE_POSITIONS.map(({ stem, rotation }) => (
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

// ── Center button ────────────────────────────────────────
function CenterButton() {
  const btnRadius = CENTER_GAP * 0.65;
  return (
    <mesh position={[0, HEIGHT / 2 + 0.045, 0]}>
      <cylinderGeometry args={[btnRadius, btnRadius, 0.025, 32]} />
      <meshStandardMaterial
        color="#C8B898"
        roughness={0.65}
        metalness={0.03}
      />
    </mesh>
  );
}

// ── Single groove arm with 8 discrete LED dots ───────────
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
  const stem = STEMS[stemName];
  const armLength = RADIUS * GROOVE_LENGTH_FRAC - CENTER_GAP;
  const armCenter = CENTER_GAP + armLength / 2;

  // Which LEDs are lit (volume 0-1 maps to 0-8 LEDs)
  const litCount = Math.round(volume * LEDS_PER_ARM);

  const grooveY = HEIGHT / 2 + 0.04 - GROOVE_DEPTH / 2;

  return (
    <group rotation={[0, rotation, 0]}>
      {/* Dark groove channel */}
      <mesh position={[0, grooveY, armCenter]}>
        <boxGeometry args={[GROOVE_WIDTH, GROOVE_DEPTH, armLength]} />
        <meshStandardMaterial color="#1a1410" roughness={0.92} />
      </mesh>

      {/* 8 discrete LED dots */}
      {Array.from({ length: LEDS_PER_ARM }).map((_, i) => (
        <LEDDot
          key={i}
          index={i}
          lit={i < litCount}
          colour={stem.colour}
          armLength={armLength}
          grooveY={grooveY}
          amplitude={amplitude}
        />
      ))}
    </group>
  );
}

// ── Individual LED dot ───────────────────────────────────
function LEDDot({
  index,
  lit,
  colour,
  armLength,
  grooveY,
  amplitude,
}: {
  index: number;
  lit: boolean;
  colour: string;
  armLength: number;
  grooveY: number;
  amplitude: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  // Position: evenly spaced from center outward
  const spacing = armLength / LEDS_PER_ARM;
  const z = CENTER_GAP + spacing * (index + 0.5);
  const dotSize = GROOVE_WIDTH * 0.55;

  // Animate glow intensity with audio
  useFrame(() => {
    if (!lit) return;
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.5 + amplitude * 4.0;
    }
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.2 + amplitude * 0.35;
    }
  });

  if (!lit) {
    // Unlit dot — dark, barely visible
    return (
      <mesh position={[0, grooveY + GROOVE_DEPTH * 0.3, z]}>
        <sphereGeometry args={[dotSize * 0.4, 8, 8]} />
        <meshStandardMaterial
          color="#2a2420"
          roughness={0.9}
          transparent
          opacity={0.5}
        />
      </mesh>
    );
  }

  return (
    <group>
      {/* Lit LED dot — sphere for soft look */}
      <mesh ref={meshRef} position={[0, grooveY + GROOVE_DEPTH * 0.3, z]}>
        <sphereGeometry args={[dotSize * 0.45, 12, 12]} />
        <meshStandardMaterial
          color={colour}
          emissive={colour}
          emissiveIntensity={2.0}
          roughness={0.2}
          toneMapped={false}
        />
      </mesh>

      {/* Diffused glow halo (simulates light through silicone) */}
      <mesh
        ref={glowRef}
        position={[0, grooveY + GROOVE_DEPTH * 0.5, z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[dotSize * 2.5, 16]} />
        <meshStandardMaterial
          color={colour}
          emissive={colour}
          emissiveIntensity={2.5}
          transparent
          opacity={0.25}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
