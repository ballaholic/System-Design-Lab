import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ConfigErrorPage } from "@/app/ConfigErrorPage";
import { envResult } from "@/lib/env";

const root = createRoot(document.getElementById("root")!);

if (!envResult.ok) {
  // Misconfiguration is a developer problem; say exactly what is missing instead of crashing.
  root.render(<ConfigErrorPage problems={envResult.problems} />);
} else {
  // Loaded lazily so the Supabase client is only created with a valid configuration.
  const { App } = await import("@/app/App");
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
