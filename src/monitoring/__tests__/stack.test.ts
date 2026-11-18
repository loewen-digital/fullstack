import { describe, it, expect } from 'vite-plus/test'
import { parseStack } from '../index.js'

describe('parseStack', () => {
  it('reads a V8 stack, as Chrome and Edge write it', () => {
    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'title')",
      '    at render (https://app.example/_app/immutable/chunks/item.BxYz.js:12:34)',
      '    at async load (https://app.example/_app/immutable/nodes/3.abc.js?v=2:1:100)',
      '    at new Store (https://app.example/_app/a.js:3:4)',
      '    at Array.map (<anonymous>)',
      '    at https://app.example/_app/b.js:5:6',
      '    at Store.save [as persist] (https://app.example/_app/a.js:9:1)',
      '    at eval (eval at run (https://app.example/_app/c.js:7:8), <anonymous>:1:1)',
      '    at async Promise.all (index 0)',
    ].join('\n')

    expect(parseStack(stack)).toEqual([
      {
        file: 'https://app.example/_app/immutable/chunks/item.BxYz.js',
        function: 'render',
        line: 12,
        column: 34,
      },
      {
        file: 'https://app.example/_app/immutable/nodes/3.abc.js',
        function: 'load',
        line: 1,
        column: 100,
      },
      { file: 'https://app.example/_app/a.js', function: 'new Store', line: 3, column: 4 },
      { function: 'Array.map' },
      { file: 'https://app.example/_app/b.js', line: 5, column: 6 },
      { file: 'https://app.example/_app/a.js', function: 'Store.save', line: 9, column: 1 },
      { file: 'https://app.example/_app/c.js', function: 'eval', line: 7, column: 8 },
      { function: 'Promise.all' },
    ])
  })

  it('reads a Firefox stack', () => {
    const stack = [
      'render@https://app.example/_app/item.js:12:34',
      'async*load@https://app.example/_app/nodes/3.js:1:100',
      '@https://app.example/_app/b.js:5:6',
      'run@https://app.example/_app/c.js line 7 > eval:1:1',
      'pick@https://app.example/node_modules/@scope/pkg/index.js:2:3',
    ].join('\n')

    expect(parseStack(stack)).toEqual([
      { file: 'https://app.example/_app/item.js', function: 'render', line: 12, column: 34 },
      { file: 'https://app.example/_app/nodes/3.js', function: 'load', line: 1, column: 100 },
      { file: 'https://app.example/_app/b.js', line: 5, column: 6 },
      { file: 'https://app.example/_app/c.js', function: 'run', line: 7 },
      {
        file: 'https://app.example/node_modules/@scope/pkg/index.js',
        function: 'pick',
        line: 2,
        column: 3,
      },
    ])
  })

  it('reads a Safari stack, with its bare addresses and native code', () => {
    const stack = [
      'render@https://app.example/_app/item.js:12:34',
      'https://app.example/node_modules/@scope/pkg/index.js:5:6',
      'forEach@[native code]',
      'module code@https://app.example/_app/start.js:1:9',
      '[native code]',
    ].join('\n')

    expect(parseStack(stack)).toEqual([
      { file: 'https://app.example/_app/item.js', function: 'render', line: 12, column: 34 },
      { file: 'https://app.example/node_modules/@scope/pkg/index.js', line: 5, column: 6 },
      { function: 'forEach' },
      { file: 'https://app.example/_app/start.js', function: 'module code', line: 1, column: 9 },
    ])
  })

  it('reads the stacks of workerd and Node, past a message of several lines', () => {
    const stack = [
      'Error: the first line',
      'and a second one',
      '    at Object.fetch (index.js:12:11)',
      '    at async handle (file:///srv/app/server.js:3:5)',
      '    at run (C:\\srv\\app.js:10:5)',
      '    at node:internal/process/task_queues:95:5',
    ].join('\n')

    expect(parseStack(stack)).toEqual([
      { file: 'index.js', function: 'Object.fetch', line: 12, column: 11 },
      { file: 'file:///srv/app/server.js', function: 'handle', line: 3, column: 5 },
      { file: 'C:\\srv\\app.js', function: 'run', line: 10, column: 5 },
      { file: 'node:internal/process/task_queues', line: 95, column: 5 },
    ])
  })

  it('takes the query string and the fragment off an address', () => {
    // A script in the page itself is named by the page's address.
    const [chrome] = parseStack(
      'Error: x\n    at https://app.example/items/42?token=secret#part:3:1',
    )
    const [safari] = parseStack('global code@https://app.example/items/42?token=secret:3:1')

    expect(chrome).toEqual({ file: 'https://app.example/items/42', line: 3, column: 1 })
    expect(safari).toEqual({
      file: 'https://app.example/items/42',
      function: 'global code',
      line: 3,
      column: 1,
    })
  })

  it('keeps a port apart from a line number', () => {
    expect(parseStack('Error: x\n    at http://localhost:5173/src/a.js:10:15')).toEqual([
      { file: 'http://localhost:5173/src/a.js', line: 10, column: 15 },
    ])
  })

  it('stops after 50 frames', () => {
    const stack = `RangeError: Maximum call stack size exceeded\n${'    at loop (https://app.example/a.js:1:1)\n'.repeat(80)}`

    expect(parseStack(stack)).toHaveLength(50)
  })

  it('gives no frames for what is no stack', () => {
    expect(parseStack(undefined)).toEqual([])
    expect(parseStack(42)).toEqual([])
    expect(parseStack('')).toEqual([])
    expect(parseStack('Error: only a message')).toEqual([])
  })
})
