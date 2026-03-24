import { STEMS, type StemName } from "~/lib/constants";
import { usePlayerStore } from "~/lib/store";

const stemNames = Object.keys(STEMS) as StemName[];

export function ProcessingAnimation() {
  const progress = usePlayerStore((s) => s.processingProgress);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-5">
        {stemNames.map((name, i) => (
          <div
            key={name}
            className="relative w-3 overflow-hidden rounded-full"
            style={{
              height: "140px",
              backgroundColor: "rgba(0,0,0,0.4)",
            }}
          >
            {/* Animated chase LED */}
            <div
              className="absolute bottom-0 left-0 w-full rounded-full"
              style={{
                backgroundColor: STEMS[name].colour,
                boxShadow: `0 0 12px ${STEMS[name].colour}`,
                animation: `chase 1.5s ease-in-out ${i * 0.2}s infinite`,
                height: "30%",
                opacity: 0.8,
              }}
            />
          </div>
        ))}
      </div>

      <span className="text-xs text-[var(--color-text-secondary)]">
        Separating stems{progress > 0 ? ` ${Math.round(progress)}%` : "..."}
      </span>

      <style>{`
        @keyframes chase {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-100%); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
