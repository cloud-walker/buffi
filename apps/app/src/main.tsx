import { createRoot } from "react-dom/client";

import "./main.css";
import { App } from "./app";

const rootElement = document.getElementById("root");

if (rootElement == null) {
  throw new Error("#root element not found.");
}

createRoot(rootElement).render(<App />);
