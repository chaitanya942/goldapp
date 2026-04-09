import tls from 'tls'
import net from 'net'

export async function GET() {
  return new Promise((resolve) => {
    const host = process.env.NEW_CRM_DB_HOSTNAME || process.env.NEW_CRM_DB_HOST
    const port = parseInt(process.env.NEW_CRM_DB_PORT || '5432')

    // Connect TCP, send PostgreSQL SSLRequest, then grab the cert
    const socket = net.createConnection({ host, port }, () => {
      // Send PostgreSQL SSLRequest packet (8 bytes)
      const sslRequest = Buffer.alloc(8)
      sslRequest.writeInt32BE(8, 0)       // length
      sslRequest.writeInt32BE(80877103, 4) // SSLRequest magic
      socket.write(sslRequest)
    })

    socket.once('data', (data) => {
      if (data[0] !== 83) { // 'S' = server accepts SSL
        resolve(Response.json({ error: 'Server rejected SSL', byte: data[0] }))
        socket.destroy()
        return
      }

      // Upgrade to TLS
      const tlsSocket = tls.connect({
        socket,
        host,
        rejectUnauthorized: false,
        servername: host,
      }, () => {
        const cert = tlsSocket.getPeerCertificate(false)
        const chain = tlsSocket.getPeerCertificate(true)

        let pem = null
        if (cert && cert.raw) {
          pem = `-----BEGIN CERTIFICATE-----\n${cert.raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`
        }

        resolve(Response.json({
          authorized: tlsSocket.authorized,
          authError: tlsSocket.authorizationError,
          subject: cert?.subject,
          issuer: cert?.issuer,
          validTo: cert?.valid_to,
          pemLength: pem?.length,
          pem,
        }))
        tlsSocket.destroy()
      })

      tlsSocket.on('error', (e) => {
        resolve(Response.json({ error: e.message }))
      })
    })

    socket.on('error', (e) => {
      resolve(Response.json({ error: e.message }))
    })
  })
}
