/* global io: false */
import * as webrtc from 'webrtc-adapter-test';
import Peer from './peer';

// shim webrtc
Object.keys(webrtc).forEach(key => (
  window[key] = webrtc[key]
));

// allow webrtc shim to print to console
webrtcUtils.log = console.log.bind(console);

const peers = new Map();
const $peers = document.getElementById('peers');
const socket = window.socket = io();

function removeControls(socketId) {
  $peers.removeChild(document.getElementById(socketId));
}

function createControls(socketId) {
  const $localVideo = document.createElement('video');
  $localVideo.setAttribute('data-type', 'video');
  $localVideo.setAttribute('muted', 'true');
  const $localScreenShare = document.createElement('video');
  $localScreenShare.setAttribute('data-type', 'screenShare');

  const $remoteVideo = document.createElement('video');
  $remoteVideo.setAttribute('data-type', 'video');
  const $remoteScreenShare = document.createElement('video');
  $remoteScreenShare.setAttribute('data-type', 'screenShare');

  const $localControls = document.createElement('div');
  $localControls.className = 'local';
  $localControls.appendChild($localVideo);
  $localControls.appendChild($localScreenShare);

  const $remoteControls = document.createElement('div');
  $remoteControls.className = 'remote';
  $remoteControls.appendChild($remoteVideo);
  $remoteControls.appendChild($remoteScreenShare);

  const $controlHeader = document.createElement('h1');
  $controlHeader.appendChild(document.createTextNode(socketId));

  const $controls = document.createElement('div');
  $controls.setAttribute('id', socketId);
  $controls.appendChild($controlHeader);
  $controls.appendChild($localControls);
  $controls.appendChild($remoteControls);

  $peers.appendChild($controls);

  return {
    $localVideo,
    $localScreenShare,
    $remoteVideo,
    $remoteScreenShare
  };
}

socket.on('connect', () => {
  console.log(`connected as ${socket.id}`);
});

socket.on('signal', signal => {
  const isKnownPeer = !!peers.get(signal.from);
  const isMyself = signal.to !== socket.id;

  if (isKnownPeer || isMyself || (signal.type !== 'offer')) {
    return;
  }

  console.log(`received '${signal.type}' signal from ${signal.from} destined for ${signal.to}`);
  const controls = createControls(signal.from);

  const peer = new Peer({ socket, socketId: signal.from, ...controls });
  peers.set(signal.from, peer);
  peer.handleOffer(signal);
});

socket.on('join', socketId => {

  if (socketId === socket.id) {
    return;
  }

  console.log(`${socketId} joined. calling.`);
  const controls = createControls(socketId);

  const peer = new Peer({ socket, socketId, ...controls });
  peers.set(socketId, peer);
  peer.startVideoCall();
});

socket.on('leave', socketId => {
  if (socketId === socket.id) {
    return;
  }

  var peer = peers.get(socketId);
  if (peer) {
    peers.delete(socketId);
    removeControls(socketId);
  }
});