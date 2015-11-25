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
 *   $toggleAudioButton: HTMLElement,
 *   $toggleVideoButton: HTMLElement
 * }}
 */
function createControls(peerId) {
  const $localVideo = document.createElement('video');
  $localVideo.setAttribute('data-type', 'video');
  $localVideo.setAttribute('muted', 'true');
  $localVideo.setAttribute('controls', 'true');

  const $toggleAudioButton = document.createElement('button');
  $toggleAudioButton.appendChild(document.createTextNode('Toggle audio'));

  const $toggleVideoButton = document.createElement('button');
  $toggleVideoButton.appendChild(document.createTextNode('Toggle video'));

  const $remoteVideo = document.createElement('video');
  $remoteVideo.setAttribute('data-type', 'video');
  $remoteVideo.setAttribute('controls', 'true');

  const $localControls = document.createElement('div');
  $localControls.className = 'local';
  $localControls.appendChild($localVideo);
  $localControls.appendChild($toggleAudioButton);
  $localControls.appendChild($toggleVideoButton);

  const $remoteControls = document.createElement('div');
  $remoteControls.className = 'remote';
  $remoteControls.appendChild($remoteVideo);

  const $localControlHeader = document.createElement('input');
  $localControlHeader.setAttribute('readonly', 'readonly');
  $localControlHeader.value = socket.id;

  const $remoteControlHeader = document.createElement('input');
  $remoteControlHeader.setAttribute('readonly', 'readonly');
  $remoteControlHeader.value = peerId;

  const $controls = document.createElement('div');
  $controls.setAttribute('id', peerId);
  $controls.className = 'peer';
  $controls.appendChild($localControls);
  $controls.appendChild($remoteControls);

  $localControls.appendChild($localControlHeader);
  $remoteControls.appendChild($remoteControlHeader);
  $peers.appendChild($controls);

  return {
    $localVideo,
    $remoteVideo,
    $toggleAudioButton,
    $toggleVideoButton
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
  controls.$toggleVideoButton.onclick = peer.toggleVideo;
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
  controls.$toggleVideoButton.onclick = peer.toggleVideo;
  peer.share();
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
    peer.end();
    peers.delete(socketId);
    removeControls(socketId);
  }
});
