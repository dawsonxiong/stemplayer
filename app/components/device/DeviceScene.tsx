import { Suspense, lazy, useEffect, useState } from "react";
import type { StemName } from "~/lib/constants";

const DeviceCanvas = lazy(() => import("./DeviceCanvas.client"));

interface DeviceSceneProps {
  volumes: Record<StemName, number>;
  amplitudes: Record<StemName, number>;
  onStemVolume: (stem: StemName, value: number) => void;
  onTogglePlay: () => void;
  onVolumeStep: (delta: number) => void;
}

function Placeholder() {
  return (
    <div
      className="flex w-full items-center justify-center"
      style={{ height: "clamp(340px, 45vw, 480px)" }}
    >
      <div className="h-[280px] w-[280px] animate-pulse rounded-full bg-[#1A1714]" />
    </div>
  );
}

export function DeviceScene({
  volumes,
  amplitudes,
  onStemVolume,
  onTogglePlay,
  onVolumeStep,
}: DeviceSceneProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <Placeholder />;

  return (
    <Suspense fallback={<Placeholder />}>
      <DeviceCanvas
        volumes={volumes}
        amplitudes={amplitudes}
        onStemVolume={onStemVolume}
        onTogglePlay={onTogglePlay}
        onVolumeStep={onVolumeStep}
      />
    </Suspense>
  );
}
