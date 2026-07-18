interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles' | 'createDirectory' | 'promptToCreate' | 'noResolveAliases' | 'treatPackageAsDirectory' | 'dontAddToRecent'>
  filters?: Array<{ name: string; extensions: string[] }>
}

interface OpenDialogReturnValue {
  canceled: boolean
  filePaths: string[]
  bookmarks?: string[]
}

interface Window {
  electron?: {
    platform: string
    windowControls?: {
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      isMaximized: () => Promise<boolean>
      onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void
    }
    dialog?: {
      showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>
    }
    shell?: {
      openPath: (path: string) => Promise<string>
    }
    clipboard?: {
      writeText: (text: string) => Promise<void>
    }
    workspace?: {
      openWindow: (workspaceId: string, workspaceName?: string) => Promise<void>
      getWindowId: () => Promise<number>
      getWorkspaceId: () => Promise<string | null>
      notifyDeleted?: (workspaceId: string) => Promise<void>
    }
  }
}
