/* global webrtcDetectedBrowser: false */
import { retrieveTurnServers } from './turn';

function errorHandler(processName) {
  return console.error.bind(console, `${processName} failed`);
}

/**
 *
 * Create a peer, which manages the WebRTC call flow between two
 * browsers connected to the server via websocket.
 *
 * @param {object} opts
 * @param {object} opts.socket The socket.io socket, used for signaling
 * @param {string} opts.peerId The remote browser's socket.io socketId we want to connect to
 * @param {object} [opts.turnServers] The TURN servers to use when creating the peer connection
 * @param {HTMLElement} opts.$localVideo,
 * @param {HTMLElement} opts.$localScreenShare,
 * @param {HTMLElement} opts.$remoteVideo,
 * @param {HTMLElement} opts.$remoteScreenShare
 * @returns {{
 *   peerId: string,
 *   share: function,
 *   toggleAudio: function,
 *   toggleVideo: function,
 *   handleOffer: function,
 *   end: function,
 *   pc: object
 * }}
 */
export default function Peer(opts) {
  const {
    peerId,
    socket,
    $localVideo,
    $remoteVideo
    } = opts;

  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const queuedIceCandidates = [];
  const turnServerPromise = retrieveTurnServers(socket);

  let pc = null;
  let isConnected = false;
  let didSetRemoteDescription = false;

  function removeLocalTracks() {
    if (webrtcDetectedBrowser === 'firefox') {
      pc.getSenders().forEach(sender => {
        pc.removeTrack(sender);
      });
    } else if (webrtcDetectedBrowser === 'chrome') {
      pc.getLocalStreams().forEach(stream => {
        stream.getTracks().forEach(track => track.stop());
        pc.removeStream(stream);
      });
    }
  }

  function addLocalTracksFromStream(stream) {
    if (webrtcDetectedBrowser === 'firefox') {
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });
    } else if (webrtcDetectedBrowser === 'chrome') {
      pc.addStream(stream);
    }
  }

  function ensurePeerConnection() {
    if (pc) {
      return Promise.resolve();
    }

    return turnServerPromise.then(turnServers => {
      console.log('Creating peer with options', {iceServers: turnServers});
      pc = new RTCPeerConnection({iceServers: turnServers});

      /**
       * Event handler for an ice candidate being generated by the
       * WebRTC peer connection. This ice candidate should be transmitted
       * to the remote peer if the peer connection is in the process
       * of initially connecting, and suppressed if the remote peer
       * connection is already connected.
       *
       * @param {object} obj
       * @param {object} obj.candidate The ice candidate
       * @api private
       */
      pc.onicecandidate = (obj) => {
        if (!obj.candidate) {
          // end of ice signal
          return;
        }

        if (isConnected) {
          return;
        }

        console.log('onicecandidate', obj.candidate);
        socket.emit('signal', {
          type: 'icecandidate',
          to: peerId,
          icecandidate: obj.candidate
        });
      };

      /**
       * Event handler fired when the iceConnectionState of the
       * peer connection changes. This event is useful for indicating
       * when the connection has been successfully established, among
       * other things.
       *
       * @api private
       */
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'connected') {
          isConnected = true;
          console.log('connected.');
        }
      };

      /**
       * Event handler fired when the peer connection has successfully
       * received a remote stream, and is making it available to us.
       * This is our opportunity to display the stream if it is a video
       * stream. An audio stream will for some reason just magically
       * start playing without us needing to attach it to an HTML5 audio element.
       *
       * @param {object} obj
       * @param {object} obj.stream the new stream
       */
      pc.onaddstream = obj => {
        const stream = obj.stream;

        console.log([
          `onaddstream. remote stream has ${stream.getVideoTracks().length} video tracks`,
          `and ${stream.getAudioTracks().length} audio tracks`
        ].join(' '));

        $remoteVideo.srcObject = stream;
        $remoteVideo.play();
      };
    });
  }

  function shareMedia(constraints) {
    ensurePeerConnection().then(() => {
      if (!constraints.audio && !constraints.video) {
        return;
      }

      return getUserMedia(constraints);
    }).then(stream => {
      removeLocalTracks();
      if (stream) {
        addLocalTracksFromStream(stream);
        $localVideo.srcObject = stream;
        $localVideo.play();
      }

      console.log([
        `creating new offer with ${(stream && stream.getVideoTracks().length) || 0} video tracks`,
        `and ${(stream && stream.getAudioTracks().length) || 0} audio tracks`
      ].join(' '));

      return pc.createOffer();
    }).then(offer => {
      return pc.setLocalDescription(offer).then(() => {
        socket.emit('signal', {
          type: 'offer',
          to: peerId,
          offer
        });
        console.log('sent offer', offer);
      });
    }).catch(errorHandler('shareMedia'));
  }

  /**
   * Called after seeing setRemoteDescription, this function
   * adds any queued iceCandidates to the peer connection. It
   * is important to wait until setRemoteDescription to allow
   * iceCandidates to be added to the peer connection, because
   * it is only then that the peer connection is in a state that
   * is ready to process them.
   * @api private
   */
  function processQueuedCandidates() {
    if (!queuedIceCandidates.length) {
      return;
    }

    console.log(`adding ${queuedIceCandidates.length} queued candidates to the peer connection`);

    let processedCandidatesCount = 0;
    while (queuedIceCandidates.length) {
      pc.addIceCandidate(queuedIceCandidates.shift());
      processedCandidatesCount++;
    }

    console.log(`added ${processedCandidatesCount} queued ice candidates to the peer connection`);
  }

  /**
   * Event handler for a received 'icecandidate' signal. Will
   * add the ice candidate to the peer connection if it is
   * ready for it, otherwise queue the candidate until after
   * setRemoteDescription is called.
   *
   * @param {object} signal
   * @api private
   */
  function handleIceCandidate(signal) {
    const { icecandidate } = signal;
    console.log('received ice candidate', icecandidate);
    if (didSetRemoteDescription) {
      pc.addIceCandidate(new RTCIceCandidate(icecandidate));
    } else {
      queuedIceCandidates.push(new RTCIceCandidate(icecandidate));
    }
  }

  /**
   * Event handler for a received 'offer' signal. If this is the
   * first offer for this peer connection, getUserMedia will be
   * called to obtain media to send to the caller. If it is a
   * renegotiation offer, we will simply accept the changes from
   * the remote without changing our local media.
   *
   * In all cases, we will send an answer indicating that we accept
   * the offer.
   *
   * @param {object} signal
   * @api private
   */
  function handleOffer(signal) {
    const { offer } = signal;
    console.log('received offer', offer);

    ensurePeerConnection().then(() => {
      return pc.setRemoteDescription(new RTCSessionDescription(offer));
    }).then(() => {
      didSetRemoteDescription = true;
      processQueuedCandidates();

      if (isConnected) {
        return;
      }

      return getUserMedia({
        audio: true,
        video: true
      }).then(stream => {
        addLocalTracksFromStream(stream);
        $localVideo.srcObject = stream;
        $localVideo.play();
      });
    }).then(() => {
      return pc.createAnswer();
    }).then(answer => {
      console.log('created answer', answer);
      return pc.setLocalDescription(answer).then(() => {
        socket.emit('signal', {
          type: 'answer',
          to: peerId,
          answer
        });
        console.log('sent answer', answer);
      });
    }).catch(errorHandler('handleOffer'));
  }

  /**
   * Event handler for a received 'answer' signal. This
   * completes the WebRTC signaling exchange, and will move
   * the call into a connected state if the ICE process completes
   * successfully. The ICE process could fail though if no suitable
   * candidate can be found, which can happen easily due to firewalls
   * and other unsuitable network conditions. TURN servers can help
   * with this, but this application does not utilize a TURN server.
   *
   * @param {object} signal
   * @api private
   */
  function handleAnswer(signal) {
    const { answer } = signal;
    console.log('setting answer', answer);
    pc.setRemoteDescription(new RTCSessionDescription(answer)).then(() => {
      didSetRemoteDescription = true;
      processQueuedCandidates();
      console.log('set answer', answer);
    }).catch(errorHandler('handleAnswer'));
  }

  /**
   * socket.io handler for a received 'signal' pubsub event.
   *
   * The signal's `from` property is set by the server, indicating
   * the originating socketId of the offer.
   *
   * @api private
   */
  function handleSignal(signal) {
    console.log(`received an '${signal.type}' signal from socketId '${signal.from}'`);

    switch (signal.type) {
    case 'icecandidate':
      handleIceCandidate(signal);
      break;
    case 'offer':
      handleOffer(signal);
      break;
    case 'answer':
      handleAnswer(signal);
      break;
    default:
      console.log('I have no idea what to do with this signal', signal);
    }
  }

  function alreadySendingAudio() {
    return !!(pc && pc.getLocalStreams().length && pc.getLocalStreams()[0].getAudioTracks().length);
  }

  function alreadySendingVideo() {
    return !!(pc && pc.getLocalStreams().length && pc.getLocalStreams()[0].getVideoTracks().length);
  }

  function share() {
    shareMedia({ audio: true, video: true });
  }

  function toggleAudio() {
    console.log(`audio is ${alreadySendingAudio() ? 'on' : 'off'}, toggling.`);
    shareMedia({ audio: !alreadySendingAudio(), video: alreadySendingVideo() });
  }

  function toggleVideo() {
    console.log(`video is ${alreadySendingVideo() ? 'on' : 'off'}, toggling.`);
    shareMedia({ audio: alreadySendingAudio(), video: !alreadySendingVideo() });
  }

  /**
   * Close a peer connection, and remove associated socket.io event listeners
   *
   * @api public
   */
  function end() {
    if (pc) {
      removeLocalTracks();
    }

    socket.removeListener('signal', handleSignal);
  }

  /**
   * Register an event listener for any signals coming over the socket
   */
  socket.on('signal', handleSignal);

  return {
    peerId,
    share,
    handleOffer,
    end,
    toggleAudio,
    toggleVideo,
    get pc() {
      return pc;
    }
  };
}
