import express from 'express';
import http from 'http';
import serveStatic from 'serve-static';
import path from 'path';
import SocketIO from 'socket.io';
import webpack from 'webpack';
import webpackMiddleware from 'webpack-dev-middleware';
import webpackConfig from './webpack.config.babel';
import axios from 'axios';
import config from 'config';

const googleStunServers = {
  urls: [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
    'stun:stun3.l.google.com:19302',
    'stun:stun4.l.google.com:19302'
  ]
};

const respokeAppSecret = config.has('respoke.appSecret') ?
  config.get('respoke.appSecret') : null;

if (!respokeAppSecret) {
  console.error('No respoke appSecret configured. TURN will not be available.');
}

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server);

app.use(webpackMiddleware(webpack(webpackConfig)));
app.use(serveStatic(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log(`${socket.id} connected`);
  io.emit('join', socket.id);

  socket.on('disconnect', () => {
    console.log(`${socket.id} disconnected`);
    io.emit('leave', socket.id);
  });

  socket.on('signal', (signal) => {
    console.log(`${socket.id} sending ${signal.type} signal to ${signal.to}`);
    signal.from = socket.id;
    io.to(signal.to).emit('signal', signal);
  });

  socket.on('need-turn-servers', (callback) => {
    Promise.resolve().then(() => {
      if (!respokeAppSecret) {
        return [];
      }

      return axios.get(`https://api.respoke.io/v1/turn?endpointId=${socket.id}`, {
        headers: { 'App-Secret': respokeAppSecret }
      }).then((response) => {
        if (!response.data.uris || !Array.isArray(response.data.uris)) {
          console.error('No respoke turn servers available', response.data);
          return [];
        }

        return {
          urls: response.data.uris,
          username: response.data.username,
          credential: response.data.password
        };
      });
    }).then((respokeServers) => {
      const servers = [ googleStunServers, respokeServers ];
      console.log('Sending STUN/TURN servers', servers);
      callback(servers);
    }).catch((err) => {
      console.error('Error retrieving respoke turn servers', err);
      callback([]);
    });
  });
});

server.listen(3000, () => {
  console.log('listening at http://localhost:3000');
});
