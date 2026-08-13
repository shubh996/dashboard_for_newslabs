import WebSocket from 'ws'

const YAHOO_STREAM_URL = 'wss://streamer.finance.yahoo.com/?version=2'
const quotes = new Map()
const subscriptions = new Set()
const quoteListeners = new Set()

let socket = null
let reconnectTimer = null

function readVarint(buffer, cursor) {
  let value = 0n
  let shift = 0n
  while (cursor.offset < buffer.length) {
    const byte = BigInt(buffer[cursor.offset++])
    value |= (byte & 0x7fn) << shift
    if ((byte & 0x80n) === 0n) return value
    shift += 7n
  }
  throw new Error('Invalid Yahoo pricing protobuf')
}

function decodeZigZag(value) {
  return (value >> 1n) ^ -(value & 1n)
}

function readLengthDelimited(buffer, cursor) {
  const length = Number(readVarint(buffer, cursor))
  const start = cursor.offset
  cursor.offset += length
  if (cursor.offset > buffer.length) throw new Error('Invalid Yahoo pricing payload length')
  return buffer.subarray(start, cursor.offset)
}

function skipField(buffer, cursor, wireType) {
  if (wireType === 0) {
    readVarint(buffer, cursor)
    return
  }
  if (wireType === 1) {
    cursor.offset += 8
    return
  }
  if (wireType === 2) {
    readLengthDelimited(buffer, cursor)
    return
  }
  if (wireType === 5) {
    cursor.offset += 4
    return
  }
  throw new Error(`Unsupported Yahoo pricing protobuf wire type: ${wireType}`)
}

/** Decode the fields used by Yahoo's public pricing WebSocket. */
export function decodeYahooPricingMessage(base64Message) {
  const buffer = Buffer.from(base64Message, 'base64')
  const cursor = { offset: 0 }
  const quote = {}

  while (cursor.offset < buffer.length) {
    const tag = Number(readVarint(buffer, cursor))
    const field = tag >> 3
    const wireType = tag & 7

    if (field === 1 && wireType === 2) {
      quote.symbol = readLengthDelimited(buffer, cursor).toString('utf8').toUpperCase()
    } else if (field === 2 && wireType === 5) {
      quote.price = buffer.readFloatLE(cursor.offset)
      cursor.offset += 4
    } else if (field === 3 && wireType === 0) {
      quote.time = Number(decodeZigZag(readVarint(buffer, cursor)))
    } else if (field === 4 && wireType === 2) {
      quote.currency = readLengthDelimited(buffer, cursor).toString('utf8')
    } else if (field === 5 && wireType === 2) {
      quote.exchange = readLengthDelimited(buffer, cursor).toString('utf8')
    } else if (field === 7 && wireType === 0) {
      quote.marketHours = Number(readVarint(buffer, cursor))
    } else if (field === 8 && wireType === 5) {
      quote.changePercent = buffer.readFloatLE(cursor.offset)
      cursor.offset += 4
    } else if (field === 12 && wireType === 5) {
      quote.change = buffer.readFloatLE(cursor.offset)
      cursor.offset += 4
    } else if (field === 13 && wireType === 2) {
      quote.shortName = readLengthDelimited(buffer, cursor).toString('utf8')
    } else {
      skipField(buffer, cursor, wireType)
    }
  }

  if (!quote.symbol || !Number.isFinite(quote.price)) return null
  return quote
}

function sendSubscriptions(symbols) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !symbols.length) return
  socket.send(JSON.stringify({ subscribe: symbols }))
}

function scheduleReconnect() {
  if (reconnectTimer || !subscriptions.size) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 1_000)
  reconnectTimer.unref?.()
}

function connect() {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return
  }

  socket = new WebSocket(YAHOO_STREAM_URL)
  socket.on('open', () => sendSubscriptions([...subscriptions]))
  socket.on('message', (raw) => {
    try {
      const envelope = JSON.parse(raw.toString())
      if (envelope?.type !== 'pricing' || !envelope.message) return
      const quote = decodeYahooPricingMessage(envelope.message)
      if (!quote) return
      quotes.set(quote.symbol, {
        ...quote,
        receivedAt: new Date().toISOString(),
      })
      quoteListeners.forEach((listener) => listener())
    } catch {
      // Ignore malformed frames; the next Yahoo pricing frame will replace it.
    }
  })
  socket.on('error', () => {
    // close also fires and schedules a reconnect.
  })
  socket.on('close', () => {
    socket = null
    scheduleReconnect()
  })
}

/**
 * Subscribe once and return the most recent Yahoo streamer values.
 * The short first-call wait lets the initial WebSocket snapshot arrive; later
 * dashboard polls return immediately from the continuously updated cache.
 */
export async function getYahooLiveQuotes(symbols, initialWaitMs = 3_500) {
  const clean = [...new Set(
    symbols.map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean),
  )]
  if (!clean.length) return {}

  const added = clean.filter((symbol) => !subscriptions.has(symbol))
  added.forEach((symbol) => subscriptions.add(symbol))
  connect()
  sendSubscriptions(added)

  if (clean.some((symbol) => !quotes.has(symbol)) && initialWaitMs > 0) {
    await new Promise((resolve) => {
      let timer = null
      const finish = () => {
        if (timer) clearTimeout(timer)
        quoteListeners.delete(check)
        resolve()
      }
      const check = () => {
        if (clean.every((symbol) => quotes.has(symbol))) finish()
      }
      quoteListeners.add(check)
      timer = setTimeout(finish, initialWaitMs)
      check()
    })
  }

  return Object.fromEntries(
    clean.flatMap((symbol) => {
      const quote = quotes.get(symbol)
      return quote ? [[symbol, quote]] : []
    }),
  )
}
