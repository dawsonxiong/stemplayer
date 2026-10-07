import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, ContactShadows, useGLTF } from "@react-three/drei";
import { useReducedMotion } from "framer-motion";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { LED_PALETTE, type DeviceColor, type StemName } from "~/lib/constants";
import { usePlayerStore } from "~/lib/store";
import { MODEL_URL } from "~/lib/model";
import { SCENE_CEILING, SCENE_FLOOR, SCENE_HEIGHT } from "./frame";

useGLTF.preload(MODEL_URL);

// Device half-height after the asset pipeline centres it on the origin.
const HALF_H = 0.472;
const FOV = 28;
const CAMERA_START: [number, number, number] = [0, 3.35, 2.9];
const MAX_DISTANCE = 7;
const START_DISTANCE = Math.hypot(...CAMERA_START);
// Zooming in stops short of filling the frame, and never comes closer than
// this to the device: any nearer and it just fills the page.
const MIN_DISTANCE = START_DISTANCE * 0.85;
const ZOOM_HEADROOM = 1.25;

// The shader derives an arm index from atan(x, z): 0 = -Z, 1 = -X, 2 = +Z,
// 3 = +X. This maps each of those grooves to a stem.
const ARM_ORDER: StemName[] = ["bass", "other", "vocals", "drums"];

// Radial span of the lit strip, measured off the mesh by sampling the emissive
// map at every body vertex — not eyeballed. Dots misalign with the texture's
// colour ramp if this is off, which reads as half-pink/half-white LEDs.
const LED_R_MIN = 0.334;
const LED_R_MAX = 0.735;

// The GLB ships one baked-in tan body map, so every colourway is a multiplier
// on it. These are LINEAR (Color.setRGB works in the linear working space),
// solved against the map's linear value so the tan source's warm cast cancels
// out — bao needs ~3x on blue just to reach neutral. Tuned against the product
// page's rotate posters.
interface Colorway {
  tint: [number, number, number];
  roughness: number;
  /** Refraction, so clear is genuinely see-through rather than grey paint. */
  transmission: number;
  thickness: number;
  clearcoat: number;
  /** Beer-Lambert tint of the light passing through — this is what makes it
   *  read as smoked rather than as clean glass. */
  attenuation: string;
  attenuationDistance: number;
  /** How far LED light spreads through the shell. A translucent skin carries
   *  the glow well past the groove; opaque silicone keeps it tight. */
  ledDiffuse: number;
}

const COLORWAYS: Record<DeviceColor, Colorway> = {
  tan: {
    // Solved so the body map's flat tone (#b7967f) comes out as #aa8d80.
    tint: [0.849, 0.873, 1.017],
    roughness: 0.62,
    transmission: 0,
    thickness: 0,
    clearcoat: 0,
    attenuation: "#ffffff",
    attenuationDistance: Infinity,
    ledDiffuse: 1,
  },
  bao: {
    tint: [1.45, 2.2, 3.0],
    roughness: 0.58,
    transmission: 0,
    thickness: 0,
    clearcoat: 0,
    attenuation: "#ffffff",
    attenuationDistance: Infinity,
    ledDiffuse: 1,
  },
  clear: {
    // The real Clear is milky, cool-white silicone: bright, softly glossy, with
    // the LEDs glowing through and the internals showing only as vague shapes.
    // Transmission alone darkens it (there's nothing bright behind the device
    // to see through), so the brightness comes from a light cool tint and the
    // translucency from a little transmission plus wider LED glow.
    tint: [1.5, 2.35, 3.5],
    roughness: 0.55,
    transmission: 0.35,
    thickness: 0.9,
    clearcoat: 0.3,
    attenuation: "#E8EDF1",
    attenuationDistance: 2.0,
    ledDiffuse: 1.3,
  },
};

function applyColorway(mat: THREE.MeshPhysicalMaterial, color: DeviceColor) {
  const cw = COLORWAYS[color];
  mat.color.setRGB(cw.tint[0], cw.tint[1], cw.tint[2]);
  mat.roughness = cw.roughness;
  mat.transmission = cw.transmission;
  mat.thickness = cw.thickness;
  mat.clearcoat = cw.clearcoat;
  mat.attenuationColor.set(cw.attenuation);
  mat.attenuationDistance = cw.attenuationDistance;
  mat.sheenColor.set(cw.transmission > 0 ? "#f2f6ff" : "#fff1e6");
  // Read by the LED shader as a uniform, so it changes without a recompile.
  ((mat.userData.ledDiffuse ??= { value: 1 }) as { value: number }).value = cw.ledDiffuse;
  // Transmission renders in its own pass and needs no blending. Marking it
  // transparent alpha-blended the internals through the shell, sharp and
  // unblurred, which read as glass rather than frosted silicone.
  mat.transparent = false;
  // Toggling transmission changes the shader defines.
  mat.needsUpdate = true;
}

// Centre button edge sits at r=0.12 (dense vertex ring); padded for touch.
const BUTTON_HIT_R = 0.16;
// Groove half-width is 0.053; padded so the strip is grabbable.
const GROOVE_HIT_W = 0.09;

interface Props {
  volumes: Record<StemName, number>;
  amplitudes: Record<StemName, number>;
  onStemVolume?: (stem: StemName, value: number) => void;
  onTogglePlay?: () => void;
  onVolumeStep?: (delta: number) => void;
  onTogglePower?: () => void;
  /** A groove's rim is being held (true) or let go (false). */
  onHoldStem?: (stem: StemName, held: boolean) => void;
  /** The GPU dropped the context; the page swaps in a static device. */
  onContextLost?: () => void;
  /** The model has drawn a frame, so the loader can hand over. */
  onReady?: () => void;
}

// The side rocker's pad, measured off the mesh's raised surface: a capsule
// from -5° to 32° around the rim (signed atan2 angles, since it straddles 0°)
// and ±0.075 either side of the equator. The hit area is that capsule plus a hair of slack, so a
// press just outside the moulded outline doesn't count. The strap mount,
// raised again from 39°, is not a control; power lives on the centre button.
const ROCKER_DEG: [number, number] = [-5, 32];
const ROCKER_HALF_H = 0.075;
const ROCKER_SLACK = 0.008;
// Split between the two halves, midway between the "+" (~1°) and "−" (~29°).
const ROCKER_SPLIT_DEG = 15;

// The real device powers on/off by holding the top button for a couple of
// seconds; a short press is play/pause.
const POWER_HOLD_MS = 1000;

// Holding a groove's outer end plays that stem alone, as on the device.
const ISOLATE_FROM = 0.8;
const ISOLATE_HOLD_MS = 350;

interface DragState {
  mode: "none" | "button" | "groove" | "volume";
  stem: StemName | null;
  delta: number;
  sx: number;
  sy: number;
  t0: number;
  firedHold: boolean;
  /** The held stem is playing alone and must be released on let-go. */
  isolating: boolean;
}

// A fresh object each time: timers write to the current drag state.
const idle = (): DragState => ({
  mode: "none",
  stem: null,
  delta: 0,
  sx: 0,
  sy: 0,
  t0: 0,
  firedHold: false,
  isolating: false,
});

type Zone =
  | { kind: "button" }
  | { kind: "volume"; delta: number }
  | { kind: "groove"; stem: StemName; value: number };

/** Which control a point on the device surface belongs to. Mirrors the shader's
 *  arm maths so the hit regions line up with the lit LEDs exactly. */
function zoneAt(p: THREE.Vector3): Zone | null {
  const rXZ = Math.hypot(p.x, p.z);

  // Side rocker first — it straddles the equator, so it must be tested before
  // the top-face gate below.
  if (rXZ > 0.88 && Math.abs(p.y) < ROCKER_HALF_H + ROCKER_SLACK) {
    const deg = (Math.atan2(p.x, p.z) * 180) / Math.PI;
    // Distance to the capsule, measured along the rim surface: arc length
    // around, height up. Its round ends are centred one half-height in.
    const arc = (deg * Math.PI * rXZ) / 180;
    const start = (ROCKER_DEG[0] * Math.PI * rXZ) / 180 + ROCKER_HALF_H;
    const end = (ROCKER_DEG[1] * Math.PI * rXZ) / 180 - ROCKER_HALF_H;
    const along = arc - Math.min(end, Math.max(start, arc));
    if (Math.hypot(along, p.y) <= ROCKER_HALF_H + ROCKER_SLACK) {
      return { kind: "volume", delta: deg < ROCKER_SPLIT_DEG ? 0.1 : -0.1 };
    }
  }

  if (p.y <= 0) return null; // underside

  const r = rXZ;
  if (r < BUTTON_HIT_R) return { kind: "button" };

  const ang = Math.atan2(p.x, p.z) / (2 * Math.PI) + 0.5;
  const armF = ((Math.floor(ang * 4 + 0.5) % 4) + 4) % 4;
  const theta = (armF / 4 - 0.5) * 2 * Math.PI;
  const ax = Math.sin(theta);
  const az = Math.cos(theta);
  const along = p.x * ax + p.z * az;
  const perp = Math.hypot(p.x - ax * along, p.z - az * along);

  if (perp > GROOVE_HIT_W) return null;
  if (along < LED_R_MIN - 0.06 || along > LED_R_MAX + 0.06) return null;

  const value = Math.min(1, Math.max(0, (along - LED_R_MIN) / (LED_R_MAX - LED_R_MIN)));
  return { kind: "groove", stem: ARM_ORDER[armF], value };
}

// The canvas runs this far past the scene's layout box, below the device.
// That extra strip is where the fade happens, so at rest the fade only ever
// covers the ground shadow and never the device itself. <ExtendedFrame> keeps
// the camera framed on the original box, so the device doesn't move.
const EXTEND = 0.35;

/** Eased fade between two points of the canvas height, as mask stops. A
 *  linear ramp has an abrupt start and end, and the eye reads both as faint
 *  lines; cosine easing has zero slope at both ends, so there's no edge. */
function easedFade(from: number, to: number) {
  return Array.from({ length: 13 }, (_, i) => {
    const t = i / 12;
    const alpha = (1 + Math.cos(Math.PI * t)) / 2;
    return `rgba(0,0,0,${alpha.toFixed(3)}) ${(from + (to - from) * t).toFixed(1)}%`;
  });
}

const BOTTOM_FROM = 100 / (1 + EXTEND) - 2;
// Bottom: fade out across the extra strip. Top: a short fade so a zoomed-in
// device meets the heading softly instead of in a hard straight cut.
const EDGE_FADE = `linear-gradient(to bottom, ${[
  ...easedFade(6, 0).reverse(),
  ...easedFade(BOTTOM_FROM, 100),
].join(", ")})`;

export default function DeviceCanvas({
  volumes,
  amplitudes,
  onStemVolume,
  onTogglePlay,
  onVolumeStep,
  onTogglePower,
  onHoldStem,
  onContextLost,
  onReady,
}: Props) {
  const reduceMotion = useReducedMotion();
  const [userOrbiting, setUserOrbiting] = useState(false);
  const resumeTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );
  // R3F deliberately destroys the context 500 ms after unmount, which fires
  // the same event as a GPU failure. Only a loss while mounted is real;
  // otherwise a remount (a hot reload in dev) would stick on the fallback.
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  return (
    // The ground shadow darkens the transparent canvas, so a hard canvas edge
    // shows as a seam against the page. The canvas overflows its box
    // downwards and fades out in that overflow. It sits under the controls
    // that follow it (they stack above), so the overflow never blocks them.
    <div
      className="device-touch relative z-0 w-full"
      style={{
        // Starts above the scene's box, so the box begins at the ceiling.
        height: `calc(${SCENE_HEIGHT} * ${1 + EXTEND})`,
        marginTop: `calc(${SCENE_HEIGHT} * ${-SCENE_CEILING})`,
        maskImage: EDGE_FADE,
        WebkitMaskImage: EDGE_FADE,
      }}
    >
      <Canvas
        camera={{ position: CAMERA_START, fov: FOV }}
        dpr={[1, 2]}
        // No shadow map: the ground shadow is <ContactShadows>, and self-
        // shadowing only added acne lines along the groove lips (plus a 2048²
        // depth texture, ~16 MB of GPU memory).
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.25,
        }}
        style={{ background: "transparent" }}
        aria-label="3D Stem Player. Drag a groove to set a stem's level, tap the centre button to play or pause, hold it to turn the device off."
        role="img"
        onCreated={({ gl }) => {
          gl.domElement.addEventListener(
            "webglcontextlost",
            () => {
              if (!unmounted.current) onContextLost?.();
            },
            { once: true },
          );
        }}
      >
        {/* Hemisphere light stands in for the studio environment drei's
            <Environment> would have given us — soft sky-to-ground gradient,
            no PMREM pass, no GPU crash. */}
        <hemisphereLight args={["#FFF7EE", "#C4B9A4", 1.3]} />
        <directionalLight position={[1.5, 4, 2.5]} intensity={1.0} color="#FFFAF3" />
        <directionalLight position={[-3.5, 1.5, 1]} intensity={0.35} color="#EFE6DA" />
        <directionalLight position={[0, 1.2, -4]} intensity={0.7} color="#FFF3E4" />
        {/* Soft bounce so the moulded underside text stays readable when the
            camera orbits below. */}
        <directionalLight position={[0, -4, 1.5]} intensity={0.45} color="#F3E7D8" />

        <Device
          volumes={volumes}
          amplitudes={amplitudes}
          onStemVolume={onStemVolume}
          onTogglePlay={onTogglePlay}
          onVolumeStep={onVolumeStep}
          onTogglePower={onTogglePower}
          onHoldStem={onHoldStem}
        />

        <GroundShadow />
        <ReadySignal onReady={onReady} />
        <ExtendedFrame />
        <FitZoom />

        <OrbitControls
          makeDefault
          enablePan={false}
          // Zoom limits are set by <FitZoom>, which sizes them to the frame.
          enableZoom
          minPolarAngle={0.1}
          maxPolarAngle={Math.PI - 0.1}
          autoRotate={!reduceMotion && !userOrbiting}
          autoRotateSpeed={0.3}
          // Close to the pointer, with a short glide after release. Lower
          // damping made the model trail the finger and coast for ~1 s.
          dampingFactor={0.15}
          rotateSpeed={0.85}
          onStart={() => {
            if (resumeTimer.current) clearTimeout(resumeTimer.current);
            setUserOrbiting(true);
          }}
          // Auto-rotate waits a moment before taking back over, so it doesn't
          // tug the view away the instant you let go.
          onEnd={() => {
            resumeTimer.current = window.setTimeout(() => setUserOrbiting(false), 3000);
          }}
        />
      </Canvas>
    </div>
  );
}

/** Frames the camera on the scene's layout box and lets the extra strip below
 *  continue the same projection, so the canvas can grow without the device
 *  moving or shrinking. R3F would reset the aspect on resize, hence manual. */
function ExtendedFrame() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera & { manual?: boolean };
  const size = useThree((s) => s.size);

  useLayoutEffect(() => {
    const frameHeight = size.height / (1 + EXTEND);
    camera.manual = true;
    camera.aspect = size.width / frameHeight;
    camera.setViewOffset(size.width, frameHeight, 0, 0, size.width, size.height);
    camera.updateProjectionMatrix();
  }, [camera, size]);

  return null;
}

// The device's outline for fitting it in frame: its widest radius at a few
// heights, measured off the mesh. It's a pebble, so a plain cylinder would
// claim room under the rounded edges that the device never fills.
const PROFILE: [y: number, r: number][] = [
  [0, 0.997],
  [0.142, 0.976],
  [0.236, 0.912],
  [0.33, 0.791],
  [0.425, 0.555],
  [HALF_H, 0.3],
];
const RIM = PROFILE.flatMap(([y, r]) =>
  (y === 0 ? [0] : [y, -y]).flatMap((height) =>
    Array.from({ length: 16 }, (_, i) => {
      const a = (i * Math.PI) / 8;
      return new THREE.Vector3(Math.cos(a) * r, height, Math.sin(a) * r);
    }),
  ),
);
// How far into the canvas the rim may reach, in clip space: the sides short
// of the edge, top and bottom at the scene's ceiling and floor.
const FIT_X = 0.94;
const FIT_TOP = 1 - (2 * SCENE_CEILING) / (1 + EXTEND);
const FIT_BOTTOM = 1 - (2 * SCENE_FLOOR) / (1 + EXTEND);

/** Stops zoom where the device would run past the edge of the frame, so it is
 *  never cut off. Worked out from the current angle each frame, since a puck
 *  seen from above needs far more room than one seen side-on.
 *
 *  An angle that needs more room pushes the camera back. The distance the
 *  viewer chose is remembered, so turning back to a roomier angle brings the
 *  camera in again rather than leaving the device small. */
function FitZoom() {
  const controls = useThree((s) => s.controls) as {
    minDistance: number;
    maxDistance: number;
    target: THREE.Vector3;
  } | null;
  const probe = useMemo(() => new THREE.PerspectiveCamera(), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  // The viewer's own distance, and the limit as of the last frame.
  const wanted = useRef(START_DISTANCE);
  const lastMin = useRef(0);

  // After the controls' own update (drei runs it at priority -1), so the
  // distance read here is what they settled on this frame.
  useFrame(({ camera }) => {
    if (!controls) return;
    const distance = camera.position.distanceTo(controls.target);
    // Held at the limit means the frame chose this distance, not the viewer.
    // Anywhere else, the viewer's wheel or pinch put it there.
    if (Math.abs(distance - lastMin.current) > 1e-3) wanted.current = distance;

    probe.projectionMatrix.copy(camera.projectionMatrix);
    dir.copy(camera.position).sub(controls.target).normalize();

    const fits = (at: number) => {
      probe.position.copy(controls.target).addScaledVector(dir, at);
      probe.lookAt(controls.target);
      probe.updateMatrixWorld();
      return RIM.every((p) => {
        point.copy(p).project(probe);
        return Math.abs(point.x) <= FIT_X && point.y <= FIT_TOP && point.y >= FIT_BOTTOM;
      });
    };

    // Fit only ever shrinks as the camera backs off, so bisect for the edge.
    let near = 1.5;
    let far = 12;
    for (let i = 0; i < 14; i++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
    // The headroom stops at the starting distance, so it never pushes the
    // resting view back; the frame alone does that, when it must.
    const roomy = Math.min(far * ZOOM_HEADROOM, START_DISTANCE);
    const min = Math.max(far, roomy, MIN_DISTANCE);
    controls.minDistance = min;
    controls.maxDistance = Math.max(MAX_DISTANCE, min);
    lastMin.current = min;

    // Back to the viewer's distance, or as near it as this angle allows.
    const settle = Math.max(wanted.current, min);
    if (Math.abs(distance - settle) > 1e-4) {
      camera.position.sub(controls.target).setLength(settle).add(controls.target);
      if (settle === min) lastMin.current = settle;
    }
  });

  return null;
}

/** Mounts only once useGLTF has resolved, since it shares the model's Suspense
 *  boundary. Waits for the second frame: the first one compiles shaders. */
function ReadySignal({ onReady }: { onReady?: () => void }) {
  const frames = useRef(0);
  useFrame(() => {
    if (frames.current > 1) return;
    frames.current += 1;
    if (frames.current === 2) onReady?.();
  });
  return null;
}

/** Contact shadow that hides itself once the camera drops below the device —
 *  otherwise the shadow plane sits between the viewer and the underside. */
function GroundShadow() {
  const ref = useRef<THREE.Group>(null);

  useFrame(({ camera }) => {
    if (ref.current) ref.current.visible = camera.position.y > -HALF_H * 0.5;
  });

  return (
    <group ref={ref}>
      <ContactShadows
        position={[0, -HALF_H - 0.015, 0]}
        opacity={0.25}
        scale={3.5}
        blur={3}
        far={1.2}
        resolution={512}
        color="#8a7e6e"
      />
    </group>
  );
}

/** Replaces the model's baked LED strips with procedural, per-stem ones.
 *
 *  The artist baked all four strips into a single emissive texture, so there is
 *  no per-LED geometry to animate — and the bar is continuous (measured: never
 *  dips below 0.80 along an arm), so it cannot be masked into dots either. The
 *  shader instead derives everything from object-space position: which groove a
 *  fragment belongs to, which LED within it, and how far along. Colour comes
 *  from uniforms, so volume can light whole LEDs the way the device does.
 */
function patchLedMaterial(
  material: THREE.MeshPhysicalMaterial,
  level: THREE.Vector4,
  amp: THREE.Vector4,
  center: THREE.Vector3,
  power: { value: number },
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLevel = { value: level };
    shader.uniforms.uAmp = { value: amp };
    shader.uniforms.uCenter = { value: center };
    shader.uniforms.uOn = power;
    shader.uniforms.uDiffuse = material.userData.ledDiffuse ??= { value: 1 };
    shader.uniforms.uBand = { value: new THREE.Vector2(LED_R_MIN, LED_R_MAX) };
    LED_PALETTE.forEach((hex, i) => {
      shader.uniforms[`uLed${i}`] = { value: new THREE.Color(hex) };
    });

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vObjPos;\nuniform vec3 uCenter;",
      )
      // Mesh-local coords are not centred on the device — the GLB does that via
      // the node transform — so subtract the centre here. Without it, +Y does
      // not mean "top half".
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjPos = position - uCenter;");

    shader.fragmentShader = shader.fragmentShader
      // Sink each LED into a small well: darken the floor and rim, then tilt
      // the normal inward around the edge so the light reacts to a depression.
      .replace(
        "#include <map_fragment>",
        `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          // The legal text is printed as dark ink in the base map. On the real
          // device it is moulded silicone: the same colour as the shell, read
          // mostly by relief. Pull the glyph colour most of the way to the body tone
          // and let bumpMap (same texture) raise it instead.
          vec3 flatTone = texture2D( map, vec2( 0.02, 0.02 ) ).rgb;
          float lum = max( max( sampledDiffuseColor.r, sampledDiffuseColor.g ), sampledDiffuseColor.b );
          float flatLum = max( max( flatTone.r, flatTone.g ), flatTone.b );
          float ink = 1.0 - smoothstep( 0.45, 0.92, lum / max( flatLum, 1e-4 ) );
          // A trace of the ink is kept so the relief stays legible from a distance.
          sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, flatTone, ink * 0.75 );
          diffuseColor *= sampledDiffuseColor;
        #endif
        {
          Groove g = grooveAt();
          // The channel reads shallow if only its walls are shaded, so occlude
          // the whole floor and deepen it further right around each LED well.
          float chan = channelMask( g );
          float well = ( 1.0 - smoothstep( LED_RADIUS * 0.9, LED_RADIUS * 1.7, g.dist ) )
                     * step( 0.0, vObjPos.y );
          diffuseColor.rgb *= mix( 1.0, 0.66, chan );
          diffuseColor.rgb *= mix( 1.0, 0.92, well );

        }`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        vec3 nShaped = normal;
        {
          Groove g = grooveAt();
          float top = step( 0.0, vObjPos.y );

          // The model's groove wall is a narrow, steep strip that the lights
          // barely reach, so each side rendered as a thin dark line when zoomed
          // in. Its normals are replaced with a wide, gentle slope: a soft
          // moulded channel rather than a cut. The band starts on the floor and
          // ends past the real wall, and fades at both ends, so it joins the
          // model's own normals without a seam.
          {
            float cd = channelSDF( g );
            float band = smoothstep( -0.01, 0.015, cd ) * ( 1.0 - smoothstep( 0.05, 0.075, cd ) ) * top;
            float slope = sin( clamp( ( cd + 0.01 ) / 0.085, 0.0, 1.0 ) * PI ) * 0.9;
            // Outward direction from the capsule, straight sides and round ends.
            float mid = ( uBand.x + uBand.y ) * 0.5;
            float halfSeg = ( uBand.y - uBand.x ) * 0.5 + 0.048 - GROOVE_HALF_W;
            float xa = sign( g.along - mid ) * max( abs( g.along - mid ) - halfSeg, 0.0 );
            vec2 outward = normalize( g.u * xa + g.v * g.dv + vec2( 1e-6 ) );
            vec3 bevel = normalize( vec3( 0.0, 1.0, 0.0 ) - vec3( outward.x, 0.0, outward.y ) * slope );
            normal = normalize( mix( normal, normalize( normalMatrix * bevel ), band ) );
          }

          // Each LED sits in its own dish at the bottom of the channel. The rim
          // fades out before the cell boundary: the tilt direction flips there,
          // and a rim that reached it drew a hard line across the groove.
          vec2 ldir = normalize( g.u * ( g.along - mix( uBand.x, uBand.y, ( g.idx + 0.5 ) / LED_COUNT ) ) + g.v * g.dv + vec2( 1e-6 ) );
          float rim = smoothstep( LED_RADIUS * 0.45, LED_RADIUS * 0.75, g.dist )
                    * ( 1.0 - smoothstep( LED_RADIUS * 0.75, LED_RADIUS * 0.98, g.dist ) ) * top;
          normal = normalize( normal - normalMatrix * vec3( ldir.x, 0.0, ldir.y ) * rim * 0.5 );

          // Keep our own channel/well shaping, but drop the bumpMap on the top
          // face (see normal_fragment_maps below).
          nShaped = normal;
        }`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        // bumpMap is only wanted for the moulded text underneath; on the top
        // face its texture seams read as hard lines through the channel.
        normal = mix( normal, nShaped, step( 0.0, vObjPos.y ) );

        // Shape-agnostic crease accent: darkens wherever the surface actually
        // bends, so modelled edges (pad rims, ports, channel walls) read as
        // tactile without any hand-placed geometry to get wrong.
        float curv = clamp( length( fwidth( normal ) ) * 1.8, 0.0, 1.0 );`,
      )
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix( 1.0, 0.72, curv );`,
      )
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vObjPos;
        uniform vec4 uLevel;
        uniform vec4 uAmp;
        uniform vec2 uBand;
        uniform float uOn;
        uniform float uDiffuse;
        uniform vec3 uLed0;
        uniform vec3 uLed1;
        uniform vec3 uLed2;
        uniform vec3 uLed3;
        uniform vec3 uLed4;
        #define LED_COUNT 5.0
        // Spacing along the groove is (0.735-0.334)/5 = 0.080 and the groove
        // half-width is 0.053, so this keeps gaps and stays inside the channel.
        #define LED_RADIUS 0.040
        // How far light spreads into the silicone around each LED. Real ones
        // diffuse through the rubber rather than ending at a hard edge.
        #define LED_BLEED 0.058
        #define GROOVE_HALF_W 0.053

        // three declares normalMatrix only in the vertex prefix, but WebGL
        // uniforms are per-program, so redeclaring it here picks up the value.
        uniform mat3 normalMatrix;

        struct Groove {
          float armF;
          float along;   // distance along the groove axis
          float dv;      // signed offset across the channel
          float dist;    // distance to the nearest LED centre
          float idx;     // which LED that is
          vec2 u;        // groove axis in XZ
          vec2 v;        // across-channel direction in XZ
        };

        // Single source of truth for groove and LED placement. Shading, normals
        // and emission all read from here so the channel, the well and the light
        // sitting in it cannot drift apart.
        //
        // Histogramming lit vertices puts the four grooves on the axes
        // (0/90/180/270), so the angle snaps to them — binning between them
        // would split each groove down the middle across two stems. Distance is
        // measured along the groove's OWN axis, not radius from the device
        // centre, which would make every LED boundary an arc.
        Groove grooveAt() {
          Groove g;
          float ang = atan( vObjPos.x, vObjPos.z ) / ( 2.0 * PI ) + 0.5;
          g.armF = mod( floor( ang * 4.0 + 0.5 ), 4.0 );
          float theta = ( g.armF / 4.0 - 0.5 ) * 2.0 * PI;
          g.u = vec2( sin( theta ), cos( theta ) );
          g.v = vec2( g.u.y, -g.u.x );

          g.along = dot( vObjPos.xz, g.u );
          float t = clamp( ( g.along - uBand.x ) / ( uBand.y - uBand.x ), 0.0, 1.0 );
          g.idx = min( floor( t * LED_COUNT ), LED_COUNT - 1.0 );

          float centerAlong = mix( uBand.x, uBand.y, ( g.idx + 0.5 ) / LED_COUNT );
          g.dv = dot( vObjPos.xz, g.v );
          g.dist = length( vec2( g.along - centerAlong, g.dv ) );
          return g;
        }

        // Signed distance to the moulded slot. A capsule, not a box: crossing
        // two 1-D falloffs gives hard corners, which showed up as a rectangle
        // sitting inside the model's rounded channel.
        float channelSDF( Groove g ) {
          float mid = ( uBand.x + uBand.y ) * 0.5;
          float halfSeg = ( uBand.y - uBand.x ) * 0.5 + 0.048 - GROOVE_HALF_W;
          float x = max( abs( g.along - mid ) - halfSeg, 0.0 );
          return length( vec2( x, g.dv ) ) - GROOVE_HALF_W;
        }

        // 1 on the channel floor, falling to 0 outside it. The falloff is wide
        // so the occlusion ramps up to the model's own groove edge instead of
        // drawing an edge of its own.
        float channelMask( Groove g ) {
          return ( 1.0 - smoothstep( -0.03, 0.014, channelSDF( g ) ) )
               * step( 0.0, vObjPos.y );
        }


        // mix() chain rather than an indexed array: the index is computed, and
        // GLSL ES 1.0 only allows constant expressions for uniform array reads.
        vec3 ledPalette( float i ) {
          vec3 c = uLed0;
          c = mix( c, uLed1, step( 0.5, i ) );
          c = mix( c, uLed2, step( 1.5, i ) );
          c = mix( c, uLed3, step( 2.5, i ) );
          c = mix( c, uLed4, step( 3.5, i ) );
          return c;
        }

        // Light from every LED in the groove, summed, so neighbouring glows blend
        // with no seam at cell boundaries. Each LED is a near-white hot core, a
        // saturated halo, and a wide faint bleed into the surrounding silicone,
        // the way a real LED reads through a rubber skin. The palette is
        // pastel, so it is pushed toward saturation first; ACES tone mapping
        // would otherwise wash every LED out to the same off-white.
        //
        // Volume lights WHOLE LEDs: LED i is on once nLit passes it, so
        // dragging never leaves one half-lit.
        vec3 ledGlow( Groove g, float nLit ) {
          vec3 glow = vec3( 0.0 );
          for ( int k = 0; k < 5; k++ ) {
            float i = float( k );
            float c = mix( uBand.x, uBand.y, ( i + 0.5 ) / LED_COUNT );
            float d = length( vec2( g.along - c, g.dv ) );
            vec3 lc = ledPalette( i );
            lc = max( mix( vec3( dot( lc, vec3( 0.299, 0.587, 0.114 ) ) ), lc, 1.6 ), 0.0 );
            float core = 1.0 - smoothstep( LED_RADIUS * 0.15, LED_RADIUS * 0.8, d );
            float halo = exp( -( d * d ) / ( LED_RADIUS * LED_RADIUS * 1.1 ) );
            float bleed = exp( -( d * d ) / ( LED_BLEED * LED_BLEED * 2.5 * uDiffuse * uDiffuse ) );
            glow += ( mix( lc, vec3( 1.0 ), 0.12 ) * core * 0.8 + lc * halo * 0.75 + lc * bleed * 0.22 * uDiffuse )
                  * step( i + 0.5, nLit );
          }
          return glow;
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        // Runs unconditionally: the LEDs come from the emissive colour and the
        // groove maths, never from a texture.
        `
        {
          Groove g = grooveAt();

          // One-hot select instead of dynamic array indexing, which GLSL ES 1.0
          // does not allow on uniforms.
          vec4 onehot = vec4(
            step( -0.5, g.armF ) * step( g.armF, 0.5 ),
            step( 0.5, g.armF ) * step( g.armF, 1.5 ),
            step( 1.5, g.armF ) * step( g.armF, 2.5 ),
            step( 2.5, g.armF ) * step( g.armF, 3.5 )
          );
          float lvl = dot( uLevel, onehot );
          float a = dot( uAmp, onehot );

          // How many whole LEDs this groove's level lights.
          float nLit = ceil( lvl * LED_COUNT - 0.0001 );

          // Top face only — the pattern is derived from XZ, so without this it
          // mirrors onto the underside.
          float topOnly = step( 0.0, vObjPos.y );

          totalEmissiveRadiance *=
            ledGlow( g, nLit ) * topOnly * uOn * ( 0.8 + a * 1.2 );
        }
        `,
      );
  };
  material.needsUpdate = true;
}

function Device({
  volumes,
  amplitudes,
  onStemVolume,
  onTogglePlay,
  onVolumeStep,
  onTogglePower,
  onHoldStem,
}: Props) {
  const { scene } = useGLTF(MODEL_URL);
  const reduceMotion = useReducedMotion();
  const deviceColor = usePlayerStore((s) => s.deviceColor);
  const isOn = usePlayerStore((s) => s.isOn);
  const maxAnisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  // OrbitControls attaches to r3f's event source (the div around the canvas,
  // not the canvas) and sets touch-action: none on it.
  const eventSource = useThree((s) => (s.events.connected ?? s.gl.domElement) as HTMLElement);
  const drag = useRef<DragState>(idle());

  // Vertical swipes over the device scroll the page (.device-touch in
  // app.css overrides OrbitControls' touch-action: none). A touch that lands
  // on a control cancels that scroll, so grooves still drag in any
  // direction. Pointer events come before touch events, so handleDown has
  // already claimed the touch by the time touchstart arrives.
  useEffect(() => {
    const claim = (e: TouchEvent) => {
      if (drag.current.mode !== "none") e.preventDefault();
    };
    eventSource.addEventListener("touchstart", claim, { passive: false });
    return () => eventSource.removeEventListener("touchstart", claim);
  }, [eventSource]);

  // Power and isolate fire on a timer while still held, so the device reacts
  // under your finger instead of waiting for release.
  const holdTimer = useRef<number | null>(null);
  const clearHold = () => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const releaseIsolate = () => {
    if (drag.current.isolating && drag.current.stem) onHoldStem?.(drag.current.stem, false);
  };
  const releaseRef = useRef(releaseIsolate);
  releaseRef.current = releaseIsolate;

  // Safety net: if the pointer is released off the model, the mesh never sees
  // pointerup and OrbitControls would stay disabled forever.
  useEffect(() => {
    const end = () => {
      clearHold();
      releaseRef.current();
      drag.current = idle();
      if (controls) controls.enabled = true;
      document.body.style.cursor = "";
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      clearHold();
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [controls]);

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    const zone = zoneAt(e.point);
    if (!zone) return; // not a control — let OrbitControls orbit
    // While powered off only the top button responds, so it can switch back on.
    if (!isOn && zone.kind !== "button") return;
    e.stopPropagation();
    if (controls) controls.enabled = false;
    drag.current = {
      mode: zone.kind,
      stem: zone.kind === "groove" ? zone.stem : null,
      delta: zone.kind === "volume" ? zone.delta : 0,
      sx: e.clientX,
      sy: e.clientY,
      t0: performance.now(),
      firedHold: false,
      isolating: false,
    };
    if (zone.kind === "groove") {
      onStemVolume?.(zone.stem, zone.value);
      if (zone.value >= ISOLATE_FROM) {
        const stem = zone.stem;
        clearHold();
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = null;
          drag.current.isolating = true;
          onHoldStem?.(stem, true);
        }, ISOLATE_HOLD_MS);
      }
    }
    if (zone.kind === "button") {
      clearHold();
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        drag.current.firedHold = true;
        onTogglePower?.();
      }, POWER_HOLD_MS);
    }
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (drag.current.mode === "none") {
      document.body.style.cursor = zoneAt(e.point) ? "pointer" : "";
      return;
    }
    if (drag.current.mode === "button") {
      const moved = Math.hypot(e.clientX - drag.current.sx, e.clientY - drag.current.sy);
      if (moved >= 6) clearHold();
      return;
    }
    if (drag.current.mode !== "groove") return;
    e.stopPropagation();
    // Dragging along the groove sets its level; only a still hold isolates.
    if (Math.hypot(e.clientX - drag.current.sx, e.clientY - drag.current.sy) >= 6) clearHold();
    const zone = zoneAt(e.point);
    // Only track the groove that was grabbed, so a wandering finger cannot
    // jump the value onto a neighbouring stem.
    if (zone?.kind === "groove" && zone.stem === drag.current.stem) {
      onStemVolume?.(zone.stem, zone.value);
    }
  };

  const handleUp = (e: ThreeEvent<PointerEvent>) => {
    if (drag.current.mode === "none") return;
    e.stopPropagation();
    clearHold();
    releaseIsolate();
    const moved = Math.hypot(e.clientX - drag.current.sx, e.clientY - drag.current.sy);
    // Treat as a press only if it was a tap, not the start of an orbit.
    if (moved < 6) {
      // Power already fired mid-hold; releasing must not also toggle play.
      if (drag.current.mode === "button" && !drag.current.firedHold && isOn) {
        onTogglePlay?.();
      }
      if (drag.current.mode === "volume") onVolumeStep?.(drag.current.delta);
    }
    drag.current = idle();
    if (controls) controls.enabled = true;
  };

  const level = useRef(new THREE.Vector4(1, 1, 1, 1));
  const amp = useRef(new THREE.Vector4(0, 0, 0, 0));
  const power = useRef({ value: 1 });
  // The shell material can be rebuilt without deviceColor changing (a
  // remount, or a hot reload in dev). Applying the colourway only on colour
  // changes left a rebuilt shell in its default tan while the picker showed
  // another colour, so it is also applied as the material is built, and the
  // effect below re-runs on every rebuild.
  const build = useMemo(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;

      let mat = mesh.material as THREE.MeshPhysicalMaterial;
      // Only the outer shell is a closed solid. The port cavities and speaker
      // are open surfaces whose inner walls are back-faces, so forcing
      // FrontSide on them punched holes in the cutouts.
      mat.side = mat.name === "Stemplayer" ? THREE.FrontSide : THREE.DoubleSide;
      if (mat.name === "Stemplayer") {
        // The loader gives us MeshStandardMaterial, which has no transmission.
        // Rebuild as physical, carrying the base map across. The LEDs are
        // drawn by the shader (patchLedMaterial); the artist's baked LED map
        // was never sampled, so it has been stripped from the GLB.
        const phys = new THREE.MeshPhysicalMaterial({
          name: mat.name,
          map: mat.map,
          emissive: mat.emissive,
          metalness: mat.metalness,
          roughness: mat.roughness,
          side: mat.side,
        });
        phys.ior = 1.46;
        phys.clearcoatRoughness = 0.6;
        // Silicone has a soft, slightly velvety rim where it turns away from
        // the viewer; sheen gives that instead of reading as matte plastic.
        phys.sheen = 0.35;
        phys.sheenRoughness = 0.6;
        phys.sheenColor.set("#fff1e6"); // cooled for Clear in applyColorway
        mesh.material = phys;
        mat = phys;
        applyColorway(phys, usePlayerStore.getState().deviceColor);
        mat.emissiveIntensity = 1.15;
        // Reuse the base map as a height field so the legal text stands proud.
        // Negative scale because the glyphs are the map's *dark* pixels.
        if (mat.map) {
          mat.map.anisotropy = maxAnisotropy;
          mat.bumpMap = mat.map;
          mat.bumpScale = -0.1;
        }
        mesh.geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        mesh.geometry.boundingBox!.getCenter(center);
        patchLedMaterial(mat, level.current, amp.current, center, power.current);
      }
    });
    return {};
  }, [scene, maxAnisotropy]);

  // Tints whatever material is on the shell now. Holding a reference to the
  // one useMemo built isn't safe: Strict Mode can build twice and keep the
  // first result, leaving the effect tinting a material nothing renders.
  useEffect(() => {
    scene.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
      if ((obj as THREE.Mesh).isMesh && mat?.name === "Stemplayer") applyColorway(mat, deviceColor);
    });
  }, [scene, build, deviceColor]);

  useFrame(({ clock }) => {
    const l = level.current;
    const a = amp.current;
    const { status, processingProgress } = usePlayerStore.getState();

    // While the song separates, the device itself is the progress indicator:
    // each groove fills hub to rim in turn. With reduced motion they hold
    // still at the job's progress instead.
    if (status === "processing") {
      power.current.value = 1;
      const t = clock.getElapsedTime();
      for (let i = 0; i < 4; i++) {
        const v = reduceMotion
          ? Math.max(0.2, processingProgress / 100)
          : (t * 0.9 + i * 0.25) % 1.2; // clamped below, so each arm holds full briefly
        l.setComponent(i, Math.min(1, v));
        a.setComponent(i, 0);
      }
      return;
    }

    power.current.value = isOn ? 1 : 0;
    for (let i = 0; i < 4; i++) {
      const stem = ARM_ORDER[i];
      l.setComponent(i, volumes[stem] ?? 0);
      a.setComponent(i, amplitudes[stem] ?? 0);
    }
  });

  return (
    <primitive
      object={scene}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerOut={() => {
        if (drag.current.mode === "none") document.body.style.cursor = "";
      }}
    />
  );
}
