import { useEffect } from 'react'

// One title per page, from src/lib/site-pages.ts (the same titles the built HTML and link cards use).
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title
  }, [title])
}
