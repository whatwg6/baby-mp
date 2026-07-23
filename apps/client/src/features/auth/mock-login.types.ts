export interface MockLoginButtonProps {
  accepted: boolean
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onError: (message: string) => void
}
