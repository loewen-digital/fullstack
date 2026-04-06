import type { FullstackLocals } from '@loewen-digital/fullstack/adapters/sveltekit'

// Augment SvelteKit's App.Locals with the fullstack session/auth fields.
declare global {
  namespace App {
    interface Locals extends FullstackLocals {
      // Add any app-specific locals here
    }
  }
}

export {}
