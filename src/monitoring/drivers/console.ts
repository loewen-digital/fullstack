import type { ErrorReportDriver, StackFrame } from '../types.js'

function line(frame: StackFrame): string {
  const where = [frame.file ?? '<anonymous>', frame.line, frame.column]
    .filter((part) => part !== undefined)
    .join(':')
  return frame.function === undefined ? `    at ${where}` : `    at ${frame.function} (${where})`
}

/**
 * Create the driver for development: it prints each report with `console.error`, the way it would
 * be sent, and sends nothing. What it prints is what a server would get, so it shows what the
 * scrubbing left of an error.
 */
export function createConsoleDriver(): ErrorReportDriver {
  return {
    name: 'console',
    async send(report) {
      const where = [report.method, report.route].filter(Boolean).join(' ')
      console.error(
        [
          `[error report ${report.reference}] ${report.type}: ${report.message}`,
          ...(where === '' ? [] : [`    in ${where}`]),
          ...report.frames.map(line),
          ...report.causes.map((cause) => `  caused by ${cause.type}: ${cause.message}`),
        ].join('\n'),
      )
    },
  }
}
