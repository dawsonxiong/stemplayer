"use client";

import { ErrorScreen } from "~/components/ErrorScreen";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const dev = process.env.NODE_ENV === "development";
  return (
    <ErrorScreen
      message="Something went wrong"
      details={dev ? error.message : "The player hit an error. Try again, or start over."}
      stack={dev ? error.stack : undefined}
      actions={
        <>
          <button type="button" onClick={reset} className="btn-primary px-6">
            Try again
          </button>
          {/* A full load, in case the error left the player's state broken. */}
          <a href="/" className="btn-secondary">
            Start over
          </a>
        </>
      }
    />
  );
}
