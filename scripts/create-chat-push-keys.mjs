import { createECDH, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const origin = process.argv[2]
if (!origin || new URL(origin).protocol !== 'https:') {
  throw new Error('Podaj adres aplikacji, np. node scripts/create-chat-push-keys.mjs https://margoprod.vercel.app')
}
const ecdh = createECDH('prime256v1')
ecdh.generateKeys()
const publicKey = ecdh.getPublicKey().toString('base64url')
// Never print secrets. Refuse to replace keys already used by subscriptions.
writeFileSync('.env.chat-push', [
  `WEB_PUSH_PUBLIC_KEY=${publicKey}`,
  `WEB_PUSH_PRIVATE_KEY=${ecdh.getPrivateKey().toString('base64url')}`,
  `WEB_PUSH_SUBJECT=${new URL(origin).origin}`,
  `CHAT_PUSH_SECRET=${randomBytes(32).toString('hex')}`,
  '',
].join('\n'), { flag: 'wx', mode: 0o600 })
console.log('Klucze zapisano w lokalnym pliku .env.chat-push. Nie publikuj tego pliku.')
console.log(`Publiczna zmienna środowiska dla Vercel: VITE_WEB_PUSH_PUBLIC_KEY=${publicKey}`)
