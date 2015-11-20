import express from 'express';
import http from 'http';
import serveStatic from 'serve-static';
import path from 'path';
import SocketIO from 'socket.io';
import webpack from 'webpack';
import webpackMiddleware from 'webpack-dev-middleware';
import webpackConfig from './webpack.config.babel';
import request from 'request';
import config from 'config';

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
    if (!respokeAppSecret) {
      callback([]);
      return;
    }

    request.get({
      url: `https://api.respoke.io/v1/turn?endpointId=${socket.id}`,
      json: true,
      headers: {
        'App-Secret': respokeAppSecret
      }
    }, (err, response, body) => {
      if (err) {
        console.error('Error retrieving respoke turn servers', err);
        callback([]);
        return;
      }

      if (!body.uris || !Array.isArray(body.uris)) {
        console.error('No respoke turn servers available', body);
        callback([]);
        return;
      }

      const servers = body.uris.map(uri => {
        return {
          url: uri,
          username: body.username,
          credential: body.password
        };
      });

      console.log('Sending respoke turn servers', servers);
      callback(servers);
    });
  });
});

server.listen(3000, () => {
  console.log('listening at http://localhost:3000');
});
