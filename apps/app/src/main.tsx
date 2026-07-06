import { createRoot } from "react-dom/client";

const rootElement = document.getElementById("root");

if (rootElement == null) {
  throw new Error("#root element not found.");
}

createRoot(rootElement).render(<>BUFFI!!!</>);
