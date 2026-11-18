/** A delivery that failed: no answer in time, a server that refused, a DSN that is none */
export class MonitoringError extends Error {
  override name = 'MonitoringError'
}
