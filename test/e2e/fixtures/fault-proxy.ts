/**
 * @fileoverview A TCP proxy in front of the object store whose behavior a test switches at run
 * time: pass bytes through, accept and never answer, reset every connection, or let a response
 * start and then go silent. It lets a spec produce a slow, hung or flapping provider on demand
 * without touching the provider itself, and counts the connections the client opens.
 * @layer test/e2e
 */
import { createServer, connect, type Server, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'

/**
 * How the proxy treats each new connection: `pass` forwards bytes both ways, `blackhole` accepts and
 * never answers, `reset` resets the connection at once, and `stall-response` forwards the request
 * and only a prefix of the response, then goes silent.
 */
export type FaultMode = 'pass' | 'blackhole' | 'reset' | 'stall-response'

/** A running fault proxy: where to point the client, what it saw, and how to change its behavior. */
export interface FaultProxy {
  /** `http://127.0.0.1:<port>` of the proxy. */
  endpoint: string
  /** Connections the client opened since the last `resetCount()`. */
  connections(): number
  /** Client connections that are open right now. */
  openConnections(): number
  /** Sets the connection count back to zero. */
  resetCount(): void
  /**
   * Switches the behavior of connections opened from now on and drops the ones already open, so a
   * pooled keep-alive connection cannot carry on as if nothing changed.
   *
   * @param mode - The new behavior.
   * @param options - `stallAfterBytes`: how much of a response `stall-response` forwards.
   */
  setMode(mode: FaultMode, options?: { stallAfterBytes?: number }): void
  /** Destroys every open connection and stops listening. */
  close(): Promise<void>
}

/** What every connection handler shares. */
interface ProxyState {
  target: { host: string; port: number }
  mode: FaultMode
  stallAfterBytes: number
  count: number
  /** Every socket the proxy holds, client and upstream. */
  open: Set<Socket>
  /** The client side only. */
  clients: Set<Socket>
}

/** Tracks a client socket and applies the current fault mode to it. */
function handleConnection(client: Socket, state: ProxyState): void {
  state.count += 1
  state.open.add(client)
  state.clients.add(client)
  client.on('close', () => {
    state.open.delete(client)
    state.clients.delete(client)
  })
  client.on('error', () => undefined)
  if (state.mode === 'reset') {
    client.resetAndDestroy()
  } else if (state.mode !== 'blackhole') {
    relay(client, state)
  }
}

/** Connects the client to the store, forwarding the response whole or only a prefix of it. */
function relay(client: Socket, state: ProxyState): void {
  const upstream = connect(state.target.port, state.target.host)
  state.open.add(upstream)
  upstream.on('close', () => {
    state.open.delete(upstream)
    client.destroy()
  })
  upstream.on('error', () => client.destroy())
  client.on('close', () => upstream.destroy())
  client.pipe(upstream)
  let sent = 0
  upstream.on('data', (chunk: Buffer) => {
    if (state.mode !== 'stall-response') {
      client.write(chunk)
      return
    }
    const room = Math.max(0, state.stallAfterBytes - sent)
    if (room > 0) {
      client.write(chunk.subarray(0, room))
    }
    sent += chunk.length
  })
}

/**
 * Starts a proxy to `target`.
 *
 * @param target - Host and port of the real store.
 * @returns The proxy handle.
 */
export async function startFaultProxy(target: { host: string; port: number }): Promise<FaultProxy> {
  const state: ProxyState = {
    target,
    mode: 'pass',
    stallAfterBytes: 0,
    count: 0,
    open: new Set(),
    clients: new Set(),
  }
  const destroyAll = (): void => {
    for (const socket of state.open) {
      socket.destroy()
    }
  }
  const server: Server = createServer((client) => {
    handleConnection(client, state)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  return {
    endpoint: `http://127.0.0.1:${String(port)}`,
    connections: () => state.count,
    openConnections: () => state.clients.size,
    resetCount: () => {
      state.count = 0
    },
    setMode: (next, options) => {
      state.mode = next
      state.stallAfterBytes = options?.stallAfterBytes ?? 0
      if (next !== 'pass') {
        destroyAll()
      }
    },
    close: async () => {
      destroyAll()
      await new Promise<void>((resolve) => server.close(() => { resolve() }))
    },
  }
}
