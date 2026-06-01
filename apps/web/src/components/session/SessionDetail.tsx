import { TerminalPanel } from './TerminalPanel'
import type { AgentSession } from '@/types'
import type { ClientMessage } from '@akari/shared-types'

interface SessionDetailProps {
  session: AgentSession
  send: (msg: ClientMessage) => void
}

export function SessionDetail({ session, send }: SessionDetailProps) {
  return (
    <div className="h-full">
      <TerminalPanel session={session} send={send} />
    </div>
  )
}
