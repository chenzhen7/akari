import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface DeleteSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  branchName: string
  worktreePath: string
  onConfirm: () => void
}

export function DeleteSessionDialog({
  open,
  onOpenChange,
  sessionId,
  branchName,
  worktreePath,
  onConfirm,
}: DeleteSessionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>彻底删除会话</DialogTitle>
          <DialogDescription className="break-words">
            将删除 Worktree 目录（
            <span className="break-all font-mono text-foreground">{worktreePath}</span>
            ）和分支（
            <span className="break-all font-mono text-foreground">{branchName}</span>
            ），此操作不可恢复。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            确认删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
