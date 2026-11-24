import { addL2tpConnection } from './os/windows';

// CI on Windows: adds the connection twice, as the app does, with a key PowerShell would misread as code.
const script = process.argv[2];
const psk = 'k\'e"y $x; `whoami`';

void (async () => {
  for (const host of ['first.example.com', 'vpn.example.com']) {
    const res = await addL2tpConnection({ host, username: 'dana', password: 'p', psk }, script);
    if (res.code !== 0) {
      console.error(`${host}: exit ${res.code}\n${res.stdout}${res.stderr}`);
      process.exit(1);
    }
  }
  console.log('added the L2TP connection');
})();
