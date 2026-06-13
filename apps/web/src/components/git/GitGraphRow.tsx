import type { GitCommit } from '@akari/shared-types'
import { GitBranch, GitMerge, Tag, Globe, CircleDot } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from '@/components/ui/context-menu'
import type { IdeaGraphNode } from '@/lib/git-graph-utils'
import { ROW_H, truncate } from '@/lib/git-graph-utils'
import { cn } from '@/lib/utils'

interface GitGraphRowProps {
  commit: GitCommit
  row: number
  node: IdeaGraphNode | undefined
  isSelected: boolean
  isHead: boolean
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
  graphWidth,
  localBranchNames,
  onSelect,
  onCheckout,
  onCreateBranch,
}: GitGraphRowProps) {
  const branchRefs = commit.refs.filter(r => r && r !== 'HEAD')

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
              gridTemplateColumns: `${graphWidth}px 1fr minmax(80px, auto)`,
            }}
          >
            {/* Graph spacer */}
            <div className="relative h-full" />

            {/* Message */}
            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden px-2">
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
            </div>

            {/* Refs */}
            <div className="flex min-w-0 items-center justify-end gap-1 overflow-hidden px-2">
              {branchRefs.slice(0, 4).map((ref, ri) => {
                const isRemote = ref.includes('/') && !localBranchNames.has(ref)
                const isTag = ref.startsWith('tag:')
                const isHeadRef = isHead && ri === 0
                const label = isTag ? ref.replace('tag: ', '') : ref
                const Icon = isTag ? Tag : isRemote ? Globe : isHeadRef ? CircleDot : GitBranch
                return (
                  <Tooltip key={ri}>
                    <TooltipTrigger asChild>
                      <Badge
                        variant={isHeadRef ? 'default' : isRemote ? 'secondary' : 'outline'}
                        className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0 text-[11px] h-5"
                        style={
                          !isHeadRef && !isRemote && !isTag && node
                            ? { borderColor: node.color, color: node.color }
                            : undefined
                        }
                      >
                        <Icon className="h-3 w-3 shrink-0" />
                        {truncate(label, 14)}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px]">{label}</TooltipContent>
                  </Tooltip>
                )
              })}
              {branchRefs.length > 4 && (
                <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                  +{branchRefs.length - 4}
                </Badge>
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
