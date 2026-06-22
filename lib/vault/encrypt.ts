// lib/vault/encrypt.ts
// AES-256-GCM encryption for vault files at rest.
// VAULT_ENCRYPTION_KEY must be a 32-char hex string (openssl rand -hex 16).
// Never called from the browser — server-side only.

import crypto from 'crypto'

const ALG = 'aes-256-gcm'

function getKey(): Buffer {
  const hex = process.env.VAULT_ENCRYPTION_KEY
  if (!hex || hex.length !== 32) {
    throw new Error('VAULT_ENCRYPTION_KEY must be a 32-char hex string')
  }
  return Buffer.from(hex, 'hex')
}

export function encryptBuffer(data: Buffer): { iv: string; tag: string; ciphertext: string } {
  const iv     = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALG, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
  return {
    iv:         iv.toString('hex'),
    tag:        cipher.getAuthTag().toString('hex'),
    ciphertext: encrypted.toString('hex'),
  }
}

export function decryptBuffer(iv: string, tag: string, ciphertext: string): Buffer {
  const decipher = crypto.createDecipheriv(ALG, getKey(), Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(tag, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ])
}
