import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Environment, Text } from "@react-three/drei";
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

      {/* Center button — raised disc */}
      <mesh position={[0, surfY(0) + 0.01, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.02, 32]} />
        <meshStandardMaterial color="#BFA48C" roughness={0.88} />
      </mesh>
      {/* Button ring/outline */}
      <mesh position={[0, surfY(0) + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.09, 0.11, 32]} />
        <meshStandardMaterial color="#B09880" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {/* Grooves + LEDs */}
      {ARMS.map(({ stem, rot }) => (
        <Arm key={stem} stem={stem} rot={rot} vol={volumes[stem]} amp={amplitudes[stem]} />
      ))}

      {/* Hardware details */}
      <SpeakerGrille />
      <PortCutouts />
      <SideButtons />

      {/* Bottom text — embossed on underside */}
      <group position={[0, -B + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <Text fontSize={0.045} color="#BCA48C" anchorX="center" anchorY="middle" position={[0, 0.12, 0]}>
          YEEZY TECH × KANO
        </Text>
        <Text fontSize={0.035} color="#BCA48C" anchorX="center" anchorY="middle" position={[0, 0.06, 0]}>
          MODEL 1016
        </Text>
        <Text fontSize={0.03} color="#BCA48C" anchorX="center" anchorY="middle" position={[0, 0.02, 0]}>
          CE  IC:25240-1016
        </Text>
        <Text fontSize={0.03} color="#BCA48C" anchorX="center" anchorY="middle" position={[0, -0.02, 0]}>
          FCC ID:2ATYD-1016
        </Text>
        <Text fontSize={0.035} color="#BCA48C" anchorX="center" anchorY="middle" position={[0, -0.07, 0]}>
          STEMPLAYER.COM
        </Text>
      </group>

      {/* Center button — larger, more visible */}
    </group>
  );
}

// ── Helper: position + normal on the spheroid surface ────
function surfacePoint(angle: number, elevation: number) {
  // angle = around Y axis, elevation = height (-1 to 1)
  const y = elevation * B;
  const rAtY = A * Math.sqrt(Math.max(0, 1 - (y * y) / (B * B)));
  const x = Math.sin(angle) * rAtY;
  const z = Math.cos(angle) * rAtY;
  // Normal of an ellipsoid: (x/a², y/b², z/a²) normalized
  const nx = x / (A * A);
  const ny = y / (B * B);
  const nz = z / (A * A);
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return {
    pos: [x, y, z] as [number, number, number],
    normal: [nx / len, ny / len, nz / len] as [number, number, number],
  };
}

// ── Speaker grille — dots on the surface ─────────────────
function SpeakerGrille() {
  const center = surfacePoint(Math.PI * 0.5, 0.45);

  // Generate hole positions in a local grid, then project onto sphere
  const holes: { angle: number; elev: number }[] = [];
  for (let row = -2; row <= 2; row++) {
    const cols = Math.abs(row) <= 1 ? 4 : 3;
    const off = row % 2 !== 0 ? 0.03 : 0;
    for (let col = 0; col < cols; col++) {
      const da = ((col - (cols - 1) / 2) * 0.055 + off) / A;
      const de = row * 0.055 / B;
      holes.push({
        angle: Math.PI * 0.5 + da,
        elev: 0.45 + de,
      });
    }
  }

  return (
    <group>
      {holes.map((h, i) => {
        const { pos } = surfacePoint(h.angle, h.elev);
        return (
          <group key={i}>
            <mesh position={pos}>
              <sphereGeometry args={[0.025, 10, 10]} />
              <meshStandardMaterial color="#5A4A38" roughness={0.7} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ── Ports — dark spots on the surface ────────────────────
function PortCutouts() {
  const jackPoint = surfacePoint(-Math.PI * 0.5, -0.25);
  const usbPoint = surfacePoint(-Math.PI * 0.5, -0.48);

  return (
    <group>
      {/* 3.5mm jack */}
      <mesh position={jackPoint.pos}>
        <sphereGeometry args={[0.028, 12, 12]} />
        <meshStandardMaterial color="#2A2018" roughness={0.5} />
      </mesh>
      {/* Jack rim */}
      <mesh position={jackPoint.pos}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshStandardMaterial color="#7A6A58" roughness={0.8} />
      </mesh>

      {/* USB-C */}
      <mesh position={usbPoint.pos} rotation={[0, Math.PI * 0.5, 0]}>
        <boxGeometry args={[0.06, 0.022, 0.025]} />
        <meshStandardMaterial color="#2A2018" roughness={0.5} />
      </mesh>
      {/* USB-C rim */}
      <mesh position={usbPoint.pos} rotation={[0, Math.PI * 0.5, 0]}>
        <boxGeometry args={[0.07, 0.032, 0.02]} />
        <meshStandardMaterial color="#7A6A58" roughness={0.8} />
      </mesh>
    </group>
  );
}

// ── Side buttons — capsules that sit on the surface ──────
function SideButtons() {
  // Power button
  const pwr = surfacePoint(0, 0.35);
  // Volume buttons
  const vol1 = surfacePoint(Math.PI * 0.72, 0.2);
  const vol2 = surfacePoint(Math.PI * 0.72, -0.2);

  return (
    <group>
      {/* Power — small pill flush on surface */}
      <group position={pwr.pos}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.014, 0.035, 4, 8]} />
          <meshStandardMaterial color="#B8A28C" roughness={0.92} />
        </mesh>
      </group>

      {/* Volume up */}
      <group position={vol1.pos}>
        <mesh rotation={[0, -Math.PI * 0.72 + Math.PI, Math.PI / 2]}>
          <capsuleGeometry args={[0.022, 0.1, 4, 8]} />
          <meshStandardMaterial color="#BCA894" roughness={0.92} />
        </mesh>
      </group>

      {/* Volume down */}
      <group position={vol2.pos}>
        <mesh rotation={[0, -Math.PI * 0.72 + Math.PI, Math.PI / 2]}>
          <capsuleGeometry args={[0.022, 0.1, 4, 8]} />
          <meshStandardMaterial color="#BCA894" roughness={0.92} />
        </mesh>
      </group>
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
  const r = 0.022;

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
