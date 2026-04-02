# PROMPTING.md — How to Build @loewen-digital/fullstack with Claude Code

## Setup

1. Create a new directory and initialize it:
   
   ```bash
   mkdir fullstack && cd fullstack
   git init
   ```
1. Copy these files into the root:
- `CLAUDE.md` — Claude reads this automatically on every session
- `SPEC.md` — Design specification (referenced by CLAUDE.md)
- `TASKS.md` — Ordered task list
1. Start Claude Code:
   
   ```bash
   claude
   ```

-----

## Workflow: One Task at a Time

The key to good results is **one task per prompt**. Each task in TASKS.md is designed to be self-contained. Don't try to do multiple tasks in one prompt.

### Step 1: Start a Task

Reference the task ID directly:

```
Implement Task 1.1: Project Scaffolding.
Follow SPEC.md for the directory structure and package.json exports.
```

### Step 2: Review the Output

After Claude implements the task, review the code. If something needs adjustment:

```
The Vite config is missing the entry points for subpath exports.
Fix it to include all paths listed in package.json exports.
```

### Step 3: Verify Tests Pass

```
Run the tests and fix any failures.
```

### Step 4: Commit and Move On

```
Commit this with message "feat: project scaffolding and build setup"
```

Then start the next task in a **new prompt or conversation**.

-----

## Prompt Templates

### For Foundation Tasks (Phase 1)

```
Implement Task 1.2: Config Module.

Requirements from SPEC.md:
- defineConfig() with typed config and sensible defaults
- loadConfig() that reads fullstack.config.ts
- env() helper with type-safe fallbacks
- resolveDriver() for lazy driver loading

Write the implementation and tests. Use Vitest.
Make sure exports are added to package.json.
```

### For Module Implementation (Phase 2-5)

```
Implement Task 2.1: Validation Module.

This is a standalone, stateless module. Key requirements:
- validate(data, rules) returns { ok, data } or { ok, errors }
- Support both string rules ('required|string|max:255') and object rules
- All built-in rules as listed in SPEC.md
- TypeScript should infer the validated data type from rules
- defineRules() for custom rule registration

Write implementation, types, and comprehensive tests.
Export from @loewen-digital/fullstack/validation.
```

### For Driver-Based Modules

```
Implement Task 4.1: Mail Module.

This module uses the driver pattern. Implement:
1. The MailDriver interface (in types.ts)
2. The console driver (logs + captures in-memory)
3. The createMail(config) factory function
4. The send(message) method

Start with ONLY the console driver. We'll add SMTP, Resend, and
Postmark drivers later. Tests should use the console driver.
```

### For Adapter Tasks

```
Implement Task 6.2: SvelteKit Adapter.

This adapter bridges SvelteKit's request/response model to our
framework-agnostic core. Implement:
1. createHandle(stack) — returns a SvelteKit Handle function
2. Populate event.locals.fullstack with session, auth, etc.
3. CSRF check for non-GET requests
4. TypeScript type augmentation for App.Locals

The adapter must NOT import any core module directly — it only
receives the stack instance and works with its public API.
```

### For Integration Tasks

```
Implement Task 6.1: createStack.

This wires all modules together. Requirements:
- Accept a FullstackConfig
- Initialize only the modules that are configured
- Resolve inter-module deps (auth needs db, etc.)
- TypeScript: return type inferred from config keys
- Graceful handling of missing optional deps

Test with a config that enables db + auth + mail, and verify
that only those three modules are present on the returned object.
```

-----

## Tips for Better Results

### Be Specific About What You Want

```
❌ "Build the auth module"
✅ "Implement Task 3.4: Auth Module. Start with password hashing
   and session-based auth only. Skip OAuth and email verification
   for now — we'll add those in a follow-up."
```

### Break Large Tasks Into Sub-Prompts

If a task is complex, split it:

```
Prompt 1: "Implement the validation module with just the string
           rule parser and these rules: required, string, number,
           min, max, email. Include tests."

Prompt 2: "Add these rules to the validation module: in, regex,
           uuid, date, before, after, confirmed, nullable, optional.
           Add tests for each."

Prompt 3: "Add nested object validation (dot notation) and array
           item validation (wildcard notation) to the validation
           module. Add tests."

Prompt 4: "Add TypeScript type inference to validate() so the
           return type's data property is typed based on the rules.
           Add type-level tests."
```

### Reference Existing Code

```
"Add the SMTP driver to the mail module. Follow the same driver
pattern as the console driver in src/mail/drivers/console.ts."
```

### Fix Issues Incrementally

```
"The validation module's email rule doesn't handle '+' in the
local part. Fix the regex and add a test case for 'user+tag@example.com'."
```

### Ask for Tests Explicitly

```
"Write additional edge case tests for the session module:
- Expired session handling
- Concurrent session access
- Flash message persistence across requests
- Cookie size limits"
```

-----

## Recommended Task Order

Follow TASKS.md strictly for the ordering. Here's why:

1. **Phase 1 (Foundation)** must be first — everything else depends on the build setup, config system, and error types.
1. **Phase 2 (Standalone)** comes next because these modules have zero internal dependencies. They're easy to implement and test in isolation.
1. **Phase 3 (Core)** builds on Phase 1-2. DB needs config. Auth needs DB. Session needs config.
1. **Phase 4 (Infrastructure)** can happen in any order within the phase, but all depend on the config/driver pattern from Phase 1.
1. **Phase 5 (Higher-Level)** depends on core modules. Permissions needs DB. Notifications needs Mail.
1. **Phase 6 (Integration)** ties everything together. `createStack` and the SvelteKit adapter are the payoff.
1. **Phase 7-9 (Tooling/Polish)** are the cherry on top.

-----

## Session Management

Claude Code maintains context within a session. For best results:

- **One phase per session** — start a new session for each phase
- **Reference files, not memory** — say "as defined in SPEC.md" rather than describing the spec
- **Commit between tasks** — so you have clean rollback points
- If Claude seems to lose context mid-session: "Re-read CLAUDE.md and SPEC.md, then continue with Task X.Y"

-----

## When Things Go Wrong

### Claude deviates from the spec

```
"This doesn't match the spec. Re-read SPEC.md section [X] and
refactor to match the defined API surface."
```

### Tests are failing

```
"Run the tests, show me the failures, and fix them one by one."
```

### Code is getting too complex

```
"This is overengineered. Simplify: I want the minimum viable
implementation that passes the tests. We can optimize later."
```

### Module has wrong dependencies

```
"The validation module is importing from the db module. This
violates the dependency rules in CLAUDE.md. Validation must be
fully standalone with zero internal dependencies. Fix this."
```

### Want to explore before implementing

```
"Before implementing Task 3.4 (Auth), show me just the public
API surface — the types and function signatures, no implementation.
I want to review the API design first."
```

-----

## Quick Reference: Prompt Starters

|Situation    |Prompt                                                                                               |
|-------------|-----------------------------------------------------------------------------------------------------|
|Start a task |`Implement Task X.Y: [Name]. Follow SPEC.md.`                                                        |
|Add tests    |`Add tests for [module]. Cover: [specific cases].`                                                   |
|Fix a bug    |`The [module]'s [feature] does [wrong thing]. Fix it and add a regression test.`                     |
|Add a driver |`Add the [name] driver to [module]. Follow the driver pattern in src/[module]/drivers/[existing].ts.`|
|Review API   |`Show me the public API surface for [module] — types and function signatures only.`                  |
|Refactor     |`Refactor [file/module] to [specific goal]. Keep the public API unchanged.`                          |
|Check quality|`Run tests, lint, and typecheck. Fix all issues.`                                                    |
|Commit       |`Commit with message "[type]: [description]"`                                                        |
