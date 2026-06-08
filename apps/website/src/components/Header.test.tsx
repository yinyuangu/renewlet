import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Header } from './Header'

describe('Header', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the Vite base URL for the Renewlet home link', () => {
    vi.stubEnv('BASE_URL', '/renewlet/')

    render(<Header locale="zh" onLocaleChange={vi.fn()} />)

    const homeLink = screen.getByRole('link', { name: /Renewlet home/i })

    expect(homeLink).toHaveAttribute('href', '/renewlet/')
    expect(homeLink).not.toHaveAttribute('target')
  })

  it('opens external header links in a new tab', () => {
    render(<Header locale="zh" onLocaleChange={vi.fn()} />)

    for (const link of [
      screen.getByRole('link', { name: /^文档$/i }),
      screen.getByRole('link', { name: /^GitHub$/i }),
    ]) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })
})
