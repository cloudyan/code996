import dayjs from 'dayjs'

declare module 'dayjs' {
  interface Dayjs {
    isSameOrBefore(date: Dayjs, unit?: string): boolean
  }
}
