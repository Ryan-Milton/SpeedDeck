import Shell from "./shell/Shell";

// The CarPlay shell is the whole app. It subscribes to live telemetry and hosts
// the home grid, dock, status bar, and each app surface.
export default function App() {
  return <Shell />;
}
