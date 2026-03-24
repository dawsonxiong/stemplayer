import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Stem Player" },
    {
      name: "description",
      content:
        "Upload any song, separate it into stems, and mix it live in your browser.",
    },
  ];
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-4">
      <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
        Stem Player
      </h1>
      <p className="text-[var(--color-text-secondary)]">
        Upload a track to get started
      </p>
      {/* Device, Transport, and Upload components will go here */}
    </div>
  );
}
