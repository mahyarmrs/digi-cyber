// CI: asks the installed helper who it is over its socket; exits non-zero unless it answers.
import net from 'node:net';

const socketPath = process.argv[2];
const socket = net.connect(socketPath);
const timer = setTimeout(() => {
  console.error('no answer from', socketPath);
  process.exit(1);
}, 10_000);
socket.on('error', (err) => {
  console.error(err.message);
  process.exit(1);
});
socket.on('connect', () => socket.write(`${JSON.stringify({ id: 1, method: 'hello' })}\n${JSON.stringify({ id: 2, method: 'connect', params: { nonsense: true } })}\n`));
let buffered = '';
const seen = {};
socket.on('data', (chunk) => {
  buffered += chunk;
  for (let at; (at = buffered.indexOf('\n')) >= 0; buffered = buffered.slice(at + 1)) {
    const msg = JSON.parse(buffered.slice(0, at));
    console.log(JSON.stringify(msg));
    seen[msg.id] = msg;
  }
  if (seen[1] && seen[2]) {
    clearTimeout(timer);
    const ok = seen[1].ok && seen[1].value.version === 1 && seen[2].ok === false && seen[2].code === 'bad_request';
    process.exit(ok ? 0 : 1);
  }
});
