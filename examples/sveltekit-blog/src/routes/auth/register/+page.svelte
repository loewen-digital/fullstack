<script lang="ts">
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
</script>

<svelte:head>
  <title>Register</title>
</svelte:head>

<main>
  <h1>Create Account</h1>

  <form method="POST">
    <label>
      Name
      <input type="text" name="name" value={data.oldInput?.name ?? ''} required />
    </label>

    <label>
      Email
      <input type="email" name="email" value={data.oldInput?.email ?? ''} required />
    </label>

    <label>
      Password
      <input type="password" name="password" minlength="8" required />
    </label>

    <label>
      Confirm Password
      <input type="password" name="password_confirmation" required />
    </label>

    <button type="submit">Register</button>
  </form>

  <p>Already have an account? <a href="/auth/login">Log in</a></p>
</main>

<style>
  main { max-width: 24rem; margin: 4rem auto; padding: 0 1rem; }
  form { display: flex; flex-direction: column; gap: 1rem; }
  label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
  input { padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; }
  button { padding: 0.5rem 1rem; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; }
</style>
