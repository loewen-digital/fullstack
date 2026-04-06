/**
 * Drizzle schema — shared by the app and the auth DB adapter.
 *
 * Tables:
 *   users    — registered accounts
 *   sessions — active auth sessions (managed by @loewen-digital/fullstack/auth)
 *   tokens   — one-time tokens for email verification / password reset
 *   posts    — blog posts
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// ── Users ────────────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  name: text('name').notNull().default(''),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// ── Auth sessions ─────────────────────────────────────────────────────────────

export const authSessions = sqliteTable('auth_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// ── One-time tokens ───────────────────────────────────────────────────────────

export const authTokens = sqliteTable('auth_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  type: text('type').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// ── Posts ─────────────────────────────────────────────────────────────────────

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  content: text('content').notNull().default(''),
  excerpt: text('excerpt').notNull().default(''),
  authorId: text('author_id').notNull().references(() => users.id),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})
