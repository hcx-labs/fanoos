import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OfflineShell, OfflineDestination } from "@/components/shell/offline-shell";
import { DownloadedWatchPage } from "@/pages/downloaded-watch";
import { DownloadsPage } from "@/pages/downloads";
import { ThemeProvider } from "@/lib/theme";
import { loadOfflineAppData } from "@/lib/store";
import "@/styles.css";

void loadOfflineAppData().then(() => {
  createRoot(document.getElementById("root")!).render(<StrictMode><ThemeProvider><TooltipProvider><HashRouter><Routes><Route element={<OfflineShell />}><Route path="/downloads" element={<DownloadsPage />} /><Route path="/watch/:id" element={<DownloadedWatchPage />} /><Route path="*" element={<OfflineDestination />} /></Route></Routes></HashRouter><Toaster /></TooltipProvider></ThemeProvider></StrictMode>);
});
