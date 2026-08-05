import { useMemo } from 'react'
import {
  File as FileIcon,
  FileCode,
  FileCode2,
  FileImage,
  FileJson,
  FileText,
  FileType,
  FileType2,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export interface FileTypeIconProps {
  fileName: string
  className?: string
}

export function FileTypeIcon({ fileName, className }: FileTypeIconProps) {
  const Icon = useMemo(() => {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
      case 'mjs':
      case 'cjs':
        return FileCode2
      case 'json':
        return FileJson
      case 'md':
      case 'mdx':
      case 'txt':
        return FileText
      case 'css':
      case 'scss':
      case 'less':
      case 'styl':
        return FileType
      case 'html':
      case 'xml':
      case 'svg':
        return FileCode
      case 'vue':
      case 'svelte':
        return FileType2
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'webp':
      case 'ico':
        return FileImage
      default:
        return FileIcon
    }
  }, [fileName])

  return <Icon className={cn('h-3.5 w-3.5', className)} />
}
