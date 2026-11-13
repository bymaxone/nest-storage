/**
 * @fileoverview A TCP proxy in front of the object store whose behavior a test switches at run
 * time: pass bytes through, accept and never answer, reset every connection, or let a response
 * start and then go silent. It lets a spec produce a slow, hung or flapping provider on demand
 * without touching the provider itself, and counts the connections the client opens.
 * @layer test/e2e
 */
import { createServer, connect, type Server, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'

export type FaultMode = 'pass' | 'blackhole' | 'reset' | 'stall-response'

export interface FaultProxy {
  /** `http://127.0.0.1:<port>` of the proxy. */
  endpoint: string
  /** Connections the client opened since the last `resetCount()`. */
  connections(): number
  /** Client connections that are open right now. */
  openConnections(): number
  resetCount(): void
  setMode(mode: FaultMode, options?: { stallAfterBytes?: number }): void
  close(): Promise<void>
}

/**
 * Starts a proxy to `target`.
 *
 * @param target - Host and port of the real store.
 * @returns The proxy handle.
 */
export async function startFaultProxy(target: { host: string; port: number }): Promise<FaultProxy> {
  let mode: FaultMode = 'pass'
  let stallAfterBytes = 0
  let count = 0
  const open = new Set<Socket>()
  const clients = new Set<Socket>()

  const server: Server = createServer((client) => {
    count += 1
    open.add(client)
    clients.add(client)
    client.on('close', () => {
      open.delete(client)
      clients.delete(client)
    })
    client.on('error', () => undefined)
    if (mode === 'reset') {
      client.resetAndDestroy()
      return
    }
    if (mode === 'blackhole') {
      return
    }
    const upstream = connect(target.port, target.host)
    open.add(upstream)
    upstream.on('close', () => open.delete(upstream))
    upstream.on('error', () => client.destroy())
    upstream.on('close', () => client.destroy())
    client.on('close', () => upstream.destroy())
    client.pipe(upstream)
    let sent = 0
    upstream.on('data', (chunk: Buffer) => {
      if (mode !== 'stall-response') {
        client.write(chunk)
        return
      }
      const room = Math.max(0, stallAfterBytes - sent)
      if (room > 0) {
        client.write(chunk.subarray(0, room))
      }
      sent += chunk.length
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  return {
    endpoint: `http://127.0.0.1:${String(port)}`,
    connections: () => count,
    openConnections: () => clients.size,
    resetCount: () => {
      count = 0
    },
    setMode: (next, options) => {
      mode = next
      if (next !== 'pass') {
        // A pooled keep-alive connection would otherwise carry on as if nothing changed.
        for (const socket of open) {
          socket.destroy()
        }
      }
      stallAfterBytes = options?.stallAfterBytes ?? 0
    },
    close: async () => {
      for (const socket of open) {
        socket.destroy()
      }
      await new Promise<void>((resolve) => server.close(() => { resolve() }))
    },
  }
}
