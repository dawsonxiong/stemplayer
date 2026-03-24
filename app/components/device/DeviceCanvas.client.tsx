import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Environment } from "@react-three/drei";
import { useRef, useMemo } from "react";
import * as THREE from "three";
import { STEMS, type StemName } from "~/lib/constants";

const STEM_NAMES = Object.keys(STEMS) as StemName[];

// ── Real Stem Player proportions ─────────────────────────
// The real device is a squished sphere / thick lens shape
// ~6.4cm diameter, ~2.5cm thick, very rounded edges
const RADIUS = 1.3;
const HEIGHT = 1.05;
const SEGMENTS = 64;

// ── Groove dimensions (very shallow, scored into surface) ─
const GROOVE_WIDTH = 0.075;
const GROOVE_DEPTH = 0.035;
const GROOVE_LENGTH_FRAC = 0.85;
const CENTER_GAP = 0.16;
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
        camera={{ position: [0, 2.5, 3.0], fov: 32 }}
        dpr={[1, 2]}
        shadows
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
        style={{ background: "transparent" }}
      >
        {/* Warm ambient */}
        <ambientLight intensity={0.4} color="#f0e8dc" />

        {/* Key light — warm, soft, upper-left */}
        <directionalLight
          position={[2.5, 4, 3]}
          intensity={0.9}
          color="#fff2e0"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-bias={-0.0005}
        />

        {/* Fill — cool, opposite side */}
        <directionalLight
          position={[-3, 2.5, 1.5]}
          intensity={0.25}
          color="#dce4f0"
        />

        {/* Rim — back edge highlight */}
        <directionalLight
          position={[-1, 3, -4]}
          intensity={0.5}
          color="#f5ebe0"
        />

        <Environment preset="apartment" environmentIntensity={0.15} />

        <StemPlayerPuck volumes={volumes} amplitudes={amplitudes} />

        <ContactShadows
          position={[0, -HEIGHT / 2 - 0.02, 0]}
          opacity={0.4}
          scale={4.5}
          blur={2.5}
          far={1.5}
          resolution={512}
          color="#2a2018"
        />

        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 5}
          maxPolarAngle={Math.PI / 2.2}
          autoRotate
          autoRotateSpeed={0.35}
          dampingFactor={0.05}
          rotateSpeed={0.5}
        />
      </Canvas>
    </div>
  );
}

// ── Generate egg/lens shaped profile ─────────────────────
// The real device looks like a squished sphere — very rounded
// top dome, generous edge radius, flat-ish bottom
function createPuckProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const r = RADIUS;
  const h = HEIGHT;

  // Generate a lens/capsule-like profile using an elliptical arc
  // Top half: pronounced dome
  // Bottom half: flatter, nearly flat base
  const topDome = 0.35; // how much the top bulges upward
  const bottomCurve = 0.08; // slight bottom rounding
  const edgeRadius = 0.28; // generous edge rounding

  const steps = 40;

  // Bottom center
  points.push(new THREE.Vector2(0, -h / 2 + bottomCurve));

  // Bottom surface (nearly flat, slight curve)
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const x = t * (r - edgeRadius);
    const y = -h / 2 + bottomCurve * (1 - t * t);
    points.push(new THREE.Vector2(x, y));
  }

  // Bottom-right edge (quarter ellipse)
  for (let i = 0; i <= 10; i++) {
    const angle = (Math.PI / 2) * (i / 10);
    const x = r - edgeRadius + Math.sin(angle) * edgeRadius;
    const y = -h / 2 + edgeRadius - Math.cos(angle) * edgeRadius;
    points.push(new THREE.Vector2(x, y));
  }

  // Side wall (short, transitions to top)
  const sideTop = h / 2 - edgeRadius * 0.8;
  points.push(new THREE.Vector2(r, sideTop));

  // Top-right edge into dome (smooth blend)
  for (let i = 0; i <= 12; i++) {
    const angle = (Math.PI / 2) * (i / 12);
    const x = r - edgeRadius * 0.8 + Math.cos(angle) * edgeRadius * 0.8;
    const y = sideTop + Math.sin(angle) * edgeRadius * 0.8;
    points.push(new THREE.Vector2(x, y));
  }

  // Top dome surface (gentle parabolic dome from edge to center)
  const domeStart = r - edgeRadius * 0.8;
  const domeBaseY = sideTop + edgeRadius * 0.8;
  for (let i = 1; i <= 16; i++) {
    const t = i / 16; // 0 at edge, 1 at center
    const x = domeStart * (1 - t);
    // Parabolic dome: highest at center
    const y = domeBaseY + topDome * (1 - (1 - t) * (1 - t));
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

  // Real device color: warm pinkish-tan (flesh-tone silicone)
  // From reference photos: approximately #C4A48E to #C9AD96
  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color="#C7A994"
          roughness={0.82}
          metalness={0.01}
          envMapIntensity={0.2}
        />
      </mesh>

      <CenterButton />

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

// ── Center button — small, slightly raised ───────────────
function CenterButton() {
  const btnRadius = CENTER_GAP * 0.55;
  // Position on the dome surface
  const profile = createPuckProfile();
  const topY = profile[profile.length - 1].y;

  return (
    <mesh position={[0, topY + 0.01, 0]}>
      <cylinderGeometry args={[btnRadius, btnRadius, 0.02, 32]} />
      <meshStandardMaterial
        color="#BFA28C"
        roughness={0.7}
        metalness={0.01}
      />
    </mesh>
  );
}

// ── Single groove arm with discrete LED dots ─────────────
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
  const litCount = Math.round(volume * LEDS_PER_ARM);

  // Get dome top Y — grooves are recessed INTO the surface
  const profile = createPuckProfile();
  const topY = profile[profile.length - 1].y;
  const grooveY = topY - GROOVE_DEPTH * 0.8;

  return (
    <group rotation={[0, rotation, 0]}>
      {/* Groove channel — subtle recessed score line */}
      <mesh position={[0, grooveY, armCenter]}>
        <boxGeometry args={[GROOVE_WIDTH, GROOVE_DEPTH, armLength]} />
        <meshStandardMaterial
          color="#9C8978"
          roughness={0.95}
          metalness={0}
        />
      </mesh>

      {/* 8 discrete LED dots — soft diffused glow through silicone */}
      {Array.from({ length: LEDS_PER_ARM }).map((_, i) => (
        <LEDDot
          key={i}
          index={i}
          lit={i < litCount}
          colour={stem.colour}
          armLength={armLength}
          grooveY={grooveY}
          topY={topY}
          amplitude={amplitude}
        />
      ))}
    </group>
  );
}

// ── Individual LED dot (soft, diffused through silicone) ──
function LEDDot({
  index,
  lit,
  colour,
  armLength,
  grooveY,
  topY,
  amplitude,
}: {
  index: number;
  lit: boolean;
  colour: string;
  armLength: number;
  grooveY: number;
  topY: number;
  amplitude: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  const spacing = armLength / LEDS_PER_ARM;
  const z = CENTER_GAP + spacing * (index + 0.5);
  const dotRadius = GROOVE_WIDTH * 0.28;

  useFrame(() => {
    if (!lit) return;
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.2 + amplitude * 3.0;
    }
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.15 + amplitude * 0.3;
    }
  });

  const dotY = grooveY + GROOVE_DEPTH * 0.5;

  if (!lit) {
    return (
      <mesh position={[0, dotY, z]}>
        <sphereGeometry args={[dotRadius * 0.5, 8, 8]} />
        <meshStandardMaterial color="#8A7B6E" roughness={0.95} transparent opacity={0.25} />
      </mesh>
    );
  }

  return (
    <group>
      {/* LED core — small, bright, sits inside groove */}
      <mesh ref={meshRef} position={[0, dotY, z]}>
        <sphereGeometry args={[dotRadius, 10, 10]} />
        <meshStandardMaterial
          color={colour}
          emissive={colour}
          emissiveIntensity={1.5}
          roughness={0.15}
          toneMapped={false}
        />
      </mesh>

      {/* Silicone diffusion halo — soft wide glow above surface */}
      <mesh
        ref={glowRef}
        position={[0, topY + 0.003, z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[dotRadius * 3.5, 16]} />
        <meshStandardMaterial
          color={colour}
          emissive={colour}
          emissiveIntensity={2.0}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
