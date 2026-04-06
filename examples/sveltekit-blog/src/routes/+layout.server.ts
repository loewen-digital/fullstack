import type { LayoutServerLoad } from './$types'

// Forward flash messages and auth state to every page.
export const load: LayoutServerLoad = async ({ locals }) => {
  const flash = locals.session?.getFlash('_flash') as string | undefined
  const errors = locals.session?.getFlash('_errors') as string[] | undefined
  const oldInput = locals.session?.getOldInput() as Record<string, string> | undefined

  return {
    user: locals.user,
    flash,
    errors,
    oldInput,
  }
}
