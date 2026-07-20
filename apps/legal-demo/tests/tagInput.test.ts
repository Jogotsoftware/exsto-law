// ITEM-12 WP-2 — pure add/remove/dedupe logic behind the TagInput pills editor
// (components/TagInput.tsx). No component-test harness exists in this repo
// (see apps/legal-demo/tests/), so the interaction logic is extracted into
// framework-free functions and tested directly here, rather than mounting the
// component.
import { describe, it, expect } from 'vitest'
import { addTag, removeTagAt, removeLastTag } from '@/components/TagInput'

describe('addTag', () => {
  it('adds a trimmed value to an empty list', () => {
    expect(addTag([], '  Always CC my paralegal.  ')).toEqual(['Always CC my paralegal.'])
  })

  it('appends to an existing list', () => {
    expect(addTag(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('ignores an empty or whitespace-only value (same array reference back)', () => {
    const values = ['a']
    expect(addTag(values, '')).toBe(values)
    expect(addTag(values, '   ')).toBe(values)
  })

  it('dedupes case-insensitively (same array reference back, no duplicate added)', () => {
    const values = ['Always CC my paralegal.']
    expect(addTag(values, 'always cc my paralegal.')).toBe(values)
    expect(addTag(values, 'ALWAYS CC MY PARALEGAL.')).toEqual(values)
  })

  it('caps an item at maxItemChars', () => {
    const long = 'x'.repeat(600)
    expect(addTag([], long, { maxItemChars: 500 })).toEqual([long.slice(0, 500)])
  })

  it('refuses to add past maxItems (same array reference back)', () => {
    const values = ['a', 'b']
    expect(addTag(values, 'c', { maxItems: 2 })).toBe(values)
    expect(addTag(values, 'c', { maxItems: 3 })).toEqual(['a', 'b', 'c'])
  })
})

describe('removeTagAt', () => {
  it('removes the item at the given index', () => {
    expect(removeTagAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
  })

  it('removing an out-of-range index leaves the list unchanged in content', () => {
    expect(removeTagAt(['a', 'b'], 5)).toEqual(['a', 'b'])
  })

  it('does not mutate the input array', () => {
    const values = ['a', 'b']
    removeTagAt(values, 0)
    expect(values).toEqual(['a', 'b'])
  })
})

describe('removeLastTag', () => {
  it('removes the last item', () => {
    expect(removeLastTag(['a', 'b', 'c'])).toEqual(['a', 'b'])
  })

  it('an empty list stays empty (same array reference back)', () => {
    const values: string[] = []
    expect(removeLastTag(values)).toBe(values)
  })

  it('a single-item list empties', () => {
    expect(removeLastTag(['only'])).toEqual([])
  })
})
