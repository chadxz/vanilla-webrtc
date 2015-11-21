
export function retrieveTurnServers(socket) {
  return new Promise((resolve) => {
    socket.emit('need-turn-servers', (turnServers) => {
      resolve(turnServers);
    });
  });
}
