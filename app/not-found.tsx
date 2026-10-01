import { ErrorScreen } from "~/components/ErrorScreen";

export default function NotFound() {
  return <ErrorScreen message="404" details="The requested page could not be found." />;
}
