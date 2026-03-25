import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Environment } from "@react-three/drei";
import { useRef, useMemo } from "react";
import * as THREE from "three";
import { STEMS, type StemName } from "~/lib/constants";

const STEM_NAMES = Object.keys(STEMS) as StemName[];

// ── Dimensions ───────────────────────────────────────────
const A = 1.15; // equatorial radius
const B = 0.48; // polar half-height
const SEGMENTS = 96;

// ── Grooves ──────────────────────────────────────────────
const GROOVE_W = 0.045;
const GROOVE_ARM = 0.80;
const CENTER_GAP = 0.14;
const LEDS = 8;

const ARMS: { stem: StemName; rot: number }[] = [
  { stem: "vocals", rot: 0 },
  { stem: "bass", rot: Math.PI },
  { stem: "drums", rot: Math.PI / 2 },
  { stem: "other", rot: -Math.PI / 2 },
];

interface Props {
  volumes: Record<StemName, number>;
  amplitudes: Record<StemName, number>;
}

function surfY(r: number): number {
  const c = Math.min(Math.abs(r), A * 0.999);
  return B * Math.sqrt(1 - (c * c) / (A * A));
}

export default function DeviceCanvas({ volumes, amplitudes }: Props) {
  return (
    <div className="relative w-full" style={{ height: "clamp(340px, 45vw, 480px)" }}>
      <Canvas
        camera={{ position: [0, 1.8, 3.5], fov: 28 }}
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
        <ambientLight intensity={0.6} color="#f5ede0" />
        <directionalLight
          position={[1, 5, 2]}
          intensity={0.7}
          color="#fff8f0"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-bias={-0.0003}
        />
        <directionalLight position={[-3, 3, 1]} intensity={0.15} color="#e8e0d8" />
        <directionalLight position={[0, 2, -4]} intensity={0.2} color="#f0e8dc" />
        <pointLight position={[0, -1.5, 0]} intensity={0.08} color="#d4c0a8" distance={5} decay={2} />

        <Environment preset="apartment" environmentIntensity={0.08} />

        <Device volumes={volumes} amplitudes={amplitudes} />

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
          enableZoom={true}
          minDistance={2.0}
          maxDistance={7.0}
          minPolarAngle={0.1}
          maxPolarAngle={Math.PI - 0.1}
          autoRotate
          autoRotateSpeed={0.3}
          dampingFactor={0.05}
          rotateSpeed={0.6}
        />
      </Canvas>
    </div>
  );
}

// ── Profile ──────────────────────────────────────────────
function makeProfile(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const flatR = A * 0.2;
  pts.push(new THREE.Vector2(0, -B));
  pts.push(new THREE.Vector2(flatR, -B));
  for (let i = 1; i <= 30; i++) {
    const ang = (Math.PI / 2) * (i / 30);
    const r = A * Math.sin(ang);
    const y = -B * Math.cos(ang);
    if (r > flatR) pts.push(new THREE.Vector2(r, y));
  }
  for (let i = 1; i <= 40; i++) {
    const ang = (Math.PI / 2) * (i / 40);
    pts.push(new THREE.Vector2(A * Math.cos(ang), B * Math.sin(ang)));
  }
  return pts;
}

// ── Silicone material ────────────────────────────────────
function SiliconeMaterial() {
  return (
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
  );
}

// ── Full device ──────────────────────────────────────────
function Device({ volumes, amplitudes }: Props) {
  const geo = useMemo(() => {
    const g = new THREE.LatheGeometry(makeProfile(), SEGMENTS);
    g.computeVertexNormals();
    return g;
  }, []);

  return (
    <group>
      {/* Body */}
      <mesh geometry={geo} castShadow receiveShadow>
        <SiliconeMaterial />
      </mesh>

      {/* Center button */}
      <mesh position={[0, surfY(0) + 0.006, 0]}>
        <cylinderGeometry args={[0.065, 0.065, 0.012, 32]} />
        <SiliconeMaterial />
      </mesh>

      {/* Grooves + LEDs */}
      {ARMS.map(({ stem, rot }) => (
        <Arm key={stem} stem={stem} rot={rot} vol={volumes[stem]} amp={amplitudes[stem]} />
      ))}

      {/* Hardware details */}
      <SpeakerGrille />
      <PortCutouts />
      <SideButtons />
      <BottomText />
    </group>
  );
}

// ── Speaker grille — recessed oval with honeycomb holes ──
function SpeakerGrille() {
  const angle = Math.PI * 0.5;
  const edgeDist = A * 0.93;
  const gY = B * 0.28;

  // Honeycomb hole positions (4 rows, staggered)
  const holes: [number, number][] = [];
  for (let row = -1.5; row <= 1.5; row++) {
    const cols = Math.abs(row) <= 0.5 ? 5 : 4;
    const xOff = Math.abs(row) <= 0.5 ? 0 : 0.009;
    for (let col = 0; col < cols; col++) {
      holes.push([
        (col - (cols - 1) / 2) * 0.018 + xOff,
        row * 0.015,
      ]);
    }
  }

  return (
    <group
      position={[Math.sin(angle) * edgeDist, gY, Math.cos(angle) * edgeDist]}
      rotation={[0, -angle + Math.PI / 2, 0]}
    >
      {/* Recessed oval surround */}
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.03, 16]} />
        <meshStandardMaterial color="#B09888" roughness={0.95} />
      </mesh>

      {/* Holes */}
      {holes.map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0]} rotation={[0, Math.PI / 2, 0]}>
          <cylinderGeometry args={[0.005, 0.005, 0.04, 6]} />
          <meshStandardMaterial color="#7A6A5A" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

// ── Port cutout — recessed shelf with USB-C + 3.5mm ──────
function PortCutouts() {
  const angle = -Math.PI * 0.5;
  const edgeDist = A * 0.93;
  const pY = -B * 0.25;

  return (
    <group
      position={[Math.sin(angle) * edgeDist, pY, Math.cos(angle) * edgeDist]}
      rotation={[0, -angle + Math.PI / 2, 0]}
    >
      {/* Recessed port shelf */}
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.06, 0.08, 0.03]} />
        <meshStandardMaterial color="#B09888" roughness={0.95} />
      </mesh>

      {/* 3.5mm headphone jack — round hole */}
      <mesh position={[0, 0.018, 0]} rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.04, 10]} />
        <meshStandardMaterial color="#4A4038" roughness={0.8} />
      </mesh>

      {/* USB-C port — rectangular */}
      <mesh position={[0, -0.018, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.02, 0.008, 0.04]} />
        <meshStandardMaterial color="#4A4038" roughness={0.8} />
      </mesh>
    </group>
  );
}

// ── Side buttons — power pill + volume rocker capsules ────
function SideButtons() {
  // From the reference: power button near top, two large oval volume
  // buttons vertically stacked on the opposite side, with visible
  // raised outlines (embossed into the silicone)
  const pwrAngle = 0; // front edge
  const volAngle = Math.PI * 0.72; // back-left edge

  return (
    <group>
      {/* Power button — small pill near top */}
      <group
        position={[
          Math.sin(pwrAngle) * A * 0.96,
          B * 0.15,
          Math.cos(pwrAngle) * A * 0.96,
        ]}
        rotation={[0, -pwrAngle, 0]}
      >
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.008, 0.02, 4, 8]} />
          <SiliconeMaterial />
        </mesh>
        {/* Outline recess around power button */}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.012, 0.028, 4, 8]} />
          <meshStandardMaterial color="#B8A290" roughness={0.95} transparent opacity={0.6} />
        </mesh>
      </group>

      {/* Volume rocker — two elongated oval capsules, vertically stacked */}
      {[0.08, -0.08].map((yOff, i) => (
        <group
          key={i}
          position={[
            Math.sin(volAngle) * A * 0.96,
            yOff,
            Math.cos(volAngle) * A * 0.96,
          ]}
          rotation={[0, -volAngle + Math.PI, 0]}
        >
          {/* Button body — raised capsule */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.014, 0.06, 4, 8]} />
            <SiliconeMaterial />
          </mesh>
          {/* Outline recess */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.019, 0.07, 4, 8]} />
            <meshStandardMaterial color="#B8A290" roughness={0.95} transparent opacity={0.5} />
          </mesh>
        </group>
      ))}

      {/* Small indicator dot below volume rocker */}
      <mesh
        position={[
          Math.sin(volAngle) * A * 0.97,
          -0.18,
          Math.cos(volAngle) * A * 0.97,
        ]}
      >
        <sphereGeometry args={[0.005, 8, 8]} />
        <meshStandardMaterial color="#B0A090" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ── Embossed text on the bottom ──────────────────────────
// (Simulated with thin flat geometry — real text would need TextGeometry/font)
function BottomText() {
  // Position text lines on the bottom face
  const textY = -B + 0.002;
  const lines = [
    { z: 0.05, w: 0.25, h: 0.012 },  // YEEZY TECH × KANO
    { z: 0.025, w: 0.15, h: 0.01 },   // MODEL 1016
    { z: 0.0, w: 0.2, h: 0.01 },      // CE IC:25240-1016
    { z: -0.025, w: 0.22, h: 0.01 },   // FCC ID:2ATYD-1016
    { z: -0.05, w: 0.18, h: 0.01 },    // STEMPLAYER.COM
  ];

  return (
    <group rotation={[0, Math.PI * 0.25, 0]}>
      {lines.map((line, i) => (
        <mesh key={i} position={[0, textY, line.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[line.w, line.h]} />
          <meshStandardMaterial
            color="#BCA48C"
            roughness={0.95}
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ── Groove arm ───────────────────────────────────────────
function Arm({ stem, rot, vol, amp }: { stem: StemName; rot: number; vol: number; amp: number }) {
  const armLen = A * GROOVE_ARM - CENTER_GAP;
  const litCount = Math.round(vol * LEDS);
  const colour = STEMS[stem].colour;

  const grooveGeo = useMemo(() => {
    const segs = 32;
    const hw = GROOVE_W / 2;
    const v: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const d = CENTER_GAP + armLen * t;
      const y = surfY(d) - 0.008;
      v.push(-hw, y, d);
      v.push(hw, y, d);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [armLen]);

  return (
    <group rotation={[0, rot, 0]}>
      <mesh geometry={grooveGeo}>
        <meshStandardMaterial color="#B89E8A" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {/* End notch */}
      <mesh position={[0, surfY(CENTER_GAP + armLen) - 0.004, CENTER_GAP + armLen]}>
        <boxGeometry args={[GROOVE_W * 1.4, 0.01, 0.02]} />
        <meshStandardMaterial color="#B89E8A" roughness={0.95} />
      </mesh>

      {Array.from({ length: LEDS }).map((_, i) => {
        const d = CENTER_GAP + (armLen / LEDS) * (i + 0.5);
        return <Dot key={i} lit={i < litCount} d={d} colour={colour} amp={amp} />;
      })}
    </group>
  );
}

// ── LED dot ──────────────────────────────────────────────
function Dot({ lit, d, colour, amp }: { lit: boolean; d: number; colour: string; amp: number }) {
  const coreRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);

  const sy = surfY(d);
  const dy = sy - 0.003;
  const r = 0.012;

  useFrame(() => {
    if (!lit) return;
    const p = 0.8 + amp * 1.5;
    if (coreRef.current) (coreRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = p;
    if (glowRef.current) (glowRef.current.material as THREE.MeshStandardMaterial).opacity = 0.12 + amp * 0.18;
    if (haloRef.current) (haloRef.current.material as THREE.MeshStandardMaterial).opacity = 0.04 + amp * 0.06;
  });

  if (!lit) {
    return (
      <mesh position={[0, dy, d]}>
        <sphereGeometry args={[r * 0.5, 6, 6]} />
        <meshStandardMaterial color="#B0A090" roughness={0.95} transparent opacity={0.08} />
      </mesh>
    );
  }

  return (
    <group>
      <mesh ref={coreRef} position={[0, dy, d]}>
        <sphereGeometry args={[r, 8, 8]} />
        <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.8} roughness={0.2} toneMapped={false} />
      </mesh>
      <mesh ref={glowRef} position={[0, sy + 0.001, d]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r * 2, 12]} />
        <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={1.0} transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={haloRef} position={[0, sy + 0.002, d]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r * 4.5, 16]} />
        <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.6} transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}
