import { platformLogin } from '../../features/auth/api'
import { resolveAuthenticatedLanding } from '../../features/auth/navigation'
import { saveSession } from '../../features/auth/store'
import { platform } from '../../platform'

/**
 * The login page deliberately leaves pending-invite storage untouched on
 * failure. Keeping the whole submitted flow here makes that behavior directly
 * testable without rendering Taro components in the Node test environment.
 */
export async function completePlatformLogin(): Promise<void> {
  const result = await platform.login()
  const session = await platformLogin(result.code)
  await saveSession(session)
  await resolveAuthenticatedLanding()
}
