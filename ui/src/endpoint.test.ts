import { describe, expect, it } from 'vitest'
import { otlpEndpoint } from './endpoint'

describe('otlpEndpoint', () => {
  it('appends the traces path to the origin', () => {
    expect(otlpEndpoint('http://127.0.0.1:4318')).toBe('http://127.0.0.1:4318/v1/traces')
  })

  it('ignores a trailing slash', () => {
    expect(otlpEndpoint('http://localhost:4318/')).toBe('http://localhost:4318/v1/traces')
  })
})
