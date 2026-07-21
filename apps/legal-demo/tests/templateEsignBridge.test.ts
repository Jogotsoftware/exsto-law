// ESIGN-UNIFY-1 ES-3 (15.16b) — the template editor's marker bridge. Markers
// ({{sign:client}} et al.) are the STORAGE form; the TipTap editor shows ruled
// sig-lines. These tests pin the round trip: markdown → editor HTML hydrates a
// whole-line marker into a marker-carrying sig-line div (never raw {{sign:…}}
// text in a text node), and editor HTML → markdown emits the marker back — so
// a template survives open → save with its anchors intact.
import { describe, it, expect } from 'vitest'
import { markdownToHtml, htmlToMarkdown } from '@/lib/templateBody'
import { roleBlockHtml } from '@/components/templates/TemplateEsignPanel'

describe('markdownToHtml — marker hydration', () => {
  it('hydrates a whole-line marker into a marker-carrying sig-line div', () => {
    const html = markdownToHtml('Terms.\n\n{{sign:client}}')
    expect(html).toContain('data-sig-type="sign"')
    expect(html).toContain('data-sig-key="client"')
    expect(html).toContain('<span class="sig-line-label">Signature</span>')
    // The raw marker never appears as visible text.
    expect(html).not.toContain('{{sign:client}}')
  })

  it('keeps the "Label:" prefix as the ruled-line caption', () => {
    const html = markdownToHtml('Managing Member: {{sign:manager}}')
    expect(html).toContain('<span class="sig-line-label">Managing Member</span>')
    expect(html).toContain('data-sig-key="manager"')
  })

  it('leaves inline markers and plain merge tokens alone', () => {
    const html = markdownToHtml('Dear {{client_name}}, sign {{sign:client}} here.')
    expect(html).not.toContain('data-sig-type')
    expect(html).toContain('{{sign:client}}')
    // merge tokens still hydrate as variable chips
    expect(html).toContain('data-variable="client_name"')
  })
})

describe('htmlToMarkdown — marker restoration', () => {
  it('emits the bare marker for a default label and the prefix form for a custom one', () => {
    const bare = htmlToMarkdown(
      '<div class="sig-line" data-sig-type="sign" data-sig-key="client"><span class="sig-line-label">Signature</span></div>',
    )
    expect(bare.trim()).toBe('{{sign:client}}')
    const custom = htmlToMarkdown(
      '<div class="sig-line" data-sig-type="sign" data-sig-key="manager"><span class="sig-line-label">Managing Member</span></div>',
    )
    expect(custom.trim()).toBe('Managing Member: {{sign:manager}}')
  })

  it('legacy label-only sig-lines keep their raw-HTML round trip', () => {
    const legacy = '<div class="sig-line"><span class="sig-line-label">Signature</span></div>'
    expect(htmlToMarkdown(legacy)).toContain('sig-line')
    expect(htmlToMarkdown(legacy)).not.toContain('{{')
  })

  it('round-trips a full execution section losslessly (markers stay the storage)', () => {
    const md = [
      '**Accepted and Agreed:**',
      '',
      '{{sign:client}}',
      '',
      '{{name:client}}',
      '',
      '{{date:client}}',
    ].join('\n')
    const back = htmlToMarkdown(markdownToHtml(md))
    expect(back).toContain('{{sign:client}}')
    expect(back).toContain('{{name:client}}')
    expect(back).toContain('{{date:client}}')
    expect(back).toContain('Accepted and Agreed:')
  })
})

describe('roleBlockHtml — the eSign panel insert fragment', () => {
  const role = {
    key: 'client',
    label: 'Client',
    recipientRole: 'needs_to_sign' as const,
    bind: 'matter_primary_contact' as const,
    order: 1,
  }

  it('inserts sign/name/date sig-lines that save back as the canonical markers', () => {
    const html = roleBlockHtml(role, true)
    expect(html).toContain('<p><strong>Accepted and Agreed:</strong></p>')
    const md = htmlToMarkdown(html)
    expect(md).toContain('{{sign:client}}')
    expect(md).toContain('{{name:client}}')
    expect(md).toContain('{{date:client}}')
  })

  it('omits the heading when the body already has an execution section', () => {
    expect(roleBlockHtml(role, false)).not.toContain('Accepted and Agreed')
  })
})
