export interface NativeOpenDialogOptions {
  title?: string
  defaultPath?: string
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>
}

export interface NativeOpenDialogResult {
  canceled: boolean
  filePaths: string[]
}

async function showNativeOpenDialog(
  options: NativeOpenDialogOptions,
): Promise<NativeOpenDialogResult> {
  const dialog = window.electron?.dialog?.showOpenDialog
  if (!dialog) {
    throw new Error('Native dialog is not available')
  }
  return dialog(options)
}

export async function selectFolder(defaultPath?: string): Promise<string | null> {
  const result = await showNativeOpenDialog({
    title: '选择文件夹',
    properties: ['openDirectory'],
    defaultPath,
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
}

export async function selectFile(
  defaultPath?: string,
  filters?: Array<{ name: string; extensions: string[] }>,
): Promise<string | null> {
  const result = await showNativeOpenDialog({
    title: '选择文件',
    properties: ['openFile'],
    defaultPath,
    filters,
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
}
