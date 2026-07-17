import * as net from 'net'

// Send raw label-command bytes to a networked printer over TCP (port 9100 by
// default — the universal raw-print port). Resolves once the bytes are flushed;
// rejects on connection error or a 5s timeout.
export function sendToPrinter(payload: string, ip: string, port = 9100): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error(`Printer at ${ip}:${port} did not respond within 5s`))
    }, 5000)

    socket.connect(port, ip, () => {
      socket.write(Buffer.from(payload, 'ascii'), (err) => {
        clearTimeout(timeout)
        socket.destroy()
        if (err) reject(err)
        else resolve()
      })
    })

    socket.on('error', (err) => {
      clearTimeout(timeout)
      socket.destroy()
      reject(err)
    })
  })
}
