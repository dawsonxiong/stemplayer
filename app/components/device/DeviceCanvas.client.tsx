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
const COLORWAYS: Record<
  DeviceColor,
  { tint: [number, number, number]; roughness: number }
> = {
  tan: { tint: [1.24, 1.17, 1.12], roughness: 0.62 },
  bao: { tint: [1.45, 2.2, 3.0], roughness: 0.58 },
  // Approximation only: the real clear is translucent smoke. True transmission
  // needs an env map to read correctly, and drei's <Environment> is what was
  // crashing the context, so this is a tinted opaque stand-in.
  clear: { tint: [0.69, 1.05, 1.44], roughness: 0.34 },
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

// The volume rocker is a single pill running from -2° to 33°, with the "+"
// glyph at 3° and "−" at 29° — read off the model by hovering the embossed
// marks. Angles stay signed (atan2 range) because the pill straddles 0°.
// The two-hole pill at 43-76° is a strap mount, not a control, and the round
// button past it is deliberately inert: power lives on the centre button.
const VOL_UP_ARC: [number, number] = [-6, 16];
const VOL_DOWN_ARC: [number, number] = [16, 36];

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
  material: THREE.MeshStandardMaterial,
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
          float d, i, arm; vec2 dir;
          ledGeom( d, i, dir, arm );
          float well = ( 1.0 - smoothstep( LED_RADIUS * 0.95, LED_RADIUS * 1.55, d ) )
                     * step( 0.0, vObjPos.y );
          diffuseColor.rgb *= mix( 1.0, 0.66, well );
        }`
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        {
          float d, i, arm; vec2 dir;
          ledGeom( d, i, dir, arm );
          float rim = smoothstep( LED_RADIUS * 0.55, LED_RADIUS, d )
                    * ( 1.0 - smoothstep( LED_RADIUS, LED_RADIUS * 1.5, d ) )
                    * step( 0.0, vObjPos.y );
          normal = normalize( normal - normalMatrix * vec3( dir.x, 0.0, dir.y ) * rim * 0.6 );
        }`
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
        #define LED_RADIUS 0.033

        // three declares normalMatrix only in the vertex prefix, but WebGL
        // uniforms are per-program, so redeclaring it here picks up the value.
        uniform mat3 normalMatrix;

        // Single source of truth for LED placement: distance from the nearest
        // LED centre, its index, the outward XZ direction and which groove it
        // belongs to. The shading, normal and emissive passes all read from
        // here so the well and the light it holds cannot drift apart.
        //
        // Histogramming lit vertices puts the four grooves on the axes
        // (0/90/180/270), so the angle snaps to them — binning between them
        // would split each groove down the middle across two stems. Distance is
        // measured along the groove's OWN axis, not radius from the device
        // centre, which would make every LED boundary an arc.
        void ledGeom( out float dist, out float idx, out vec2 dirXZ, out float armF ) {
          float ang = atan( vObjPos.x, vObjPos.z ) / ( 2.0 * PI ) + 0.5;
          armF = mod( floor( ang * 4.0 + 0.5 ), 4.0 );
          float theta = ( armF / 4.0 - 0.5 ) * 2.0 * PI;
          vec2 u = vec2( sin( theta ), cos( theta ) );
          vec2 v = vec2( u.y, -u.x );

          float along = dot( vObjPos.xz, u );
          float t = clamp( ( along - uBand.x ) / ( uBand.y - uBand.x ), 0.0, 1.0 );
          idx = min( floor( t * LED_COUNT ), LED_COUNT - 1.0 );

          float centerAlong = mix( uBand.x, uBand.y, ( idx + 0.5 ) / LED_COUNT );
          float du = along - centerAlong;
          float dv = dot( vObjPos.xz, v );
          dist = length( vec2( du, dv ) );
          dirXZ = normalize( u * du + v * dv + vec2( 1e-6 ) );
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
          float dist, idx, armF; vec2 dir;
          ledGeom( dist, idx, dir, armF );

          // One-hot select instead of dynamic array indexing, which GLSL ES 1.0
          // does not allow on uniforms.
          vec4 onehot = vec4(
            step( -0.5, armF ) * step( armF, 0.5 ),
            step( 0.5, armF ) * step( armF, 1.5 ),
            step( 1.5, armF ) * step( armF, 2.5 ),
            step( 2.5, armF ) * step( armF, 3.5 )
          );
          float lvl = dot( uLevel, onehot );
          float a = dot( uAmp, onehot );

          // Round LEDs: 2D distance from the centre, not a band crossed with a
          // width (which is a rectangle by construction).
          float dotMask = 1.0 - smoothstep( LED_RADIUS - 0.009, LED_RADIUS + 0.004, dist );

          // Volume lights whole LEDs outward from the centre, like the device.
          float lit = step( ( idx + 0.5 ) / LED_COUNT, lvl );

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
  }>({ mode: "none", stem: null, delta: 0, sx: 0, sy: 0, t0: 0 });

  // Safety net: if the pointer is released off the model, the mesh never sees
  // pointerup and OrbitControls would stay disabled forever.
  useEffect(() => {
    const end = () => {
      drag.current = { mode: "none", stem: null, delta: 0, sx: 0, sy: 0, t0: 0 };
      if (controls) controls.enabled = true;
      document.body.style.cursor = "";
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
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
    };
    if (zone.kind === "groove") onStemVolume?.(zone.stem, zone.value);
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (drag.current.mode === "none") {
      document.body.style.cursor = zoneAt(e.point) ? "pointer" : "";
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
    const moved = Math.hypot(e.clientX - drag.current.sx, e.clientY - drag.current.sy);
    // Treat as a press only if it was a tap, not the start of an orbit.
    if (moved < 6) {
      if (drag.current.mode === "button") {
        // Hold to power on/off, tap to play/pause — and while off, only the
        // hold does anything.
        if (performance.now() - drag.current.t0 >= POWER_HOLD_MS) onTogglePower?.();
        else if (isOn) onTogglePlay?.();
      }
      if (drag.current.mode === "volume") onVolumeStep?.(drag.current.delta);
    }
    drag.current = { mode: "none", stem: null, delta: 0, sx: 0, sy: 0, t0: 0 };
    if (controls) controls.enabled = true;
  };

  const level = useRef(new THREE.Vector4(1, 1, 1, 1));
  const amp = useRef(new THREE.Vector4(0, 0, 0, 0));
  const power = useRef({ value: 1 });
  const body = useRef<THREE.MeshStandardMaterial | null>(null);

  useMemo(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const mat = mesh.material as THREE.MeshStandardMaterial;
      // Only the outer shell is a closed solid. The port cavities and speaker
      // are open surfaces whose inner walls are back-faces, so forcing
      // FrontSide on them punched holes in the cutouts.
      mat.side = mat.name === "Stemplayer" ? THREE.FrontSide : THREE.DoubleSide;
      if (mat.name === "Stemplayer") {
        body.current = mat;
        mat.emissiveIntensity = 2.2;
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
    const { tint, roughness } = COLORWAYS[deviceColor];
    mat.color.setRGB(tint[0], tint[1], tint[2]);
    mat.roughness = roughness;
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
