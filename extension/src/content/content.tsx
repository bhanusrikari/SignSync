import { createRoot } from "react-dom/client";
import { OverlayRoot } from "./OverlayRoot";
import overlayStyles from "./styles.css?inline";

const HOST_ID = "signsync-overlay-host";

function mount() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const shadowRoot = host.attachShadow({ mode: "open" });

  const styleTag = document.createElement("style");
  styleTag.textContent = overlayStyles;
  shadowRoot.appendChild(styleTag);

  const container = document.createElement("div");
  shadowRoot.appendChild(container);

  createRoot(container).render(<OverlayRoot />);
}

// Wrapped so a host-page restriction (strict CSP, Trusted Types, etc.) surfaces
// as a visible console error instead of silently no-op'ing the whole script.
try {
  mount();
} catch (error) {
  console.error("[SignSync] failed to mount accessibility overlay:", error);
}
