import { useState, useEffect } from 'react'
import { addressToNfd } from './nfd.js'

export function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/** Resolve an Algorand address to its NFD name. Returns null while loading or if no NFD. */
export function useNfd(address: string | undefined): string | null {
  const [nfd, setNfd] = useState<string | null>(null)
  useEffect(() => {
    setNfd(null)
    if (!address) return
    addressToNfd(address).then(setNfd).catch(() => setNfd(null))
  }, [address])
  return nfd
}
