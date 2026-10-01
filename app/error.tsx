"use client";

import { ErrorScreen } from "~/components/ErrorScreen";

export default function Error({ error }: { error: Error & { digest?: string } }) {
  const dev = process.env.NODE_ENV === "development";
  return (
    <ErrorScreen
      message="Error"
      details={dev ? error.message : "An unexpected error occurred."}
      stack={dev ? error.stack : undefined}
    />
  );
}
