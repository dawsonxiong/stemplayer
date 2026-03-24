import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Environment } from "@react-three/drei";
import { useRef, useMemo } from "react";
import * as THREE from "three";
import { STEMS, type StemName } from "~/lib/constants";

const STEM_NAMES = Object.keys(STEMS) as StemName[];

// ── Oblate spheroid dimensions (squished sphere) ─────────
// Real device: ~6.4cm diameter, ~2.5cm thick
// Slightly less squished than pure 1:2.5 for better visual weight
const EQUATORIAL_RADIUS = 1.2; // width
const POLAR_RADIUS = 0.52; // half-height
const SEGMENTS = 80;

// ── Groove dimensions (barely visible score lines) ───────
const GROOVE_WIDTH = 0.065;
const GROOVE_DEPTH = 0.025;
const GROOVE_LENGTH_FRAC = 0.82;
const CENTER_GAP = 0.15;
const LEDS_PER_ARM = 8;

// ── Cross-pattern positions ──────────────────────────────
const GROOVE_POSITIONS: { stem: StemName; rotation: number }[] = [
  { stem: "vocals", rotation: 0 },
  { stem: "bass", rotation: Math.PI },
  { stem: "drums", rotation: Math.PI / 2 },
  { stem: "other", rotation: -Math.PI / 2 },
];

interface DeviceCanvasProps {
  volumes: Record<StemName, number>;
  amplitudes: Record<StemName, number>;
}

export default function DeviceCanvas({ volumes, amplitudes }: DeviceCanvasProps) {
  return (
    <div className="relative w-full" style={{ height: "clamp(340px, 45vw, 480px)" }}>
      <Canvas
        camera={{ position: [0, 3.0, 2.2], fov: 30 }}
        dpr={[1, 2]}
        shadows
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        style={{ background: "transparent" }}
      >
        {/* Soft warm ambient */}
        <ambientLight intensity={0.45} color="#f0e8dc" />

        {/* Key — warm, upper-left, soft shadow */}
        <directionalLight
          position={[2, 4.5, 3]}
          intensity={0.85}
          color="#fff2e0"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-bias={-0.0005}
        />

        {/* Fill — cool, softer */}
        <directionalLight position={[-3, 2, 1.5]} intensity={0.2} color="#dce4f0" />

        {/* Rim */}
        <directionalLight position={[-1, 3, -4]} intensity={0.4} color="#f5ebe0" />

        {/* Soft bottom bounce */}
        <pointLight position={[0, -1.5, 0]} intensity={0.08} color="#d4c0a8" distance={5} decay={2} />

        <Environment preset="apartment" environmentIntensity={0.12} />

        <StemPlayerDevice volumes={volumes} amplitudes={amplitudes} />

        <ContactShadows
          position={[0, -POLAR_RADIUS - 0.02, 0]}
          opacity={0.35}
          scale={4}
          blur={3}
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

// ── Helper: get Y on the spheroid surface at distance r from center ──
function getSurfaceY(r: number): number {
  // Ellipse: x²/a² + y²/b² = 1  →  y = b * sqrt(1 - x²/a²)
  const a = EQUATORIAL_RADIUS;
  const b = POLAR_RADIUS;
  const clamped = Math.min(r, a * 0.999);
  return b * Math.sqrt(1 - (clamped * clamped) / (a * a));
}

// ── Generate oblate spheroid profile ─────────────────────
// True elliptical cross-section — no flat sides, no edges
function createSpheroidProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const a = EQUATORIAL_RADIUS;
  const b = POLAR_RADIUS;

  // Bottom half (slightly flattened — real device sits flat)
  // Go from center-bottom up and outward
  const bottomFlatFraction = 0.25; // small flat spot on bottom
  const flatRadius = a * bottomFlatFraction;

  // Flat bottom center
  points.push(new THREE.Vector2(0, -b));
  points.push(new THREE.Vector2(flatRadius, -b));

  // Bottom elliptical arc (from flat spot to equator)
  const bottomSteps = 20;
  for (let i = 1; i <= bottomSteps; i++) {
    const t = i / bottomSteps; // 0 = flat edge, 1 = equator
    const angle = (Math.PI / 2) * t; // 0 to 90 degrees
    // Blend from flat bottom into the ellipse
    const ellipseR = a * Math.sin(angle);
    const ellipseY = -b * Math.cos(angle);
    // For small angles, blend with the flat bottom
    const blend = Math.min(1, t * 3); // quick blend
    const r = flatRadius + (ellipseR - flatRadius) * blend;
    const y = -b + (-b - (-b)) * (1 - blend) + ellipseY * blend;
    if (r > flatRadius) {
      points.push(new THREE.Vector2(r, ellipseY));
    }
  }

  // Top half — pure ellipse (the dome)
  const topSteps = 30;
  for (let i = 1; i <= topSteps; i++) {
    const t = i / topSteps; // 0 = equator, 1 = top center
    const angle = (Math.PI / 2) * t;
    const r = a * Math.cos(angle);
    const y = b * Math.sin(angle);
    points.push(new THREE.Vector2(r, y));
  }

  return points;
}

// ── Main device assembly ─────────────────────────────────
function StemPlayerDevice({ volumes, amplitudes }: DeviceCanvasProps) {
  const geometry = useMemo(() => {
    const profile = createSpheroidProfile();
    const geo = new THREE.LatheGeometry(profile, SEGMENTS);
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <group>
      {/* Spheroid body — warm pinkish-tan silicone */}
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          color="#C9AB94"
          roughness={0.85}
          metalness={0.0}
          clearcoat={0.03}
          clearcoatRoughness={0.9}
          envMapIntensity={0.15}
          sheen={0.1}
          sheenColor="#D4BCA6"
          sheenRoughness={0.8}
        />
      </mesh>

      {/* Center button */}
      <CenterButton />

      {/* Cross-pattern groove arms */}
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

// ── Center button — flush, barely raised ─────────────────
function CenterButton() {
  const btnRadius = CENTER_GAP * 0.5;
  const surfaceY = getSurfaceY(0);

  return (
    <mesh position={[0, surfaceY + 0.008, 0]}>
      <cylinderGeometry args={[btnRadius, btnRadius, 0.016, 32]} />
      <meshPhysicalMaterial
        color="#BFA28C"
        roughness={0.8}
        metalness={0.0}
        clearcoat={0.02}
      />
    </mesh>
  );
}

// ── Single groove arm ────────────────────────────────────
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
  const armLength = EQUATORIAL_RADIUS * GROOVE_LENGTH_FRAC - CENTER_GAP;
  const litCount = Math.round(volume * LEDS_PER_ARM);

  return (
    <group rotation={[0, rotation, 0]}>
      {/* Groove channel segments — follow the dome curvature */}
      <GrooveChannel armLength={armLength} />

      {/* LED dots */}
      {Array.from({ length: LEDS_PER_ARM }).map((_, i) => {
        const spacing = armLength / LEDS_PER_ARM;
        const dist = CENTER_GAP + spacing * (i + 0.5);
        const surfaceY = getSurfaceY(dist);

        return (
          <LEDDot
            key={i}
            lit={i < litCount}
            colour={stem.colour}
            distance={dist}
            surfaceY={surfaceY}
            amplitude={amplitude}
          />
        );
      })}
    </group>
  );
}

// ── Groove channel — single extruded shape following dome curve ───
function GrooveChannel({ armLength }: { armLength: number }) {
  const geometry = useMemo(() => {
    const segments = 24;
    const hw = GROOVE_WIDTH / 2;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const dist = CENTER_GAP + armLength * t;
      const y = getSurfaceY(dist) - GROOVE_DEPTH * 0.55;

      // Two vertices per segment (left and right edges of groove)
      positions.push(-hw, y, dist); // left
      positions.push(hw, y, dist);  // right
    }

    // Build quads
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [armLength]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color="#B09A8A"
        roughness={0.95}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ── LED dot with subsurface diffusion ────────────────────
function LEDDot({
  lit,
  colour,
  distance,
  surfaceY,
  amplitude,
}: {
  lit: boolean;
  colour: string;
  distance: number;
  surfaceY: number;
  amplitude: number;
}) {
  const coreRef = useRef<THREE.Mesh>(null);
  const innerGlowRef = useRef<THREE.Mesh>(null);
  const outerGlowRef = useRef<THREE.Mesh>(null);

  const dotRadius = GROOVE_WIDTH * 0.22;
  const dotY = surfaceY - GROOVE_DEPTH * 0.2;

  useFrame(() => {
    if (!lit) return;
    const pulse = 1.0 + amplitude * 2.5;
    if (coreRef.current) {
      (coreRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
    }
    if (innerGlowRef.current) {
      (innerGlowRef.current.material as THREE.MeshStandardMaterial).opacity = 0.25 + amplitude * 0.25;
    }
    if (outerGlowRef.current) {
      (outerGlowRef.current.material as THREE.MeshStandardMaterial).opacity = 0.08 + amplitude * 0.12;
    }
  });

  if (!lit) {
    // Unlit — nearly invisible, just a faint dot in the groove
    return (
      <mesh position={[0, dotY, distance]}>
        <sphereGeometry args={[dotRadius * 0.5, 6, 6]} />
        <meshStandardMaterial color="#9E8D7E" roughness={0.95} transparent opacity={0.15} />
      </mesh>
    );
  }

  return (
    <group>
      {/* LED core — small bright point */}
      <mesh ref={coreRef} position={[0, dotY, distance]}>
        <sphereGeometry args={[dotRadius, 8, 8]} />
        <meshStandardMaterial
          color={colour}
          emissive={colour}
          emissiveIntensity={1.2}
          roughness={0.1}
          toneMapped={false}
        />
      </mesh>

      {/* Inner glow — simulates light bleeding into silicone right around the LED */}
      <mesh
        ref={innerGlowRef}
        position={[0, surfaceY + 0.002, distance]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[dotRadius * 2.5, 16]} />
        <meshStandardMaterial
          color={colour}
          emissive={colour}
          emissiveIntensity={1.8}
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Outer glow — wide soft haze, subsurface scatter approximation */}
      <mesh
        ref={outerGlowRef}
        position={[0, surfaceY + 0.004, distance]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[dotRadius * 6, 20]} />
        <meshStandardMaterial
          color={colour}
          emissive={colour}
          emissiveIntensity={1.2}
          transparent
          opacity={0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
