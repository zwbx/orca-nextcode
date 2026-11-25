import { spawn } from 'node:child_process'

// The program is constant. Request data goes through the encrypted stdin pipe.
const remote = `python3 -c 'import urllib.request as req, urllib.error as err, json, sys
class NoRedirect(req.HTTPRedirectHandler):
    def redirect_request(self, *args): return None
data = json.load(sys.stdin)
request = req.Request(data["url"], headers=data["headers"], method=data["method"], data=data["body"].encode() if data["body"] is not None else None)
opener = req.build_opener(req.ProxyHandler({}), NoRedirect())
try:
    response = opener.open(request, timeout=15)
except err.HTTPError as error:
    response = error
with response:
    print(json.dumps({"status": response.status, "body": response.read(2000001).decode("utf-8", errors="replace")}))'`

export function sshTransport(host) {
  return (url, options) => new Promise((resolve, reject) => {
    const process = spawn('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=8', '-o', 'ClearAllForwardings=yes', host, remote],
      { stdio: ['pipe', 'pipe', 'ignore'], signal: options.signal })
    const chunks = []
    let size = 0
    process.stdout.on('data', chunk => {
      size += chunk.length
      if (size > 12_100_000) { process.kill(); reject(new Error('Remote response exceeded the limit')) }
      else chunks.push(chunk)
    })
    process.on('error', reject)
    process.stdin.on('error', reject)
    process.on('close', code => {
      if (code !== 0) { reject(new Error('SSH request failed')); return }
      try {
        const { status, body } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(new Response([204, 205, 304].includes(status) ? null : body, { status }))
      } catch { reject(new Error('Invalid SSH response')) }
    })
    process.stdin.end(JSON.stringify({ url: String(url), method: options.method, headers: options.headers, body: options.body ?? null }))
  })
}
