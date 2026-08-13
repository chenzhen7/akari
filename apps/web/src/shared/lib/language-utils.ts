const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', go: 'go', java: 'java', cs: 'csharp',
  css: 'css', scss: 'scss', html: 'html', json: 'json', md: 'markdown', markdown: 'markdown',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'shell', bash: 'shell',
  txt: 'plaintext', vue: 'html', svelte: 'html',
}

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG[ext] ?? 'plaintext'
}
