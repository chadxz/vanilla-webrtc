import * as webrtc from 'webrtc-adapter-test';
import Peer from './peer';

// shim webrtc
Object.keys(webrtc).forEach(key => (
  window[key] = webrtc[key]
));

const peers = window.peers = new Map();
const $peers = document.getElementById('peers');
const socket = io();

/**
 * Remove all HTML controls that are associated with a socketId
 *
 * @param {string} socketId
 */
function removeControls(socketId) {
  $peers.removeChild(document.getElementById(socketId));
}

/**
 * Create a bunch of HTML controls to display shared video
 * and toggle audio sharing to a specific connected socket.
 *
 * @param {string} peerId
 * @returns {{
 *   $localVideo: HTMLElement,
 *   $remoteVideo: HTMLElement,
 *   $toggleAudioButton: HTMLElement
 * }}
 */
function createControls(peerId) {
  const $localVideo = document.createElement('video');
  $localVideo.setAttribute('data-type', 'video');
  $localVideo.setAttribute('muted', 'true');

  const $toggleAudioButton = document.createElement('button');
  $toggleAudioButton.appendChild(document.createTextNode('Toggle audio'));

  const $remoteVideo = document.createElement('video');
  $remoteVideo.setAttribute('data-type', 'video');

  const $localControls = document.createElement('div');
  $localControls.className = 'local';
  $localControls.appendChild($localVideo);
  $localControls.appendChild($toggleAudioButton);

  const $remoteControls = document.createElement('div');
  $remoteControls.className = 'remote';
  $remoteControls.appendChild($remoteVideo);

  const $controlHeader = document.createElement('h1');
  $controlHeader.appendChild(document.createTextNode(peerId));

  const $controls = document.createElement('div');
  $controls.setAttribute('id', peerId);
  $controls.appendChild($controlHeader);
  $controls.appendChild($localControls);
  $controls.appendChild($remoteControls);

  $peers.appendChild($controls);

  return {
    $localVideo,
    $remoteVideo,
    $toggleAudioButton
  };
}

/**
 * socket.io handler for our local socket connecting to the server
 */
socket.on('connect', () => {
  console.log(`connected as ${socket.id}`);
});

/**
 * socket.io handler for a received 'signal' pubsub event.
 *
 * the 'offer' signal is handled here because an offer is an
 * unsolicited signal, so it needs to be handled outside the
 * context of a created peer so that we can create one for the
 * sender of the offer if it does not already exist.
 *
 * The signal's `from` property is set by the server, indicating
 * the originating socketId of the offer.
 */
socket.on('signal', signal => {
  const isKnownPeer = !!peers.get(signal.from);

  /* If the signal is from a known peer, that peer has its own
   * offer signal handler listening. If it is from an unknown
   * peer, the only signal type we know how to handle is an offer.
   */
  if (isKnownPeer || (signal.type !== 'offer')) {
    return;
  }

  console.log(`received an '${signal.type}' signal from socketId '${signal.from}'`);

  const peerId = signal.from;
  const controls = createControls(peerId);

  const peer = new Peer({
    socket,
    peerId,
    ...controls
  });

  peers.set(peerId, peer);
  controls.$toggleAudioButton.onclick = peer.toggleAudio;
  peer.handleOffer(signal);
});

/**
 * socket.io handler for when another socket connects to the server.
 *
 * We call them when they join, because it was the easiest way to
 * initiate the call, albeit kind of annoying for testing.
 */
socket.on('join', peerId => {
  // the server sends our own join event to ourself, so just ignore it
  if (peerId === socket.id) {
    return;
  }

  console.log(`${peerId} joined. calling.`);

  const controls = createControls(peerId);

  const peer = new Peer({
    socket,
    peerId,
    ...controls
  });

  peers.set(peerId, peer);
  controls.$toggleAudioButton.onclick = peer.toggleAudio;
  peer.sendVideo();
});

/**
 * socket.io handler for when another socket disconnects from the server.
 *
 * We cleanup any peer connections & ui associated with that socket.
 */
socket.on('leave', socketId => {
  // the server sends our own leave event to ourself, so just ignore it
  if (socketId === socket.id) {
    return;
  }

  const peer = peers.get(socketId);
  if (peer) {
    peers.delete(socketId);
    removeControls(socketId);
  }
});
