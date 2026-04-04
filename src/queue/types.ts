import type { QueueConfig } from '../config/types.js'

export type { QueueConfig }

export interface Job<T = unknown> {
  /** Unique job identifier */
  id: string
  /** Job name / type */
  name: string
  /** Job payload data */
  payload: T
  /** Number of times this job has been attempted */
  attempts: number
  /** Maximum number of attempts before moving to dead letter */
  maxAttempts: number
  /** Backoff delay in seconds between retries */
  backoff: number
  /** Timeout in seconds for job execution */
  timeout: number
  /** When the job was created */
  createdAt: Date
}

export interface JobDefinition<T = unknown> {
  /** Job name / type */
  name: string
  /** Job payload data */
  payload: T
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number
  /** Backoff delay in seconds between retries (default: 60) */
  backoff?: number
  /** Timeout in seconds for job execution (default: 30) */
  timeout?: number
  /** Delay before processing in seconds */
  delay?: number
}

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void> | void

export interface QueueDriver {
  /** Push a job onto the queue */
  push(job: Job): Promise<void>
  /** Pop the next job from the queue (or null if empty) */
  pop(): Promise<Job | null>
  /** Mark a job as completed */
  complete(jobId: string): Promise<void>
  /** Mark a job as failed; re-enqueue if attempts remain */
  fail(jobId: string, error: Error): Promise<void>
  /** Get the number of pending jobs */
  size(): Promise<number>
  /** Get all failed jobs */
  failed(): Promise<Job[]>
  /** Retry a failed job by ID */
  retry(jobId: string): Promise<void>
  /** Clear all jobs (pending + failed) */
  flush(): Promise<void>
}

export interface QueueInstance {
  /** Dispatch a job to the queue */
  dispatch<T>(job: JobDefinition<T>): Promise<Job<T>>
  /** Process jobs with registered handlers */
  process(): Promise<void>
  /** Register a handler for a job type */
  handle<T = unknown>(name: string, handler: JobHandler<T>): void
  /** Get the number of pending jobs */
  size(): Promise<number>
  /** Get all failed jobs */
  failed(): Promise<Job[]>
  /** Retry a failed job by ID */
  retry(jobId: string): Promise<void>
  /** Clear all jobs */
  flush(): Promise<void>
}
