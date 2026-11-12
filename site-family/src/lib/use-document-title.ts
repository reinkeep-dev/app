import { useEffect } from 'react'

// One title per page. Home passes the full brand line; the other pages get "Name · Reinkeep AI".
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title
  }, [title])
}

export const pageTitle = (name: string) => `${name} · Reinkeep AI`
