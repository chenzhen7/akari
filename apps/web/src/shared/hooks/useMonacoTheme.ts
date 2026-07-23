import { useTheme } from '@/shared/components/theme-provider'

export function useMonacoTheme(): 'vs-dark' | 'light' {
  const { resolvedTheme } = useTheme()
  return resolvedTheme === 'dark' ? 'vs-dark' : 'light'
}
