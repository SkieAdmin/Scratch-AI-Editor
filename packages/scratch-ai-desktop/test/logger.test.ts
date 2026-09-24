import { describe, expect, it } from 'vitest'
import { formatDate, formatEntry, formatTime, logDirectory } from '../src/logger'

describe('log formatting', () => {
  it('names the file and the entry by month, day and year', () => {
    expect(formatDate(new Date(2026, 8, 24, 12, 30))).toBe('09-24-2026')
  })

  it('pads a single-digit month and day', () => {
    expect(formatDate(new Date(2026, 0, 5, 9, 7))).toBe('01-05-2026')
  })

  it('writes the time on a twelve-hour clock', () => {
    expect(formatTime(new Date(2026, 8, 24, 12, 30))).toBe('12:30PM')
    expect(formatTime(new Date(2026, 8, 24, 0, 5))).toBe('12:05AM')
    expect(formatTime(new Date(2026, 8, 24, 9, 7))).toBe('9:07AM')
    expect(formatTime(new Date(2026, 8, 24, 13, 45))).toBe('1:45PM')
  })

  it('writes an entry as date, time, level and message', () => {
    expect(formatEntry(new Date(2026, 8, 24, 12, 30), 'Warning', 'Message goes Here')).toBe(
      '09-24-2026 - 12:30PM - Warning - Message goes Here\n',
    )
  })

  it('keeps one entry on one line', () => {
    const entry = formatEntry(new Date(2026, 8, 24, 12, 30), 'Error', 'first line\nsecond line')

    expect(entry).toBe('09-24-2026 - 12:30PM - Error - first line second line\n')
    expect(entry.split('\n').filter(Boolean)).toHaveLength(1)
  })

  it('keeps the logs beside the settings, in the documents folder', () => {
    expect(logDirectory('/home/someone/Documents')).toMatch(/Scratch3_Logs$/)
  })
})
