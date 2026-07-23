export const API_BASE = import.meta.env.VITE_API_URL ?? ''

export async function parseOkResponse(res: Response): Promise<Response> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? body?.message ?? `HTTP ${res.status}`)
  }
  return res
}
