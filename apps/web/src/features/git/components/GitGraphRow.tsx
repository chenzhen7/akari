import type { GitCommit } from '@akari/shared-types'
import { GitBranch, GitMerge, Tag, Globe, CircleDot, ChevronRight } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from '@/shared/components/ui/context-menu'
import type { IdeaGraphNode } from '@/features/git/lib/git-graph-utils'
import { ROW_H, truncate } from '@/features/git/lib/git-graph-utils'
import { cn } from '@/shared/lib/utils'

interface RefBadgeProps {
  ref: string
  isHead: boolean
  nodeColor?: string
  localBranchNames: Set<string>
  /** 展示完整分支名（tooltip 内使用），默认截断到 14 字符 */
  fullName?: boolean
}

function RefBadge({ ref, isHead, nodeColor, localBranchNames, fullName }: RefBadgeProps) {
  const isRemote = ref.includes('/') && !localBranchNames.has(ref)
  const isTag = ref.startsWith('tag:')
  const label = isTag ? ref.replace('tag: ', '') : ref
  const Icon = isTag ? Tag : isRemote ? Globe : isHead ? CircleDot : GitBranch

  return (
    <Badge
      variant={isHead ? 'default' : isRemote ? 'secondary' : 'outline'}
      className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0 text-[11px] h-5"
      style={
        !isHead && !isRemote && !isTag && nodeColor
          ? { borderColor: nodeColor, color: nodeColor }
          : undefined
      }
    >
      <Icon className="h-3 w-3 shrink-0" />
      {fullName ? label : truncate(label, 14)}
    </Badge>
  )
}

interface GitGraphRowProps {
  commit: GitCommit
  row: number
  node: IdeaGraphNode | undefined
  isSelected: boolean
  isHead: boolean
  /** 该提交的文件列表是否已行内展开（控制 chevron 旋转） */
  isExpanded?: boolean
  /** 本行图形列宽度（逐行动态，VS Code 风格），消息从此处起排 */
  graphWidth: number
  localBranchNames: Set<string>
  onSelect: () => void
  onCheckout: (hash: string) => void
  onCreateBranch: (hash: string) => void
}

export function GitGraphRow({
  commit,
  row,
  node,
  isSelected,
  isHead,
  isExpanded,
  graphWidth,
  localBranchNames,
  onSelect,
  onCheckout,
  onCreateBranch,
}: GitGraphRowProps) {
  const branchRefs = commit.refs.filter(r => r && r !== 'HEAD')
  const hasRefs = branchRefs.length > 0
  const firstRef = branchRefs[0]
  const extraCount = branchRefs.length - 1

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'absolute left-0 right-0 flex cursor-pointer items-center text-xs transition-colors',
            isSelected
              ? 'bg-accent/30 border-l-2 border-primary'
              : 'border-l-2 border-transparent hover:bg-muted/50',
          )}
          style={{ top: row * ROW_H, height: ROW_H }}
          onClick={onSelect}
        >
          <div
            className="grid w-full items-center"
            style={{
              gridTemplateColumns: `${graphWidth}px 1fr`,
            }}
          >
            {/* Graph spacer */}
            <div className="relative h-full" />

            {/* Message + Refs inline */}
            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden pl-1 pr-2">
              <ChevronRight
                className={cn(
                  'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                  isExpanded && 'rotate-90',
                )}
              />
              <span
                className={cn(
                  'min-w-0 truncate',
                  commit.parents.length > 1 ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {commit.message}
              </span>

              {commit.parents.length > 1 && (
                <Badge
                  variant="outline"
                  className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0 text-[11px] h-5 border-amber-500/50 text-amber-500"
                >
                  <GitMerge className="h-3 w-3" />
                  merge
                </Badge>
              )}

              {hasRefs && firstRef && (
                <Tooltip delayDuration={400}>
                  <TooltipTrigger asChild>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <RefBadge
                        ref={firstRef}
                        isHead={isHead}
                        nodeColor={node?.color}
                        localBranchNames={localBranchNames}
                      />

                      {extraCount > 0 && (
                        <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                          +{extraCount}
                        </Badge>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="flex max-w-sm flex-wrap gap-1 border bg-popover p-1.5 text-[11px] text-popover-foreground shadow-md"
                    arrowClassName="bg-popover fill-popover"
                  >
                    {branchRefs.map((ref, ri) => (
                      <RefBadge
                        key={ri}
                        ref={ref}
                        isHead={isHead && ri === 0}
                        nodeColor={node?.color}
                        localBranchNames={localBranchNames}
                        fullName
                      />
                    ))}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-44">
        <ContextMenuLabel className="text-[11px]">
          {commit.shortHash} {truncate(commit.message, 24)}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCheckout(commit.hash)}>
          Checkout
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCreateBranch(commit.hash)}>
          新建分支
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
