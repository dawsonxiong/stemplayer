import { Canvas, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  ContactShadows,
  Environment,
} from "@react-three/drei";
import { useRef } from "react";
import * as THREE from "three";
import { STEMS, type StemName } from "~/lib/constants";

const STEM_NAMES = Object.keys(STEMS) as StemName[];

// ── Puck dimensions ──────────────────────────────────────
const RADIUS = 1.4;
const HEIGHT = 0.35;
const SEGMENTS = 64;

// ── Groove dimensions ────────────────────────────────────
const GROOVE_WIDTH = 0.09;
const GROOVE_DEPTH = 0.05;
const GROOVE_LENGTH = 0.85; // fraction of radius for each arm
const CENTER_GAP = 0.18; // gap from center for the button

// ── Cross-pattern groove positions (top, bottom, left, right) ──
// Each groove radiates outward from center button
const GROOVE_POSITIONS: {
  stem: StemName;
  rotation: number; // radians around Y axis
}[] = [
  { stem: "vocals", rotation: 0 }, // top (toward +Z)
  { stem: "bass", rotation: Math.PI }, // bottom (toward -Z)
  { stem: "drums", rotation: Math.PI / 2 }, // right (toward +X)
  { stem: "other", rotation: -Math.PI / 2 }, // left (toward -X)
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
        camera={{ position: [0, 3, 3.5], fov: 30 }}
        dpr={[1, 2]}
        shadows
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        style={{ background: "transparent" }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.35} color="#f5f0e8" />
        <directionalLight
          position={[3, 5, 4]}
          intensity={1.1}
          color="#fff5e6"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-bias={-0.001}
        />
        <directionalLight
          position={[-4, 3, 2]}
          intensity={0.35}
          color="#e0e8ff"
        />
        <directionalLight
          position={[-2, 4, -5]}
          intensity={0.7}
          color="#fff0dd"
        />

        <Environment preset="studio" environmentIntensity={0.25} />

        {/* Device */}
        <StemPlayerPuck volumes={volumes} amplitudes={amplitudes} />

        {/* Shadow */}
        <ContactShadows
          position={[0, -HEIGHT / 2 - 0.01, 0]}
          opacity={0.5}
          scale={5}
          blur={2.5}
          far={2}
          resolution={512}
          color="#1a1410"
        />

        {/* Controls */}
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

// ── Main puck assembly ───────────────────────────────────
function StemPlayerPuck({ volumes, amplitudes }: DeviceCanvasProps) {
  return (
    <group>
      {/* Body */}
      <PuckBody />

      {/* Center button */}
      <CenterButton />

      {/* Cross-pattern grooves */}
      {GROOVE_POSITIONS.map(({ stem, rotation }) => (
        <GrooveArm
          key={stem}
          stemName={stem}
          rotation={rotation}
          volume={volumes[stem]}
          amplitude={amplitudes[stem]}
        />
      ))}

      {/* Subtle edge bevel ring */}
      <mesh
        position={[0, HEIGHT / 2 + 0.001, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[RADIUS - 0.04, RADIUS, SEGMENTS]} />
        <meshStandardMaterial
          color="#BFB094"
          roughness={0.4}
          transparent
          opacity={0.25}
        />
      </mesh>
    </group>
  );
}

// ── Puck body cylinder ───────────────────────────────────
function PuckBody() {
  return (
    <group>
      {/* Main cylinder */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[RADIUS, RADIUS * 0.98, HEIGHT, SEGMENTS]} />
        <meshStandardMaterial
          color="#D4C5A9"
          roughness={0.75}
          metalness={0.02}
          envMapIntensity={0.3}
        />
      </mesh>

      {/* Top cap — slightly lighter for depth */}
      <mesh position={[0, HEIGHT / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[RADIUS, SEGMENTS]} />
        <meshStandardMaterial
          color="#DDD0B8"
          roughness={0.7}
          metalness={0.02}
          envMapIntensity={0.3}
        />
      </mesh>
    </group>
  );
}

// ── Center button ────────────────────────────────────────
function CenterButton() {
  return (
    <mesh position={[0, HEIGHT / 2 + 0.005, 0]}>
      <cylinderGeometry args={[CENTER_GAP * 0.7, CENTER_GAP * 0.7, 0.02, 32]} />
      <meshStandardMaterial
        color="#C8B898"
        roughness={0.6}
        metalness={0.05}
      />
    </mesh>
  );
}

// ── Single groove arm radiating from center ──────────────
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
  const fillRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const stem = STEMS[stemName];

  const armLength = RADIUS * GROOVE_LENGTH - CENTER_GAP;
  const armCenter = CENTER_GAP + armLength / 2;
  const fillLength = armLength * volume;
  const fillOffset = CENTER_GAP + fillLength / 2;

  const grooveY = HEIGHT / 2 - GROOVE_DEPTH / 2 + 0.002;
  const fillY = HEIGHT / 2 - GROOVE_DEPTH + 0.003;

  // Animate emissive per-frame
  useFrame(() => {
    if (fillRef.current) {
      const mat = fillRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.5 + amplitude * 4.0;
    }
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.2 + amplitude * 0.4;
    }
  });

  return (
    <group rotation={[0, rotation, 0]}>
      {/* Dark groove channel */}
      <mesh position={[0, grooveY, armCenter]}>
        <boxGeometry args={[GROOVE_WIDTH, GROOVE_DEPTH, armLength]} />
        <meshStandardMaterial color="#1a1410" roughness={0.9} />
      </mesh>

      {/* LED fill — grows outward from center */}
      {volume > 0.01 && (
        <>
          <mesh ref={fillRef} position={[0, fillY, fillOffset]}>
            <boxGeometry
              args={[GROOVE_WIDTH * 0.9, GROOVE_DEPTH * 0.8, fillLength]}
            />
            <meshStandardMaterial
              color={stem.colour}
              emissive={stem.colour}
              emissiveIntensity={2.0}
              roughness={0.2}
              toneMapped={false}
            />
          </mesh>

          {/* Glow plane — wider and brighter */}
          <mesh
            ref={glowRef}
            position={[0, HEIGHT / 2 + 0.008, fillOffset]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[GROOVE_WIDTH * 8, fillLength * 1.2]} />
            <meshStandardMaterial
              color={stem.colour}
              emissive={stem.colour}
              emissiveIntensity={3}
              transparent
              opacity={0.25}
              side={THREE.DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </>
      )}
    </group>
  );
}
