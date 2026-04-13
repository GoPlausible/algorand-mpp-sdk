export type Kind = 'req' | '402' | 'ok' | 'error' | 'info' | 'dim'

export type LogLine = {
  id: number
  text: string
  kind: Kind
}

export type Endpoint = {
  method: 'GET' | 'POST'
  path: string
  description: string
  cost: string
  params?: { name: string; default: string }[]
  body?: Record<string, string>
}

export type MobileTab = 'api' | 'terminal' | 'code'
