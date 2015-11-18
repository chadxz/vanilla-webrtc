import express from 'express';
import http from 'http';
import serveStatic from 'serve-static';
import path from 'path';
import SocketIO from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server);

app.use(serveStatic(path.join(__dirname, 'public')));

io.on('connection', (/* socket */) => {
  console.log('a user connected');
});

server.listen(3000, () => {
  console.log('listening at http://localhost:3000');
});
