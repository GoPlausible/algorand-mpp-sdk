import { useWallet } from '@txnlab/use-wallet-react'

type Props = {
  onConnected: () => void
  isDark?: boolean
}

export default function WalletConnect({ onConnected, isDark = true }: Props) {
  const { wallets, activeAccount } = useWallet()

  if (activeAccount) {
    onConnected()
    return null
  }

  return (
    <div style={s.container}>
      <div style={s.brand}>
        <img src="/algorand-logomark-blue-RGB.png" alt="Algorand" style={s.logo} />
        <div>
          <h1 style={{...s.title, color: isDark ? '#fff' : '#1A1A1A'}}>Algorand <span style={{ color: '#6F42C1' }}>MPP</span></h1>
          <p style={s.subtitle}>Machine Payments Protocol SDK</p>
        </div>
      </div>
      <div style={s.card}>
        <h2 style={s.heading}>Connect Wallet</h2>
        <p style={s.sub}>
          Connect an Algorand wallet to interact with paid API endpoints.
          This demo runs on <strong>TestNet</strong> — no real funds needed.
        </p>

        <div style={s.walletList}>
          {wallets?.map((wallet) => (
            <button
              key={wallet.id}
              style={s.walletBtn}
              onClick={async () => {
                try {
                  await wallet.connect()
                } catch (err) {
                  console.error('Wallet connect failed:', err)
                }
              }}
            >
              {wallet.metadata.icon && (
                <img src={wallet.metadata.icon} alt="" style={s.walletIcon} />
              )}
              <span>{wallet.metadata.name}</span>
            </button>
          ))}
        </div>

        <div style={s.faucetInfo}>
          <p style={{ fontSize: 11, color: '#888', lineHeight: 1.6 }}>
            Need TestNet funds?
          </p>
          <a href="https://lora.algokit.io/testnet/fund" target="_blank" rel="noopener" style={s.link}>
            ALGO Faucet
          </a>
          {' · '}
          <a href="https://faucet.circle.com/" target="_blank" rel="noopener" style={s.link}>
            USDC Faucet
          </a>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: 20,
    gap: 32,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  logo: {
    width: 56,
    height: 56,
    filter: 'drop-shadow(0 0 20px rgba(0, 172, 212, 0.3))',
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: -0.5,
    lineHeight: 1.1,
  },
  subtitle: {
    fontSize: 12,
    color: '#666',
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginTop: 4,
  },
  card: {
    background: '#111',
    border: '1px solid #222',
    borderRadius: 12,
    padding: 32,
    maxWidth: 480,
    width: '100%',
  },
  heading: {
    fontSize: 20,
    fontWeight: 700,
    color: '#fff',
    marginBottom: 8,
  },
  sub: {
    fontSize: 13,
    color: '#888',
    lineHeight: 1.5,
    marginBottom: 24,
  },
  walletList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  walletBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '14px 16px',
    background: '#1A1A1A',
    border: '1px solid #333',
    borderRadius: 10,
    color: '#E0E0E0',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'border-color 0.2s',
  },
  walletIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  faucetInfo: {
    marginTop: 20,
    padding: 12,
    background: '#0A0A0A',
    borderRadius: 8,
    border: '1px solid #1A1A1A',
    textAlign: 'center' as const,
  },
  link: {
    color: '#6F42C1',
    fontSize: 11,
    textDecoration: 'none',
  },
}
