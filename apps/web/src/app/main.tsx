import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "../index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/shared/components/theme-provider.tsx"
import { TooltipProvider } from "@/shared/components/ui/tooltip.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)
