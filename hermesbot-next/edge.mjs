// Puerta de entrada: Railway envía el tráfico público a $PORT y esta pieza lo pasa,
// tal cual, a la entrada "remota" del servidor (un socket local). Así el servidor
// distingue a quien entra desde internet (tiene que identificarse) de lo que ocurre
// dentro de la propia máquina.
import net from "node:net";
import fs from "node:fs";

const port = Number(process.env.PORT || 8080);
const socketPath = process.env.OMB_TUNNEL_SOCKET || "/tmp/hermesbot/http.sock";

const server = net.createServer((client) => {
  const upstream = net.connect(socketPath);
  const close = () => { client.destroy(); upstream.destroy(); };
  client.on("error", close);
  upstream.on("error", close);
  client.pipe(upstream);
  upstream.pipe(client);
});

function listen() {
  if (!fs.existsSync(socketPath)) return setTimeout(listen, 500);
  server.listen(port, "0.0.0.0", () => console.log(`[entrada] escuchando en ${port}`));
}
listen();
