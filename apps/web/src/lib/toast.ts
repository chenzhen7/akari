import { toast as sonnerToast } from 'sonner'

export const toast = sonnerToast

export function toastError(message: string) {
  return sonnerToast.error(message, { duration: Infinity })
}
