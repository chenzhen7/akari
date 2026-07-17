import { AppShell } from '@/components/layout/AppShell'
import { useWindowInit } from '@/hooks/useWindowInit'

export function App() {
  useWindowInit()
  return <AppShell />
}

export default App
