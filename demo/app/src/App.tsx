import { useState, useRef, useEffect, useCallback } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import WalletConnect from './components/WalletConnect.js'
import WalletModal from './components/WalletModal.js'
import CodeBlock from './components/CodeBlock.js'
import { ENDPOINTS, buildUrl, buildSnippet } from './endpoints.js'
import {
  getBalances,
  getAlgoBalance,
  payAndFetch,
  createSigner,
  type Step,
  type Balances,
} from './wallet.js'
import { useWindowWidth, useNfd } from './hooks.js'
import { resolveToAddress, isNfdName } from './nfd.js'
import type { LogLine, Kind, MobileTab } from './types.js'

export default function App() {
  const { activeAccount, activeWallet, signTransactions } = useWallet()
  const width = useWindowWidth()
  const isMobile = width < 768

  const [showWallet, setShowWallet] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(() => {
    return (localStorage.getItem('mpp-theme') as 'dark' | 'light' | 'system') ?? 'dark'
  })
  const [balances, setBalances] = useState<Balances | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [logs, setLogs] = useState<LogLine[]>([])
  const [running, setRunning] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const [mobileTab, setMobileTab] = useState<MobileTab>('api')
  const [totalRequests, setTotalRequests] = useState(0)
  const [feePayerInfo, setFeePayerInfo] = useState<{
    address: string
    balance: number
  } | null>(null)
  const [products, setProducts] = useState<Array<{ id: string; name: string; description: string; price: string }>>([])
  const [serverNetwork, setServerNetwork] = useState<string>('testnet')
  const logRef = useRef<HTMLDivElement>(null)
  const logId = useRef(0)

  const endpoint = ENDPOINTS[selectedIdx]
  const senderAddress = activeAccount?.address ?? ''
  const senderNfd = useNfd(senderAddress || undefined)

  // Fetch marketplace products and server config
  useEffect(() => {
    fetch('/api/v1/marketplace/products')
      .then((r) => r.json())
      .then((data) => setProducts(data as typeof products))
      .catch(() => {})
    fetch('/api/v1/health')
      .then((r) => r.json())
      .then((data: { network?: string }) => {
        if (data.network) {
          // Extract human-readable name from CAIP-2 identifier
          const caip2 = data.network
          if (caip2.includes('SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=')) setServerNetwork('testnet')
          else if (caip2.includes('wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=')) setServerNetwork('mainnet')
          else setServerNetwork(caip2)
        }
      })
      .catch(() => {})
  }, [])

  // Theme management
  const resolvedTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme

  useEffect(() => {
    localStorage.setItem('mpp-theme', theme)
    document.body.style.background = resolvedTheme === 'light' ? '#F5F5F5' : '#0A0A0A'
    document.body.style.color = resolvedTheme === 'light' ? '#1A1A1A' : '#E0E0E0'
  }, [theme, resolvedTheme])

  const t = resolvedTheme === 'light' ? lightColors : darkColors

  const refreshBalance = useCallback(async () => {
    if (!senderAddress) return
    try {
      setBalances(await getBalances(senderAddress))
    } catch {
      /* wallet not ready */
    }
    if (feePayerInfo) {
      try {
        const bal = await getAlgoBalance(feePayerInfo.address)
        setFeePayerInfo((prev) => (prev ? { ...prev, balance: bal } : prev))
      } catch {}
    }
  }, [senderAddress, feePayerInfo])

  useEffect(() => {
    if (senderAddress) refreshBalance()
  }, [senderAddress, refreshBalance])

  const addLog = (text: string, kind: Kind) => {
    setLogs((prev) => [...prev, { id: logId.current++, text, kind }])
    setTimeout(
      () => logRef.current?.scrollTo(0, logRef.current.scrollHeight),
      10,
    )
  }

  const handleSend = async () => {
    if (running || !senderAddress) return
    setRunning(true)

    // Resolve NFD names in params before building URL
    const resolvedParams = { ...paramValues }
    if (resolvedParams.referrer && isNfdName(resolvedParams.referrer)) {
      const resolved = await resolveToAddress(resolvedParams.referrer)
      if (resolved) {
        resolvedParams.referrer = resolved
      } else {
        addLog(`Could not resolve NFD: ${resolvedParams.referrer}`, 'error')
        setRunning(false)
        return
      }
    }

    const url = buildUrl(endpoint, resolvedParams)
    const signer = createSigner(signTransactions)

    for await (const step of payAndFetch(url, signer, senderAddress)) {
      switch (step.type) {
        case 'request':
          addLog(`${endpoint.method} ${step.url}`, 'req')
          break
        case 'challenge':
          if (step.feePayerKey && !feePayerInfo) {
            getAlgoBalance(step.feePayerKey)
              .then((bal) =>
                setFeePayerInfo({ address: step.feePayerKey!, balance: bal }),
              )
              .catch(() => {})
          }
          const currency = step.currency ?? 'ALGO'
          const decimals = 6 // ALGO and USDC both use 6 decimals on Algorand
          const human = (Number(step.amount) / 10 ** decimals).toFixed(
            currency === 'ALGO' ? 3 : 2,
          )
          addLog(`402 Payment Required: ${human} ${currency}`, '402')
          break
        case 'signing':
          addLog('Signing transaction group...', 'info')
          break
        case 'paying':
          addLog('Broadcasting to Algorand...', 'info')
          break
        case 'paid':
          addLog(`Confirmed: ${step.txid.slice(0, 20)}...`, 'info')
          break
        case 'success':
          addLog(`${step.status} OK`, 'ok')
          addLog(JSON.stringify(step.data, null, 2).slice(0, 500), 'dim')
          break
        case 'error':
          addLog(`Error: ${step.message}`, 'error')
          break
      }
    }

    setTotalRequests((n) => n + 1)
    refreshBalance()
    setRunning(false)
  }

  // Not connected — show wallet connect screen
  if (!activeAccount) {
    return <WalletConnect onConnected={() => refreshBalance()} isDark={resolvedTheme === 'dark'} />
  }

  const kindColor: Record<Kind, string> = {
    req: t.accent,
    '402': '#FFD700',
    ok: t.green,
    error: '#f88',
    info: '#4FC3F7',
    dim: '#666',
  }

  const themeBtn = (value: 'dark' | 'light' | 'system', icon: string, label: string) => (
    <button
      title={label}
      style={{
        padding: '4px 7px',
        background: theme === value ? t.accent + '22' : 'transparent',
        border: `1px solid ${theme === value ? t.accent + '66' : t.border}`,
        borderRadius: 5,
        color: theme === value ? t.accent : t.muted,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 12,
        cursor: 'pointer',
        lineHeight: 1,
      }}
      onClick={() => setTheme(value)}
    >
      {icon}
    </button>
  )

  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${t.border}`, background: t.bgAlt }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {themeBtn('light', '\u2600', 'Light')}
        {themeBtn('dark', '\u263E', 'Dark')}
        {themeBtn('system', '\u25D0', 'System')}
      </div>
      <button
        title="Info"
        style={{
          padding: '4px 8px',
          background: 'transparent',
          border: `1px solid ${t.border}`,
          borderRadius: 5,
          color: t.muted,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 12,
          cursor: 'pointer',
          lineHeight: 1,
        }}
        onClick={() => setShowInfo(true)}
      >
        i
      </button>
      <span style={{ fontSize: 9, color: t.muted, marginLeft: 4 }}>
        Powered by <a href="https://goplausible.com" target="_blank" rel="noopener" style={{ color: t.accent, textDecoration: 'none' }}>GoPlausible</a>
      </span>
    </div>
  )

  const infoDialog = showInfo ? (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowInfo(false)}>
      <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, padding: 28, maxWidth: 420, width: '90%', fontFamily: 'JetBrains Mono, monospace' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: t.text }}>Algorand MPP SDK</h3>
          <button style={{ background: 'none', border: 'none', color: t.muted, fontSize: 18, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }} onClick={() => setShowInfo(false)}>&times;</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a href="https://github.com/GoPlausible/algorand-mpp-sdk-sdk" target="_blank" rel="noopener" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: t.bgAlt, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, textDecoration: 'none', fontSize: 12 }}>
            <span style={{ fontSize: 16 }}>&#128193;</span>
            <div><div style={{ fontWeight: 600 }}>GitHub Repository</div><div style={{ color: t.muted, fontSize: 10, marginTop: 2 }}>GoPlausible/algorand-mpp-sdk-sdk</div></div>
          </a>
          <a href="https://www.npmjs.com/package/@goplausible/algorand-mpp-sdk" target="_blank" rel="noopener" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: t.bgAlt, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, textDecoration: 'none', fontSize: 12 }}>
            <span style={{ fontSize: 16 }}>&#128230;</span>
            <div><div style={{ fontWeight: 600 }}>NPM Package</div><div style={{ color: t.muted, fontSize: 10, marginTop: 2 }}>@goplausible/algorand-mpp-sdk</div></div>
          </a>
          <a href="https://github.com/GoPlausible/algorand-mpp-sdk-sdk/tree/main/docs" target="_blank" rel="noopener" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: t.bgAlt, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, textDecoration: 'none', fontSize: 12 }}>
            <span style={{ fontSize: 16 }}>&#128214;</span>
            <div><div style={{ fontWeight: 600 }}>Documentation</div><div style={{ color: t.muted, fontSize: 10, marginTop: 2 }}>Architecture, flows, and guides</div></div>
          </a>
        </div>
        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 10, color: t.muted }}>
          Built and powered by <a href="https://goplausible.com" target="_blank" rel="noopener" style={{ color: t.accent, textDecoration: 'none' }}>GoPlausible</a>
        </div>
      </div>
    </div>
  ) : null

  const footer = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '6px 16px', borderTop: `1px solid ${t.border}`, background: t.bgAlt }}>
      <span style={{ fontSize: 9, color: t.muted }}>
        Built and powered by <a href="https://goplausible.com" target="_blank" rel="noopener" style={{ color: t.accent, textDecoration: 'none' }}>GoPlausible</a>
      </span>
    </div>
  )

  const sidebar = (
    <div style={{...s.sidebar, background: t.bgSidebar, borderColor: t.border}}>
      <div style={{...s.brandBar, background: t.bgAlt, borderColor: t.border}}>
        <img src="/algorand-logomark-blue-RGB.png" alt="Algorand" style={s.brandLogo} />
        <div>
          <div style={{...s.brandTitle, color: t.text}}>Algorand <span style={{ color: '#6F42C1' }}>MPP</span></div>
          <div style={s.brandSub}>Machine Payments Protocol</div>
        </div>
      </div>
      <div style={{...s.sidebarHeader, borderColor: t.border}}>
        <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>
          Endpoints
        </span>
      </div>
      <div style={{...s.walletBar, borderColor: t.border, background: t.bgAlt}}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {activeWallet?.metadata.icon && (
            <img src={activeWallet.metadata.icon} alt="" style={{ width: 18, height: 18, borderRadius: 4 }} />
          )}
          <span style={{ color: t.green, fontSize: 11 }}>
            {senderNfd ?? `${senderAddress.slice(0, 4)}...${senderAddress.slice(-4)}`}
          </span>
          <span style={{ color: t.muted, fontSize: 10 }}>
            {balances !== null ? `${balances.algo.toFixed(2)} A` : '...'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: t.muted, fontSize: 9, textTransform: 'uppercase' as const }}>
            {serverNetwork}
          </span>
          <button style={{...s.walletBtn, background: t.green + '22', borderColor: t.green + '44', color: t.green}} onClick={() => setShowWallet(true)}>
            info
          </button>
          <button
            style={{ ...s.walletBtn, background: '#f8888822', borderColor: '#f8888844', color: '#f88' }}
            onClick={async () => {
              await activeWallet?.disconnect()
            }}
          >
            ×
          </button>
        </div>
      </div>
      {ENDPOINTS.map((ep, i) => (
        <button
          key={ep.path}
          style={{
            ...s.epBtn,
            background: i === selectedIdx ? (resolvedTheme === 'light' ? '#E8E0F8' : '#1A1A2A') : 'transparent',
            borderColor: i === selectedIdx ? t.accent : t.border,
            color: t.text,
          }}
          onClick={() => {
            setSelectedIdx(i)
            setParamValues({})
          }}
        >
          <span
            style={{
              color: ep.method === 'GET' ? t.green : '#FFD700',
              fontSize: 10,
            }}
          >
            {ep.method}
          </span>
          <span style={{ color: t.text, fontSize: 12, marginLeft: 8 }}>
            {ep.description}
          </span>
          <span style={{ color: t.muted, fontSize: 10, marginLeft: 'auto' }}>
            {ep.cost}
          </span>
        </button>
      ))}
      <div style={{...s.sidebarBottom, borderColor: t.border}}>
        {feePayerInfo && (
          <div style={{...s.balanceSection, background: t.bgAlt, borderColor: t.border}}>
            <div style={s.balanceLabel}>Fee payer</div>
            <div style={s.balanceRow}>
              <span style={{ color: t.accent, fontWeight: 600 }}>
                {feePayerInfo.balance.toFixed(3)}
              </span>
              <span style={{ color: t.muted }}>ALGO</span>
            </div>
            <div style={{ color: t.muted, fontSize: 9, marginTop: 2 }}>
              {feePayerInfo.address.slice(0, 8)}...
              {feePayerInfo.address.slice(-4)}
            </div>
          </div>
        )}
        <div style={{ ...s.balanceSection, marginTop: 8, background: t.bgAlt, borderColor: t.border }}>
          <div style={s.balanceLabel}>Client</div>
          <div style={s.balanceRow}>
            <span style={{ color: t.green, fontWeight: 600 }}>
              {balances !== null ? balances.algo.toFixed(3) : '\u2014'}
            </span>
            <span style={{ color: t.muted }}>ALGO</span>
          </div>
          <div style={s.balanceRow}>
            <span style={{ color: t.muted }}>
              {balances !== null ? balances.usdc.toFixed(2) : '\u2014'}
            </span>
            <span style={{ color: t.muted }}>USDC</span>
          </div>
        </div>
        <div style={{ color: t.muted, fontSize: 10, marginTop: 8 }}>
          {totalRequests} request{totalRequests !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  )

  const CITIES = ['san-francisco', 'new-york', 'london', 'tokyo', 'paris', 'sydney', 'berlin', 'dubai']

  const selectEndpoint = (idx: number, params: Record<string, string>) => {
    setSelectedIdx(idx)
    setParamValues(params)
  }

  // Find endpoint indices
  const weatherIdx = ENDPOINTS.findIndex((e) => e.path.includes('weather'))
  const buyIdx = ENDPOINTS.findIndex((e) => e.path.includes('marketplace/buy'))

  const productIcons: Record<string, string> = {
    'algo-hoodie': 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="12" fill="#1A1A2A"/><path d="M16 24h32v22a4 4 0 01-4 4H20a4 4 0 01-4-4V24z" fill="#6F42C1" opacity="0.8"/><path d="M22 14h20l6 10H16l6-10z" fill="#6F42C1"/><path d="M10 24l6-10M48 14l6 10" stroke="#6F42C1" stroke-width="2" stroke-linecap="round"/><path d="M28 32l4-8 4 8M29 30h6" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
    'validator-mug': 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="12" fill="#1A1A2A"/><rect x="16" y="20" width="24" height="28" rx="3" fill="#00D4AA" opacity="0.8"/><path d="M40 26h6a4 4 0 010 8h-6" stroke="#00D4AA" stroke-width="2"/><ellipse cx="28" cy="20" rx="12" ry="3" fill="#00D4AA"/><path d="M24 32l4-6 4 6M25.5 30.5h5" stroke="#1A1A2A" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 14c0-2 2-3 6-3s6 1 6 3" stroke="#888" stroke-width="1" stroke-linecap="round" opacity="0.5"/><path d="M24 14c0-1 1.5-2 4-2" stroke="#888" stroke-width="1" stroke-linecap="round" opacity="0.3"/></svg>`),
    'nft-sticker-pack': 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="12" fill="#1A1A2A"/><rect x="12" y="16" width="24" height="32" rx="4" fill="#FFD700" opacity="0.3" transform="rotate(-6 12 16)"/><rect x="20" y="14" width="24" height="32" rx="4" fill="#FFD700" opacity="0.5" transform="rotate(3 20 14)"/><rect x="16" y="16" width="24" height="32" rx="4" fill="#FFD700" opacity="0.8"/><circle cx="28" cy="28" r="6" fill="#1A1A2A"/><path d="M25.5 28l2.5-4 2.5 4" stroke="#FFD700" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="22" y="38" width="12" height="2" rx="1" fill="#1A1A2A" opacity="0.5"/><rect x="24" y="42" width="8" height="2" rx="1" fill="#1A1A2A" opacity="0.3"/></svg>`),
  }

  const isWeather = endpoint.path.includes('weather')
  const isMarketplace = endpoint.path.includes('marketplace')

  const showcase = (isWeather || isMarketplace) ? (
    <div style={{...s.showcase, borderColor: t.border, background: t.bgSidebar}}>
      {isWeather && (
        <div style={s.showcaseSection}>
          <div style={{...s.showcaseTitle, color: t.text}}>Select a city</div>
          <div style={s.showcaseGrid}>
            {CITIES.map((city) => (
              <button
                key={city}
                style={{
                  ...s.showcaseChip,
                  background: t.bgCard,
                  borderColor: (paramValues.city || 'san-francisco') === city ? t.green : t.border,
                  color: t.text,
                }}
                onClick={() => setParamValues({ city })}
              >
                {city.replace(/-/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}
      {isMarketplace && products.length > 0 && (
        <div style={s.showcaseSection}>
          <div style={{...s.showcaseTitle, color: t.text}}>Products</div>
          <div style={{...s.showcaseSub, color: t.muted}}>USDC with splits (seller + 5% platform + 2% referral)</div>
          <div style={s.productGrid}>
            {products.map((p) => (
              <button
                key={p.id}
                style={{
                  ...s.productCard,
                  background: t.bgCard,
                  borderColor: endpoint.path.includes('buy') && (paramValues.productId || 'algo-hoodie') === p.id ? t.accent : t.border,
                }}
                onClick={() => selectEndpoint(buyIdx, { productId: p.id, referrer: '' })}
              >
                {productIcons[p.id] && (
                  <img src={productIcons[p.id]} alt="" style={{ width: 48, height: 48, borderRadius: 8, marginBottom: 8 }} />
                )}
                <div style={{ color: t.text, fontSize: 12, fontWeight: 600 }}>{p.name}</div>
                <div style={{ color: t.muted, fontSize: 10, marginTop: 2 }}>{p.description}</div>
                <div style={{ color: '#FFD700', fontSize: 11, marginTop: 6, fontWeight: 600 }}>{p.price}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  ) : null

  const apiPanel = (
    <div style={{...s.apiPanel, borderColor: t.border}}>
      <div style={{...s.apiHeader, borderColor: t.border}}>
        <span style={{ color: t.green, fontSize: 11 }}>
          {endpoint.method}
        </span>
        <span style={{ color: t.text, fontSize: 13, marginLeft: 8 }}>
          {endpoint.path}
        </span>
        <span style={{ color: t.muted, fontSize: 11, marginLeft: 'auto' }}>
          {endpoint.cost}
        </span>
      </div>
      <div style={s.params}>
        {(endpoint.params ?? []).map((p) => (
          <div
            key={p.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <label style={{ color: t.muted, fontSize: 12, minWidth: 80 }}>
              {p.name}
            </label>
            <input
              style={{...s.input, background: t.bgAlt, borderColor: t.border, color: t.text}}
              value={paramValues[p.name] ?? p.default}
              onChange={(e) =>
                setParamValues((v) => ({ ...v, [p.name]: e.target.value }))
              }
              placeholder={p.name === 'referrer' ? 'address or name.algo' : p.default}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <button style={s.sendBtn} onClick={handleSend} disabled={running}>
          {running ? 'Sending...' : 'Send Request'}
        </button>
        <button
          style={{
            ...s.codeToggle,
            background: t.bgCard,
            borderColor: showCode ? t.accent : t.border,
            color: t.text,
          }}
          onClick={() => setShowCode(!showCode)}
        >
          {'</>'}
        </button>
      </div>
      {showCode && (
        <div style={{...s.codePane, background: t.bgAlt, borderColor: t.border}}>
          <CodeBlock code={buildSnippet(endpoint, paramValues)} />
        </div>
      )}
    </div>
  )

  const terminal = (
    <div ref={logRef} style={{...s.terminal, background: t.bgAlt}}>
      {logs.length === 0 && (
        <div style={{ color: t.muted, padding: 16, fontSize: 12 }}>
          Send a request to see the 402 payment flow...
        </div>
      )}
      {logs.map((log) => (
        <div
          key={log.id}
          style={{
            padding: '2px 16px',
            fontSize: 12,
            color: kindColor[log.kind],
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {log.text}
        </div>
      ))}
    </div>
  )

  if (isMobile) {
    return (
      <div
        style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={s.mobileTabs}>
          {(['api', 'terminal', 'code'] as const).map((tab) => (
            <button
              key={tab}
              style={{
                ...s.mobileTab,
                borderBottomColor:
                  mobileTab === tab ? '#6F42C1' : 'transparent',
              }}
              onClick={() => setMobileTab(tab)}
            >
              {tab}
            </button>
          ))}
          <button style={s.mobileTab} onClick={() => setShowWallet(true)}>
            {senderNfd ?? `${senderAddress.slice(0, 4)}..${senderAddress.slice(-3)}`}
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {mobileTab === 'api' && (
            <>
              {showcase}
              {sidebar}
              {apiPanel}
            </>
          )}
          {mobileTab === 'terminal' && terminal}
          {mobileTab === 'code' && (
            <div style={s.codePane}>
              <CodeBlock code={buildSnippet(endpoint, paramValues)} />
            </div>
          )}
        </div>
        {showWallet && (
          <WalletModal
            onClose={() => setShowWallet(false)}
            onDisconnect={() => setShowWallet(false)}
          />
        )}
      </div>
    )
  }

  return (
    <div style={s.layout}>
      {sidebar}
      <div style={s.main}>
        {topBar}
        {showcase}
        {apiPanel}
        {terminal}
        {footer}
      </div>
      {showWallet && (
        <WalletModal
          onClose={() => setShowWallet(false)}
          onDisconnect={() => setShowWallet(false)}
        />
      )}
      {infoDialog}
    </div>
  )
}

const darkColors = {
  bg: '#0A0A0A',
  bgAlt: '#0A0A0A',
  bgCard: '#111',
  bgSidebar: '#0D0D0D',
  text: '#E0E0E0',
  muted: '#666',
  border: '#222',
  accent: '#6F42C1',
  green: '#00D4AA',
}

const lightColors = {
  bg: '#F5F5F5',
  bgAlt: '#FAFAFA',
  bgCard: '#FFF',
  bgSidebar: '#F0F0F0',
  text: '#1A1A1A',
  muted: '#888',
  border: '#DDD',
  accent: '#6F42C1',
  green: '#00A87D',
}

const s: Record<string, React.CSSProperties> = {
  layout: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
  },
  sidebar: {
    width: 280,
    borderRight: '1px solid #222',
    display: 'flex',
    flexDirection: 'column',
    background: '#0D0D0D',
  },
  brandBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '14px 16px',
    borderBottom: '1px solid #222',
    background: '#0A0A0A',
  },
  brandLogo: {
    width: 28,
    height: 28,
    filter: 'drop-shadow(0 0 8px rgba(0, 172, 212, 0.3))',
  },
  brandTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#fff',
    lineHeight: 1.1,
  },
  brandSub: {
    fontSize: 8,
    color: '#666',
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginTop: 2,
  },
  sidebarHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 16px 12px',
    borderBottom: '1px solid #222',
  },
  walletBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid #222',
    background: '#0A0A0A',
  },
  walletBtn: {
    padding: '3px 8px',
    background: '#00D4AA22',
    border: '1px solid #00D4AA44',
    borderRadius: 4,
    color: '#00D4AA',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10,
    cursor: 'pointer',
  },
  epBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    width: '100%',
    padding: '10px 16px',
    background: 'transparent',
    border: '1px solid #222',
    borderWidth: '0 0 1px',
    color: '#ccc',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 12,
    cursor: 'pointer',
    textAlign: 'left',
  },
  sidebarBottom: {
    marginTop: 'auto',
    padding: 12,
    borderTop: '1px solid #222',
  },
  balanceSection: {
    padding: 8,
    background: '#0A0A0A',
    borderRadius: 6,
    border: '1px solid #1A1A1A',
  },
  balanceLabel: {
    fontSize: 9,
    color: '#555',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 4,
  },
  balanceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    fontSize: 12,
    lineHeight: 1.6,
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  showcase: {
    borderBottom: '1px solid #222',
    padding: 16,
    background: '#0D0D0D',
  },
  showcaseSection: {
    marginBottom: 16,
  },
  showcaseTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: '#fff',
    marginBottom: 2,
  },
  showcaseSub: {
    fontSize: 10,
    color: '#666',
    marginBottom: 8,
  },
  showcaseGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  showcaseChip: {
    padding: '5px 10px',
    background: '#111',
    border: '1px solid #222',
    borderRadius: 6,
    color: '#ccc',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10,
    cursor: 'pointer',
    textTransform: 'capitalize' as const,
  },
  productGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: 8,
  },
  productCard: {
    padding: 12,
    background: '#111',
    border: '1px solid #222',
    borderRadius: 8,
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontFamily: 'JetBrains Mono, monospace',
  },
  apiPanel: {
    borderBottom: '1px solid #222',
  },
  apiHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #1A1A1A',
  },
  params: {
    padding: 16,
  },
  input: {
    flex: 1,
    padding: '6px 10px',
    background: '#0A0A0A',
    border: '1px solid #222',
    borderRadius: 6,
    color: '#E0E0E0',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 12,
    outline: 'none',
  },
  sendBtn: {
    flex: 1,
    padding: '10px 20px',
    background: '#6F42C1',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  codeToggle: {
    padding: '10px 14px',
    background: '#1A1A1A',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#E0E0E0',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 13,
    cursor: 'pointer',
  },
  codePane: {
    background: '#0A0A0A',
    borderTop: '1px solid #222',
  },
  terminal: {
    flex: 1,
    overflow: 'auto',
    background: '#0A0A0A',
    paddingTop: 8,
    paddingBottom: 8,
  },
  mobileTabs: {
    display: 'flex',
    borderBottom: '1px solid #222',
    background: '#0D0D0D',
  },
  mobileTab: {
    flex: 1,
    padding: '10px 0',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: '#888',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    cursor: 'pointer',
  },
}
