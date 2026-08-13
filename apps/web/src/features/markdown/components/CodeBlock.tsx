import { memo, useCallback, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from '@/shared/lib/toast'
import type { ReactNode } from 'react'

interface CodeBlockProps {
  code: string
  /** 源码起始行号，透传到 <pre> 上供滚动同步映射 */
  dataLine?: number
  children: ReactNode
}

/** 写入剪贴板：优先 Clipboard API，不可用时回退到 execCommand（旧 Electron/非安全上下文） */
async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand('copy')
  textarea.remove()
  if (!ok) throw new Error('Clipboard API 不可用且 execCommand 复制失败')
}

/** GitHub 风格代码块：外观由 github-markdown-css 的 pre 提供，hover 时右上角显示复制按钮 */
export const CodeBlock = memo(function CodeBlock({ code, dataLine, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await writeClipboard(code)
      setCopied(true)
      toast.success('代码已复制')
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('[CodeBlock] copy failed:', err)
      toast.error(`复制失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [code])

  return (
    <div className="code-block group/code">
      <button
        type="button"
        onClick={handleCopy}
        aria-label="复制代码"
        title="复制代码"
        className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-[var(--bgColor-default)] text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/code:opacity-100 hover:text-foreground focus-visible:opacity-100"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre data-line={dataLine}>{children}</pre>
    </div>
  )
})
