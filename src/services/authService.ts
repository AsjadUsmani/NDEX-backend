import { supabase } from '../lib/supabase'
import jwt from 'jsonwebtoken'
import { AppError } from '../middleware/errorHandler'
import { JWTPayload } from '../middleware/auth'

function generateTokens(payload: Omit<JWTPayload, 'iat' | 'exp'>) {
  const access = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any
  })
  const refresh = jwt.sign({ sub: payload.sub }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any
  })
  return { access, refresh }
}

export const authService = {

  async register(email: string, password: string, username: string, display_name?: string) {
    const { data: existing } = await supabase
      .from('profiles').select('id').eq('username', username).single()
    if (existing) throw new AppError('Username already taken', 409)

    const { data, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { username, display_name: display_name || username }
    })
    if (error) {
      if (error.message.includes('already registered'))
        throw new AppError('Email already registered', 409)
      throw new AppError(error.message, 400)
    }

    let { data: profile } = await supabase
      .from('profiles').select('*').eq('id', data.user.id).single()

    if (!profile) {
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: data.user.id,
          username,
          display_name: display_name || username,
          plan: 'free'
        })
        .select()
        .single()
      
      if (insertError || !newProfile) throw new AppError('Failed to create profile record', 500)
      profile = newProfile
    }

    const tokens = generateTokens({
      sub: data.user.id, email,
      username: profile!.username, plan: profile!.plan
    })
    return { user: profile, tokens }
  },

  async login(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new AppError('Invalid email or password', 401)

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', data.user.id).single()
    if (!profile) throw new AppError('Profile not found', 404)

    const tokens = generateTokens({
      sub: data.user.id, email,
      username: profile.username, plan: profile.plan
    })
    return { user: profile, tokens }
  },

  async oauthLogin(accessToken: string) {
    // Verify the Supabase JWT
    const { data: { user }, error } = await supabase.auth.getUser(accessToken)
    if (error || !user) throw new AppError('Invalid OAuth token', 401)

    // Check if profile exists
    let { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()

    if (!profile) {
      // Create a profile for the OAuth user
      // Use email prefix or random string for username if missing
      const baseUsername = user.email?.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '') || 'user'
      let username = baseUsername
      
      // Ensure username is unique
      let isUnique = false
      let suffix = 0
      while (!isUnique) {
        const { data: existing } = await supabase
          .from('profiles').select('id').eq('username', username).single()
        if (!existing) {
          isUnique = true
        } else {
          suffix++
          username = `${baseUsername}${suffix}`
        }
      }

      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          username,
          display_name: user.user_metadata?.full_name || username,
          avatar_url: user.user_metadata?.avatar_url || null,
          plan: 'free'
        })
        .select()
        .single()
        
      if (insertError || !newProfile) throw new AppError('Failed to create OAuth profile', 500)
      profile = newProfile
    }

    const tokens = generateTokens({
      sub: user.id, email: user.email!,
      username: profile.username, plan: profile.plan
    })
    return { user: profile, tokens }
  },

  async refreshToken(refreshToken: string) {
    let payload: { sub: string }
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { sub: string }
    } catch {
      throw new AppError('Invalid or expired refresh token', 401)
    }

    const { data: profile } = await supabase
      .from('profiles').select('id, username, plan').eq('id', payload.sub).single()
    if (!profile) throw new AppError('User not found', 404)

    const { data: authUser } = await supabase.auth.admin.getUserById(payload.sub)
    if (!authUser.user) throw new AppError('Auth user not found', 404)

    const tokens = generateTokens({
      sub: profile.id, email: authUser.user.email!,
      username: profile.username, plan: profile.plan
    })
    return tokens
  },

  async logout(userId: string) {
    await supabase.auth.admin.signOut(userId)
    return { success: true }
  },

  async getProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles').select('*, user_preferences(*)').eq('id', userId).single()
    if (error) throw new AppError('Profile not found', 404)
    return data
  }
}
