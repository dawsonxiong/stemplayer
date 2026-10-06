import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { DEVICE_COLORS, LED_PALETTE, type StemName } from "~/lib/constants";
import { usePlayerStore } from "~/lib/store";
import { DeviceLoader } from "./DeviceLoader";
import { SCENE_CEILING, SCENE_FLOOR, SCENE_HEIGHT } from "./frame";

const DeviceCanvas = lazy(() => import("./DeviceCanvas"));

interface DeviceSceneProps {
  volumes: Record<StemName, number>;
  amplitudes: Record<StemName, number>;
  onStemVolume: (stem: StemName, value: number) => void;
  onTogglePlay: () => void;
  onVolumeStep: (delta: number) => void;
  onTogglePower: () => void;
  onHoldStem: (stem: StemName, held: boolean) => void;
}


// Grooves clockwise from the top, matching the 3D model's arm order.
const GROOVES: { stem: StemName; rotate: number }[] = [
  { stem: "bass", rotate: 0 },
  { stem: "drums", rotate: 90 },
  { stem: "vocals", rotate: 180 },
  { stem: "other", rotate: 270 },
];

/** Top-down drawing of the device, for when WebGL is unavailable or the GPU
 *  drops the context. */
function FlatDevice({ volumes, note }: { volumes: Record<StemName, number>; note?: string }) {
  const deviceColor = usePlayerStore((s) => s.deviceColor);
  const isOn = usePlayerStore((s) => s.isOn);

  return (
    <div
      className="flex w-full flex-col items-center justify-center gap-4 py-6"
      style={{ minHeight: SCENE_HEIGHT }}
    >
      <div
        className="relative aspect-square w-[min(280px,70vw)] rounded-full"
        style={{
          backgroundColor: DEVICE_COLORS[deviceColor].swatch,
          boxShadow:
            "inset 0 -10px 24px rgba(0,0,0,0.12), inset 0 8px 18px rgba(255,255,255,0.18), 0 18px 40px rgba(80,60,40,0.18)",
        }}
      >
        <div className="absolute top-1/2 left-1/2 h-[16%] w-[16%] -translate-x-1/2 -translate-y-1/2 rounded-full inset-ring inset-ring-line-strong" />
        {GROOVES.map(({ stem, rotate }) => {
          const lit = isOn ? Math.ceil(volumes[stem] * LED_PALETTE.length - 0.0001) : 0;
          return (
            <div
              key={stem}
              className="absolute top-1/2 left-1/2 h-0 w-0"
              style={{ transform: `rotate(${rotate}deg)` }}
            >
              {/* Hub to rim runs up the page before rotation. */}
              <div className="absolute bottom-[calc(0.11*min(280px,70vw))] left-[-9px] flex h-[calc(0.3*min(280px,70vw))] w-[18px] flex-col-reverse items-center justify-between rounded-full bg-well py-1">
                {LED_PALETTE.map((colour, i) => (
                  <span
                    key={colour}
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: i < lit ? colour : "var(--color-well)",
                      boxShadow: i < lit ? `0 0 6px ${colour}` : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {note && (
        <p className="max-w-xs text-center text-caption text-balance text-ink-muted">{note}</p>
      )}
    </div>
  );
}

/** R3F throws during mount when WebGL cannot be created at all. */
class WebGLBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Lets a class error boundary's fallback report back into hooks state. */
function OnMount({ run }: { run: () => void }) {
  useEffect(run, [run]);
  return null;
}

const NO_3D_NOTE = "The 3D view couldn’t start. Mixing should still work.";

const HANDOFF_MS = 500;

export function DeviceScene({
  volumes,
  amplitudes,
  onStemVolume,
  onTogglePlay,
  onVolumeStep,
  onTogglePower,
  onHoldStem,
}: DeviceSceneProps) {
  const [mounted, setMounted] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  // ready: the model has drawn, start the crossfade. loaderGone: it has finished.
  const [ready, setReady] = useState(false);
  const [loaderGone, setLoaderGone] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (contextLost) return <FlatDevice volumes={volumes} note={NO_3D_NOTE} />;

  return (
    <div className="relative w-full" style={{ height: `calc(${SCENE_HEIGHT} * ${SCENE_FLOOR - SCENE_CEILING})` }}>
      {mounted && (
        <WebGLBoundary fallback={<OnMount run={() => setContextLost(true)} />}>
          <Suspense fallback={null}>
            <div
              className="transition-opacity ease-out"
              style={{ opacity: ready ? 1 : 0, transitionDuration: `${HANDOFF_MS}ms` }}
            >
              <DeviceCanvas
                volumes={volumes}
                amplitudes={amplitudes}
                onStemVolume={onStemVolume}
                onTogglePlay={onTogglePlay}
                onVolumeStep={onVolumeStep}
                onTogglePower={onTogglePower}
                onHoldStem={onHoldStem}
                onContextLost={() => setContextLost(true)}
                onReady={() => setReady(true)}
              />
            </div>
          </Suspense>
        </WebGLBoundary>
      )}

      {!loaderGone && (
        <div
          className="pointer-events-none absolute inset-0 transition-opacity ease-out"
          style={{ opacity: ready ? 0 : 1, transitionDuration: `${HANDOFF_MS}ms` }}
          onTransitionEnd={() => ready && setLoaderGone(true)}
        >
          <DeviceLoader />
        </div>
      )}
    </div>
  );
}
