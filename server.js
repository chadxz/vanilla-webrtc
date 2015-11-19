import express from 'express';
import http from 'http';
import serveStatic from 'serve-static';
import path from 'path';
import SocketIO from 'socket.io';
import webpack from 'webpack';
import webpackMiddleware from 'webpack-dev-middleware';
import webpackConfig from './webpack.config.babel';

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
});

server.listen(3000, () => {
  console.log('listening at http://localhost:3000');
});
