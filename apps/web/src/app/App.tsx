import { AppShell } from '@/features/layout/components/AppShell'
import { useWindowInit } from '@/shared/hooks/useWindowInit'

export function App() {
  useWindowInit()
  return <AppShell />
}

export default App
