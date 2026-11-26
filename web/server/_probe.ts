import { GatewayClient } from './vendor/hermes-shared/node/gateway-client.ts'
const TOKEN='test-token-0123456789abcdefghij'
const gw = new GatewayClient({
  connect: async () => ({ url: 'ws://127.0.0.1:18080/gateway', protocols: ['hermes-gateway-v1', 'hermesbot-token.'+TOKEN], profile_id: 'default', instance_id: 'bridge' }),
  client: { name: 'hermesbot-web', version: '0.1.0' },
  onLifecycle: l => console.log('LIFE', l)
})
gw.on('event', (ev: any) => console.log('EV', JSON.stringify(ev).slice(0, 400)))
gw.on('request', (req: any) => { console.log('REQ', req.method, JSON.stringify(req.params).slice(0,500)); setTimeout(()=>{ try { req.respond(req.method==='approval'?{choice:'once'}:{}) } catch(e){ console.log('respond err', e) } }, 500) })
gw.on('exit', (c: any) => console.log('EXIT', c))
gw.start(); gw.drain()
const text = process.argv[2] || 'hola'
try {
  const caps = await gw.request('client.capabilities', { server_requests: true }); console.log('CAPS', JSON.stringify(caps).slice(0,300))
  const s: any = await gw.request('session.create', { title: 'hermesbot probe' }); console.log('SESSION', JSON.stringify(s).slice(0, 600))
  const r = await gw.request('prompt.submit', { session_id: s.session_id, text }); console.log('SUBMIT', JSON.stringify(r).slice(0,300))
} catch (e) { console.log('ERR', e) }
setTimeout(() => { console.log(gw.getLogTail(30)); process.exit(0) }, 15000)
