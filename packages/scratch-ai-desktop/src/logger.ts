import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** How serious an entry is. */
export type LogLevel = 'Information' | 'Warning' | 'Error'

/**
 * Where the day's log files live.
 * @param documentsPath the OS documents directory
 * @returns the folder holding the log files
 */
export function logDirectory(documentsPath: string): string {
  return join(documentsPath, 'Scratch3_Logs')
}

/**
 * Two digits, so dates and times line up down the file.
 * @param value the number to pad
 * @returns the padded number
 */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * The date part of a log line and of the file name, as MM-DD-YYYY.
 * @param when the moment to format
 * @returns the formatted date
 */
export function formatDate(when: Date): string {
  return `${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${when.getFullYear()}`
}

/**
 * The time part of a log line, as a 12-hour clock.
 * @param when the moment to format
 * @returns the formatted time
 */
export function formatTime(when: Date): string {
  const hours = when.getHours()
  const suffix = hours < 12 ? 'AM' : 'PM'
  const hour = hours % 12 === 0 ? 12 : hours % 12
  return `${hour}:${pad(when.getMinutes())}${suffix}`
}

/**
 * Build one line of the log.
 * @param when the moment it happened
 * @param level how serious it is
 * @param message what happened
 * @returns the line, newline included
 */
export function formatEntry(when: Date, level: LogLevel, message: string): string {
  // Newlines would break the one-entry-per-line shape the file promises.
  const flattened = message.replace(/\r?\n/g, ' ').trim()
  return `${formatDate(when)} - ${formatTime(when)} - ${level} - ${flattened}\n`
}

/** Appends entries to a file named for the day they happened. */
export interface Logger {
  readonly directory: string
  log(level: LogLevel, message: string): void
}

/**
 * Open the log for writing.
 *
 * Logging must never be the reason the app fails, so a directory it cannot
 * create or a file it cannot write is reported once to the console and then
 * ignored.
 * @param documentsPath the OS documents directory
 * @returns a logger that appends to today's file
 */
export function createLogger(documentsPath: string): Logger {
  const directory = logDirectory(documentsPath)
  let warnedAboutFailure = false

  return {
    directory,
    log(level, message) {
      const now = new Date()
      try {
        mkdirSync(directory, { recursive: true })
        appendFileSync(join(directory, `${formatDate(now)}_Logs.txt`), formatEntry(now, level, message), 'utf8')
      } catch (error) {
        if (warnedAboutFailure) return
        warnedAboutFailure = true
        console.warn(`Could not write to ${directory}: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
