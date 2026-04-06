<script lang="ts">
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
</script>

<svelte:head>
  <title>Log In</title>
</svelte:head>

<main>
  <h1>Log In</h1>

  <form method="POST">
    <label>
      Email
      <input type="email" name="email" value={data.oldInput?.email ?? ''} required />
    </label>

    <label>
      Password
      <input type="password" name="password" required />
    </label>

    <button type="submit">Log In</button>
  </form>

  <p>No account? <a href="/auth/register">Register</a></p>
  <p><a href="/auth/forgot-password">Forgot password?</a></p>
</main>

<style>
  main { max-width: 24rem; margin: 4rem auto; padding: 0 1rem; }
  form { display: flex; flex-direction: column; gap: 1rem; }
  label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
  input { padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; }
  button { padding: 0.5rem 1rem; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; }
</style>
