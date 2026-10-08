import { ErrorScreen } from "~/components/ErrorScreen";

export default function NotFound() {
  return (
    <ErrorScreen
      message="Page not found"
      details="There’s nothing at this address."
      actions={
        <a href="/" className="btn-primary px-6">
          Back to Stem Player
        </a>
      }
    />
  );
}
