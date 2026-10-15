import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "@/app";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import "@/styles.css";

// Record whether the last interaction was keyboard or pointer, so focus rings only follow the keyboard.
const root = document.documentElement;
root.dataset.input = "pointer";
addEventListener("pointerdown", () => (root.dataset.input = "pointer"), true);
addEventListener(
  "keydown",
  (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) root.dataset.input = "keyboard";
  },
  true,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
