import type { ReactNode } from "react";

export function ErrorScreen({
  message,
  details,
  stack,
  actions,
}: {
  message: string;
  details: string;
  stack?: string;
  /** What to do next, so the screen is never a dead end. */
  actions?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="flex flex-col items-center text-center">
        <h1 className="text-display text-ink">{message}</h1>
        <p className="mt-2 text-body text-ink-muted">{details}</p>
        {actions && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{actions}</div>
        )}
        {stack && (
          <pre className="mt-6 max-w-2xl overflow-x-auto rounded-panel bg-raised p-4 text-left text-caption">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
