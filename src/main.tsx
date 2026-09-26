import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import App from "./App";
import "./styles.css";
import "./reader/reader.css";
// Keep zoom inside the reader/canvas instead of scaling the application shell.
document.addEventListener('contextmenu', event => event.preventDefault());
window.addEventListener('wheel', event => {
  if (event.ctrlKey || event.metaKey) event.preventDefault();
}, { passive: false });
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) event.preventDefault();
});
document.addEventListener('gesturestart', event => event.preventDefault(), { passive: false });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
