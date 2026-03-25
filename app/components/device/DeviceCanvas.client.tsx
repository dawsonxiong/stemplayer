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

// ── Speaker grille — large recessed oval with hole grid ───
function SpeakerGrille() {
  const angle = Math.PI * 0.5;
  const edgeDist = A * 0.92;
  const gY = B * 0.3;

  const holes: [number, number][] = [];
  for (let row = -2; row <= 2; row++) {
    const cols = Math.abs(row) <= 1 ? 5 : (Math.abs(row) <= 1.5 ? 4 : 3);
    const xOff = row % 2 !== 0 ? 0.02 : 0;
    for (let col = 0; col < cols; col++) {
      holes.push([
        (col - (cols - 1) / 2) * 0.038 + xOff,
        row * 0.032,
      ]);
    }
  }

  return (
    <group
      position={[Math.sin(angle) * edgeDist, gY, Math.cos(angle) * edgeDist]}
      rotation={[0, -angle + Math.PI / 2, 0]}
    >
      {/* Recessed back plate */}
      <mesh position={[0, 0, 0.015]}>
        <planeGeometry args={[0.2, 0.18]} />
        <meshStandardMaterial color="#8A7A68" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {/* Rim */}
      <mesh position={[0, 0, 0.005]}>
        <planeGeometry args={[0.22, 0.2]} />
        <meshStandardMaterial color="#B0A090" roughness={0.92} side={THREE.DoubleSide} />
      </mesh>

      {/* Speaker holes */}
      {holes.map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0.013]}>
          <circleGeometry args={[0.012, 10]} />
          <meshStandardMaterial color="#2A2018" roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

// ── Port cutout — large recessed cavity with USB-C + 3.5mm
function PortCutouts() {
  const angle = -Math.PI * 0.5;
  const edgeDist = A * 0.92;
  const pY = -B * 0.18;
  const depth = 0.05;
  const cw = 0.14; // cavity width
  const ch = 0.18; // cavity height

  const wall = "#7A6A58";
  const hole = "#1A1410";

  return (
    <group
      position={[Math.sin(angle) * edgeDist, pY, Math.cos(angle) * edgeDist]}
      rotation={[0, -angle + Math.PI / 2, 0]}
    >
      {/* Cavity box — 5 walls forming a recessed pocket */}
      {/* Back */}
      <mesh position={[0, 0, depth]}>
        <planeGeometry args={[cw, ch]} />
        <meshStandardMaterial color={wall} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      {/* Top */}
      <mesh position={[0, ch / 2, depth / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[cw, depth]} />
        <meshStandardMaterial color={wall} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      {/* Bottom */}
      <mesh position={[0, -ch / 2, depth / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[cw, depth]} />
        <meshStandardMaterial color={wall} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      {/* Left */}
      <mesh position={[-cw / 2, 0, depth / 2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[depth, ch]} />
        <meshStandardMaterial color={wall} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      {/* Right */}
      <mesh position={[cw / 2, 0, depth / 2]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[depth, ch]} />
        <meshStandardMaterial color={wall} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {/* 3.5mm jack — large dark hole */}
      <mesh position={[0, 0.04, depth - 0.001]}>
        <circleGeometry args={[0.025, 16]} />
        <meshStandardMaterial color={hole} roughness={0.4} />
      </mesh>
      {/* Jack chrome rim */}
      <mesh position={[0, 0.04, depth - 0.0005]}>
        <ringGeometry args={[0.025, 0.032, 16]} />
        <meshStandardMaterial color="#5A5048" roughness={0.5} metalness={0.3} />
      </mesh>

      {/* USB-C port */}
      <mesh position={[0, -0.04, depth - 0.001]}>
        <planeGeometry args={[0.065, 0.025]} />
        <meshStandardMaterial color={hole} roughness={0.4} />
      </mesh>
      {/* USB-C silver rim */}
      <mesh position={[0, -0.04, depth - 0.0005]}>
        <planeGeometry args={[0.075, 0.035]} />
        <meshStandardMaterial color="#5A5048" roughness={0.5} metalness={0.3} />
      </mesh>
    </group>
  );
}

// ── Side buttons — power pill + volume rocker capsules ────
function SideButtons() {
  const pwrAngle = Math.PI * 0.0; // front
  const volAngle = Math.PI * 0.72; // back-left
  const btnDist = A * 0.94;

  return (
    <group>
      {/* Power button — pill near the top */}
      <group
        position={[
          Math.sin(pwrAngle) * btnDist,
          B * 0.2,
          Math.cos(pwrAngle) * btnDist,
        ]}
        rotation={[0, -pwrAngle, 0]}
      >
        {/* Recess outline */}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.022, 0.05, 4, 8]} />
          <meshStandardMaterial color="#B8A290" roughness={0.95} />
        </mesh>
        {/* Button raised surface */}
        <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 0, -0.005]}>
          <capsuleGeometry args={[0.016, 0.04, 4, 8]} />
          <SiliconeMaterial />
        </mesh>
      </group>

      {/* Volume rocker — two large elongated ovals, vertically stacked */}
      {[0.12, -0.12].map((yOff, i) => (
        <group
          key={i}
          position={[
            Math.sin(volAngle) * btnDist,
            yOff,
            Math.cos(volAngle) * btnDist,
          ]}
          rotation={[0, -volAngle + Math.PI, 0]}
        >
          {/* Recess outline */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.03, 0.12, 4, 8]} />
            <meshStandardMaterial color="#B8A290" roughness={0.95} />
          </mesh>
          {/* Button raised surface */}
          <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 0, -0.006]}>
            <capsuleGeometry args={[0.024, 0.10, 4, 8]} />
            <SiliconeMaterial />
          </mesh>
        </group>
      ))}
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
