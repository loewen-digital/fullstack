import type { OAuthProvider, OAuthProviderConfig, OAuthTokens, OAuthUserInfo } from './types.js'

/** Known OAuth provider names and their endpoint URLs. */
const PROVIDER_ENDPOINTS: Record<string, { authUrl: string; tokenUrl: string; userUrl: string }> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userUrl: 'https://api.github.com/user',
  },
}

/**
 * Create an OAuth provider scaffold.
 *
 * Handles the authorization URL construction and the callback code exchange.
 * Custom providers can be used by passing endpoint URLs in the config.
 *
 * Usage:
 *   const google = auth.oauthProvider('google', {
 *     clientId: '...',
 *     clientSecret: '...',
 *     redirectUri: 'https://myapp.com/auth/google/callback',
 *     scopes: ['openid', 'email', 'profile'],
 *   })
 *
 *   // In the login route:
 *   const state = crypto.randomUUID()
 *   const url = google.getAuthorizationUrl(state)
 *   // Store state in session, then redirect to url
 *
 *   // In the callback route:
 *   const { tokens, user } = await google.handleCallback(code, state)
 */
export function createOAuthProvider(name: string, config: OAuthProviderConfig): OAuthProvider {
  const endpoints = PROVIDER_ENDPOINTS[name]
  if (!endpoints) {
    throw new Error(
      `Unknown OAuth provider "${name}". ` +
        `Known providers: ${Object.keys(PROVIDER_ENDPOINTS).join(', ')}. ` +
        `For custom providers, add endpoint configuration.`,
    )
  }

  const defaultScopes: Record<string, string[]> = {
    google: ['openid', 'email', 'profile'],
    github: ['read:user', 'user:email'],
  }

  const scopes = config.scopes ?? defaultScopes[name] ?? []

  return {
    getAuthorizationUrl(state: string): URL {
      const url = new URL(endpoints.authUrl)
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', config.redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', scopes.join(' '))
      url.searchParams.set('state', state)
      return url
    },

    async handleCallback(
      code: string,
      _state: string,
    ): Promise<{ tokens: OAuthTokens; user: OAuthUserInfo }> {
      // Exchange authorization code for access token
      const tokenResponse = await fetch(endpoints.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
        }),
      })

      if (!tokenResponse.ok) {
        throw new Error(`OAuth token exchange failed: ${tokenResponse.statusText}`)
      }

      const tokenData = (await tokenResponse.json()) as Record<string, unknown>
      const accessToken = tokenData.access_token as string
      const refreshToken = tokenData.refresh_token as string | undefined
      const expiresIn = tokenData.expires_in as number | undefined

      const tokens: OAuthTokens = {
        accessToken,
        refreshToken,
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
        scope: tokenData.scope as string | undefined,
      }

      // Fetch user info
      const userResponse = await fetch(endpoints.userUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      if (!userResponse.ok) {
        throw new Error(`OAuth user info fetch failed: ${userResponse.statusText}`)
      }

      const raw = (await userResponse.json()) as Record<string, unknown>
      const user = normalizeUserInfo(name, raw)

      return { tokens, user }
    },
  }
}

function normalizeUserInfo(provider: string, raw: Record<string, unknown>): OAuthUserInfo {
  if (provider === 'google') {
    return {
      id: String(raw.sub ?? raw.id ?? ''),
      email: raw.email as string | undefined,
      name: raw.name as string | undefined,
      avatarUrl: raw.picture as string | undefined,
      raw,
    }
  }

  if (provider === 'github') {
    return {
      id: String(raw.id ?? ''),
      email: raw.email as string | undefined,
      name: (raw.name ?? raw.login) as string | undefined,
      avatarUrl: raw.avatar_url as string | undefined,
      raw,
    }
  }

  return {
    id: String(raw.id ?? raw.sub ?? ''),
    email: raw.email as string | undefined,
    name: raw.name as string | undefined,
    raw,
  }
}
