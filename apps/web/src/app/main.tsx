import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "../index.css"
// 编辑器是主界面：Monaco 核心作为启动成本随应用立即加载，
// 首次打开文件/Diff 不再等待编辑器 chunk
import "@/shared/lib/monaco-setup"
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
