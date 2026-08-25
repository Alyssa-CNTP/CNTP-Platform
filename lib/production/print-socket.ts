import * as net from 'net'

// Send raw label-command bytes to a networked printer over TCP (port 9100 by
// default — the universal raw-print port). Resolves once the bytes are flushed;
// rejects on connection error or a 5s timeout.
export function sendToPrinter(payload: string, ip: string, port = 9100): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(new Error(`Printer at ${ip}:${port} did not respond within 5s`))
    }, 5000)

    socket.connect(port, ip, () => {
      socket.write(Buffer.from(payload, 'ascii'), (err) => {
        if (err) {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          socket.destroy()
          reject(err)
          return
        }
        // write()'s callback only means the OS accepted the bytes into its
        // own send buffer -- not that the printer has actually received and
        // processed them. The previous code called socket.destroy() right
        // here, an abrupt close (can send a TCP RST) that under any network
        // jitter can cut the stream off mid-transmission -- this is what
        // printed labels with random content missing partway through.
        // socket.end() half-closes gracefully (sends FIN once everything
        // queued is actually sent), and resolving on 'close' below waits for
        // that to genuinely finish instead of assuming it already has.
        socket.end()
      })
    })

    socket.on('close', () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve()
    })

    socket.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      socket.destroy()
      reject(err)
    })
  })
}
