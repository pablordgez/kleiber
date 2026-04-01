import ReactDOM from "react-dom/client";
import { App } from "./App";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Renderer root element was not found.");
}

ReactDOM.createRoot(rootElement).render(<App />);
