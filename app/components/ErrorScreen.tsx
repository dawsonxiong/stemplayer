export function ErrorScreen({
  message,
  details,
  stack,
}: {
  message: string;
  details: string;
  stack?: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-display text-ink">{message}</h1>
        <p className="mt-2 text-ink-muted">{details}</p>
        {stack && (
          <pre className="mt-4 max-w-2xl overflow-x-auto rounded-panel bg-raised p-4 text-left text-caption">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
