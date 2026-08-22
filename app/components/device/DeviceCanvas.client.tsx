import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, ContactShadows, useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { DeviceColor, StemName } from "~/lib/constants";
import { usePlayerStore } from "~/lib/store";

const MODEL_URL = "/models/stemplayer.glb";
useGLTF.preload(MODEL_URL);

// Device half-height after the asset pipeline centres it on the origin.
const HALF_H = 0.472;

// The shader derives an arm index from atan(x, z): 0 = -Z, 1 = -X, 2 = +Z,
// 3 = +X. This maps each of those grooves to a stem.
const ARM_ORDER: StemName[] = ["bass", "other", "vocals", "drums"];

// Radial span of the lit strip, measured off the mesh by sampling the emissive
// map at every body vertex — not eyeballed. Dots misalign with the texture's
// colour ramp if this is off, which reads as half-pink/half-white LEDs.
const LED_R_MIN = 0.334;
const LED_R_MAX = 0.735;

// The baked map is a continuous cyan→blue→white→lavender→magenta ramp, so each
// LED takes one solid colour sampled from its own stretch of that ramp.
const LED_PALETTE = ["#4CC2DB", "#9EC2DE", "#D1E5F5", "#C79AD9", "#DA66D6"];

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
}

const COLORWAYS: Record<DeviceColor, Colorway> = {
  tan: {
    tint: [1.24, 1.17, 1.12],
    roughness: 0.62,
    transmission: 0,
    thickness: 0,
    clearcoat: 0,
    attenuation: "#ffffff",
    attenuationDistance: Infinity,
  },
  bao: {
    tint: [1.45, 2.2, 3.0],
    roughness: 0.58,
    transmission: 0,
    thickness: 0,
    clearcoat: 0,
    attenuation: "#ffffff",
    attenuationDistance: Infinity,
  },
  clear: {
    // Neutralise the tan base map so the look comes from the light passing
    // through rather than from the shell's own colour.
    tint: [1.0, 1.5, 2.0],
    roughness: 0.28,
    transmission: 0.82,
    thickness: 0.26,
    clearcoat: 0.6,
    // Light, barely-warm absorption over a long distance: smoked, not tinted.
    attenuation: "#CFC9BA",
    attenuationDistance: 1.8,
  },
};

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
}

// The rocker's two halves, split at the midpoint between the embossed glyphs
// ("+" at 3°, "−" at 29°). Angles stay signed (atan2 range) because the pad
// straddles 0°. Stops short of the strap mount at 43-76°, which is not a
// control; power lives on the centre button.
const VOL_UP_ARC: [number, number] = [-11, 17];
const VOL_DOWN_ARC: [number, number] = [17, 42];

// The real device powers on/off by holding the top button for a couple of
// seconds; a short press is play/pause.
const POWER_HOLD_MS = 1000;

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
  if (rXZ > 0.88 && Math.abs(p.y) < 0.17) {
    const deg = (Math.atan2(p.x, p.z) * 180) / Math.PI;
    if (deg >= VOL_UP_ARC[0] && deg < VOL_UP_ARC[1]) {
      return { kind: "volume", delta: 0.1 };
    }
    if (deg >= VOL_DOWN_ARC[0] && deg <= VOL_DOWN_ARC[1]) {
      return { kind: "volume", delta: -0.1 };
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

  const value = Math.min(
    1,
    Math.max(0, (along - LED_R_MIN) / (LED_R_MAX - LED_R_MIN))
  );
  return { kind: "groove", stem: ARM_ORDER[armF], value };
}

export default function DeviceCanvas({
  volumes,
  amplitudes,
  onStemVolume,
  onTogglePlay,
  onVolumeStep,
  onTogglePower,
}: Props) {
  return (
    // The ground shadow darkens the transparent canvas, so the canvas's own
    // bottom edge showed up as a hard horizontal seam against the page. Fade
    // the last slice out so it blends at any zoom.
    <div
      className="relative w-full"
      style={{
        height: "clamp(340px, 45vw, 480px)",
        maskImage: "linear-gradient(to bottom, black 82%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 82%, transparent 100%)",
      }}
    >
      <Canvas
        camera={{ position: [0, 3.35, 2.9], fov: 28 }}
        dpr={[1, 2]}
        shadows
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.25,
        }}
        style={{ background: "transparent" }}
      >
        {/* Hemisphere light stands in for the studio environment drei's
            <Environment> would have given us — soft sky-to-ground gradient,
            no PMREM pass, no GPU crash. */}
        <hemisphereLight args={["#FFF7EE", "#C4B9A4", 1.3]} />
        <directionalLight
          position={[1.5, 4, 2.5]}
          intensity={1.0}
          color="#FFFAF3"
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-bias={-0.0003}
        />
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
        />

        <GroundShadow />

        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom
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
  power: { value: number }
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLevel = { value: level };
    shader.uniforms.uAmp = { value: amp };
    shader.uniforms.uCenter = { value: center };
    shader.uniforms.uOn = power;
    shader.uniforms.uBand = { value: new THREE.Vector2(LED_R_MIN, LED_R_MAX) };
    LED_PALETTE.forEach((hex, i) => {
      shader.uniforms[`uLed${i}`] = { value: new THREE.Color(hex) };
    });

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vObjPos;\nuniform vec3 uCenter;"
      )
      // Mesh-local coords are not centred on the device — the GLB does that via
      // the node transform — so subtract the centre here. Without it, +Y does
      // not mean "top half".
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvObjPos = position - uCenter;"
      );

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
          // only by relief. Swap the glyph colour back to the flat body tone
          // and let bumpMap (same texture) raise it instead.
          vec3 flatTone = texture2D( map, vec2( 0.02, 0.02 ) ).rgb;
          float lum = max( max( sampledDiffuseColor.r, sampledDiffuseColor.g ), sampledDiffuseColor.b );
          float flatLum = max( max( flatTone.r, flatTone.g ), flatTone.b );
          float ink = 1.0 - smoothstep( 0.45, 0.92, lum / max( flatLum, 1e-4 ) );
          sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, flatTone, ink );
          diffuseColor *= sampledDiffuseColor;
        #endif
        {
          Groove g = grooveAt();
          // The channel reads shallow if only its walls are shaded, so occlude
          // the whole floor and deepen it further right around each LED well.
          float chan = channelMask( g );
          float well = ( 1.0 - smoothstep( LED_RADIUS * 0.9, LED_RADIUS * 1.7, g.dist ) )
                     * step( 0.0, vObjPos.y );
          diffuseColor.rgb *= mix( 1.0, 0.68, chan );
          diffuseColor.rgb *= mix( 1.0, 0.92, well );

        }`
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        vec3 nShaped = normal;
        {
          Groove g = grooveAt();
          float top = step( 0.0, vObjPos.y );

          // Channel walls: tilt inward across the trench so the sides catch
          // light like a moulded groove rather than a painted stripe.
          float cd = channelSDF( g );
          float wall = ( 1.0 - smoothstep( 0.0, 0.018, abs( cd ) ) ) * step( -0.020, cd ) * top;
          vec2 wdir = normalize( g.v * g.dv + vec2( 1e-6 ) );
          normal = normalize( normal - normalMatrix * vec3( wdir.x, 0.0, wdir.y ) * wall * 0.85 );

          // The LED sits in its own dish at the bottom of that channel.
          vec2 ldir = normalize( g.u * ( g.along - mix( uBand.x, uBand.y, ( g.idx + 0.5 ) / LED_COUNT ) ) + g.v * g.dv + vec2( 1e-6 ) );
          float rim = smoothstep( LED_RADIUS * 0.55, LED_RADIUS, g.dist )
                    * ( 1.0 - smoothstep( LED_RADIUS, LED_RADIUS * 1.5, g.dist ) ) * top;
          normal = normalize( normal - normalMatrix * vec3( ldir.x, 0.0, ldir.y ) * rim * 0.5 );

          // Keep our own channel/well shaping, but drop the bumpMap on the top
          // face (see normal_fragment_maps below).
          nShaped = normal;
        }`
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
        float curv = clamp( length( fwidth( normal ) ) * 1.8, 0.0, 1.0 );`
      )
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix( 1.0, 0.72, curv );`
      )
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vObjPos;
        uniform vec4 uLevel;
        uniform vec4 uAmp;
        uniform vec2 uBand;
        uniform float uOn;
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

        // 1 on the channel floor, falling to 0 outside it. Drives both the
        // occlusion in the trench and the wall shading.
        float channelMask( Groove g ) {
          return ( 1.0 - smoothstep( -0.014, 0.002, channelSDF( g ) ) )
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
                }`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `
        #ifdef USE_EMISSIVEMAP
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

          // A soft core plus a gaussian bleed, so the light diffuses into the
          // silicone instead of stopping at a hard circle.
          float core = 1.0 - smoothstep( LED_RADIUS * 0.30, LED_RADIUS * 1.30, g.dist );
          float bleed = exp( -( g.dist * g.dist ) / ( LED_BLEED * LED_BLEED ) );
          float dotMask = min( 1.0, core * 0.80 + bleed * 0.45 );

          // Volume fills the strip outward in WHOLE LEDs. Quantising the count
          // first puts the cut on an integer cell boundary — i.e. in the gap
          // between two LEDs — so dragging never leaves one half-lit. Without
          // the ceil the boundary slides through an LED's centre.
          float cellPos = ( g.along - uBand.x ) / ( uBand.y - uBand.x ) * LED_COUNT;
          float nLit = ceil( lvl * LED_COUNT - 0.0001 );
          float lit = 1.0 - smoothstep( nLit - 0.2, nLit + 0.2, cellPos );
          float idx = g.idx;

          // Top face only — the pattern is derived from XZ, so without this it
          // mirrors onto the underside.
          float topOnly = step( 0.0, vObjPos.y );

          totalEmissiveRadiance *=
            ledPalette( idx ) * dotMask * lit * topOnly * uOn * ( 0.55 + a * 1.4 );
        #endif
        `
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
}: Props) {
  const { scene } = useGLTF(MODEL_URL);
  const deviceColor = usePlayerStore((s) => s.deviceColor);
  const isOn = usePlayerStore((s) => s.isOn);
  const maxAnisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const drag = useRef<{
    mode: "none" | "button" | "groove" | "volume";
    stem: StemName | null;
    delta: number;
    sx: number;
    sy: number;
    t0: number;
    firedHold: boolean;
  }>({ mode: "none", stem: null, delta: 0, sx: 0, sy: 0, t0: 0, firedHold: false });

  // Power fires on a timer while the button is still held, so the device
  // reacts under your finger instead of waiting for release.
  const holdTimer = useRef<number | null>(null);
  const clearHold = () => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  // Safety net: if the pointer is released off the model, the mesh never sees
  // pointerup and OrbitControls would stay disabled forever.
  useEffect(() => {
    const end = () => {
      clearHold();
      drag.current = { mode: "none", stem: null, delta: 0, sx: 0, sy: 0, t0: 0, firedHold: false };
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
    };
    if (zone.kind === "groove") onStemVolume?.(zone.stem, zone.value);
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
    const moved = Math.hypot(e.clientX - drag.current.sx, e.clientY - drag.current.sy);
    // Treat as a press only if it was a tap, not the start of an orbit.
    if (moved < 6) {
      // Power already fired mid-hold; releasing must not also toggle play.
      if (drag.current.mode === "button" && !drag.current.firedHold && isOn) {
        onTogglePlay?.();
      }
      if (drag.current.mode === "volume") onVolumeStep?.(drag.current.delta);
    }
    drag.current = { mode: "none", stem: null, delta: 0, sx: 0, sy: 0, t0: 0, firedHold: false };
    if (controls) controls.enabled = true;
  };

  const level = useRef(new THREE.Vector4(1, 1, 1, 1));
  const amp = useRef(new THREE.Vector4(0, 0, 0, 0));
  const power = useRef({ value: 1 });
  const body = useRef<THREE.MeshPhysicalMaterial | null>(null);

  useMemo(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      let mat = mesh.material as THREE.MeshPhysicalMaterial;
      // Only the outer shell is a closed solid. The port cavities and speaker
      // are open surfaces whose inner walls are back-faces, so forcing
      // FrontSide on them punched holes in the cutouts.
      mat.side = mat.name === "Stemplayer" ? THREE.FrontSide : THREE.DoubleSide;
      if (mat.name === "Stemplayer") {
        // The loader gives us MeshStandardMaterial, which has no transmission.
        // Rebuild as physical, carrying the maps across.
        const phys = new THREE.MeshPhysicalMaterial({
          name: mat.name,
          map: mat.map,
          emissive: mat.emissive,
          emissiveMap: mat.emissiveMap,
          metalness: mat.metalness,
          roughness: mat.roughness,
          side: mat.side,
        });
        phys.ior = 1.46;
        phys.clearcoatRoughness = 0.18;
        mesh.material = phys;
        mat = phys;
        body.current = mat;
        mat.emissiveIntensity = 1.15;
        // The LED dots sit ~40 texels apart in a 4096 map that lands on a few
        // hundred screen pixels. At the default anisotropy the mip chain blurs
        // neighbouring dots into one continuous stripe.
        if (mat.emissiveMap) {
          mat.emissiveMap.anisotropy = maxAnisotropy;
          mat.emissiveMap.needsUpdate = true;
        }
        // Reuse the base map as a height field so the legal text stands proud.
        // Negative scale because the glyphs are the map's *dark* pixels.
        if (mat.map) {
          mat.map.anisotropy = maxAnisotropy;
          mat.bumpMap = mat.map;
          mat.bumpScale = -0.06;
        }
        mesh.geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        mesh.geometry.boundingBox!.getCenter(center);
        patchLedMaterial(mat, level.current, amp.current, center, power.current);
      }
    });
  }, [scene, maxAnisotropy]);

  useEffect(() => {
    const mat = body.current;
    if (!mat) return;
    const cw = COLORWAYS[deviceColor];
    mat.color.setRGB(cw.tint[0], cw.tint[1], cw.tint[2]);
    mat.roughness = cw.roughness;
    mat.transmission = cw.transmission;
    mat.thickness = cw.thickness;
    mat.clearcoat = cw.clearcoat;
    mat.attenuationColor.set(cw.attenuation);
    mat.attenuationDistance = cw.attenuationDistance;
    mat.transparent = cw.transmission > 0;
    // Toggling transmission changes the shader defines.
    mat.needsUpdate = true;
  }, [deviceColor]);

  useFrame(() => {
    power.current.value = isOn ? 1 : 0;
    const l = level.current;
    const a = amp.current;
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
