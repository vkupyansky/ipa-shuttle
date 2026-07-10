import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { LanguageProvider } from "./app/providers/LanguageProvider";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>
);
