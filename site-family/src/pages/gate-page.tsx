import { Link } from 'react-router'
import { PageHero } from '@/components/page-hero'
import { CodeBlock } from '@/components/code-block'
import { GateTool } from '@/features/gate-tool/gate-tool'
import { CURL_GATE, MCP_CLAUDE } from '@/features/docs/docs-snippets'
import { pageTitle, useDocumentTitle } from '@/lib/use-document-title'

export default function GatePage() {
  useDocumentTitle(pageTitle('Gate'))
  return (
    <>
      <PageHero
        kicker="The gate"
        tone="text-grass"
        title="Run a payment through the gate."
        text="Fill in what your agent is about to pay. You get ALLOW, REVIEW or BLOCK, every rule that decided it, and a receipt you can verify."
        image="/assets/pages/gate.webp"
      />
      <section className="mx-auto max-w-[1040px] px-5 pb-20 pt-6" aria-label="Gate tool">
        <GateTool />
      </section>
      <section className="border-t border-hair">
        <div className="mx-auto max-w-[1040px] px-5 py-16">
          <h2 className="text-[28px] font-semibold leading-tight sm:text-[34px]">Same answer your agent gets.</h2>
          <p className="mt-3 max-w-[560px] text-[17px] text-ink/65">The form above sends this exact call. Your agent does it with one line before every payment.</p>
          <div className="mt-8 grid min-w-0 gap-4 md:grid-cols-2">
            <CodeBlock label="curl" code={CURL_GATE} />
            <CodeBlock label="MCP, in Claude Code" code={MCP_CLAUDE} />
          </div>
          <p className="mt-6 text-[15px] text-ink/65">
            Fields, paying and the receipt format are in the <Link to="/docs" className="font-medium text-ink underline underline-offset-4">docs</Link>.
          </p>
        </div>
      </section>
    </>
  )
}
