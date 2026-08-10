/**
 * 流式解析 PTY 输出中的 OSC 标题序列（OSC 0/1/2），并做净化处理。
 *
 * 参考 VS Code 终端对 shell/TUI 实时标题的处理：应用通过 OSC 序列上报窗口标题，
 * 宿主解析后把标题作为 tab 名称。Claude Code 即用 OSC 0 把终端标题更新为会话名。
 *
 * 支持的格式（终止符两种）：
 *   - BEL (\x07)     ESC ] Ps ; Pt \x07
 *   - ESC \ (\x1b\\)  ESC ] Ps ; Pt \x1b\\
 *
 * PTY 数据可能跨多个 chunk 到达，解析器内部维护残留 buffer。
 */
const OSC_START = '\x1b]'
const BEL = '\x07'
const ESC_BACKSLASH = '\x1b\\'

const MAX_TITLE_LENGTH = 80
// C0 控制字符 + DEL。标题内容可能被注入嵌套转义序列（已知攻击面），必须剥离。
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g

interface Terminator {
  idx: number
  len: number
}

/** 在字符串中查找 OSC 终止符（BEL 或 ESC\），返回位置与长度；未找到返回 null。 */
function findTerminator(s: string): Terminator | null {
  const belIdx = s.indexOf(BEL)
  const escIdx = s.indexOf(ESC_BACKSLASH)
  if (belIdx === -1 && escIdx === -1) return null
  if (belIdx === -1) return { idx: escIdx, len: 2 }
  if (escIdx === -1) return { idx: belIdx, len: 1 }
  return belIdx < escIdx ? { idx: belIdx, len: 1 } : { idx: escIdx, len: 2 }
}

function sanitizeTitle(raw: string): string {
  const cleaned = raw.replace(CONTROL_CHARS, '').trim()
  return cleaned.length > MAX_TITLE_LENGTH ? cleaned.slice(0, MAX_TITLE_LENGTH) : cleaned
}

export class OscTitleParser {
  private buffer = ''

  /**
   * 喂入一段 PTY 数据，返回其中解析出的净化后标题列表。
   * 空标题（shell 用于「恢复默认」）与 OSC 0/1/2 之外的序列被忽略。
   */
  push(chunk: string): string[] {
    this.buffer += chunk
    const titles: string[] = []

    let rest = this.buffer
    this.buffer = ''

    while (rest.length > 0) {
      const oscStart = rest.indexOf(OSC_START)
      if (oscStart === -1) {
        // 无 OSC 序列：只保留可能跨 chunk 的尾部单个 ESC
        if (rest.endsWith('\x1b')) {
          this.buffer = rest.slice(-1)
        }
        break
      }

      // 丢弃 OSC 起点之前的普通输出
      const afterOsc = rest.slice(oscStart + OSC_START.length)
      const semicolonIdx = afterOsc.indexOf(';')
      const terminator = findTerminator(afterOsc)

      if (terminator && (semicolonIdx === -1 || terminator.idx < semicolonIdx)) {
        // 终止符出现在分号之前 → 缺少标题参数的畸形 OSC（如 `\x1b]0\x07`），消费掉并继续
        rest = afterOsc.slice(terminator.idx + terminator.len)
        continue
      }

      if (semicolonIdx === -1) {
        // 分号与终止符都未到：缓存整个未完成序列，等待后续 chunk
        this.buffer = OSC_START + afterOsc
        break
      }

      const psRaw = afterOsc.slice(0, semicolonIdx)
      const payloadAndST = afterOsc.slice(semicolonIdx + 1)

      const payloadTerminator = findTerminator(payloadAndST)
      if (!payloadTerminator) {
        // 终止符尚未到达：缓存整个 OSC 序列，等待后续 chunk
        this.buffer = OSC_START + afterOsc
        break
      }

      const payload = payloadAndST.slice(0, payloadTerminator.idx)
      const ps = Number(psRaw)
      if (ps === 0 || ps === 1 || ps === 2) {
        const title = sanitizeTitle(payload)
        if (title.length > 0) {
          titles.push(title)
        }
      }

      // 继续扫描终止符之后的剩余内容
      rest = payloadAndST.slice(payloadTerminator.idx + payloadTerminator.len)
    }

    return titles
  }
}
