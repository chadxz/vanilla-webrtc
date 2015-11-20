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
 * @param {HTMLElement} opts.$localVideo,
 * @param {HTMLElement} opts.$localScreenShare,
 * @param {HTMLElement} opts.$remoteVideo,
 * @param {HTMLElement} opts.$remoteScreenShare
 * @returns {{
 *   peerId: string,
 *   sendVideo: function,
 *   toggleAudio: function,
 *   handleOffer: function,
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

  const pc = new RTCPeerConnection();
  const queuedIceCandidates = [];

  let didSetRemoteDescription = false;
  let videoOnlyStream = null;
  let videoWithAudioStream = null;
  let isConnected = false;

  /**
   * Called after seeing setRemoteDescription, this function
   * adds any queued iceCandidates to the peer connection. It
   * is important to wait until setRemoteDescription to allow
   * iceCandidates to be added to the peer connection, because
   * it is only then that the peer connection is in a state that
   * is ready to process them.
   * @api private
   */
  function drainQueuedCandidates() {
    didSetRemoteDescription = true;
    while (queuedIceCandidates.length > 0) {
      pc.addIceCandidate(queuedIceCandidates.shift());
    }
    console.log('processed all queued ice candidates');
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

    pc.setRemoteDescription(new RTCSessionDescription(offer)).then(() => {
      drainQueuedCandidates();

      new Promise((resolve, reject) => {
        if (isConnected) {
          return resolve();
        }

        getUserMedia({
          audio: false,
          video: true
        }, resolve, reject);
      }).then((stream) => {
        if (stream) {
          videoOnlyStream = stream;
          $localVideo.srcObject = stream;
          pc.addStream(stream);
          $localVideo.play();
        }

        pc.createAnswer().then(answer => {
          console.log('calling setLocalDescription after createAnswer');
          pc.setLocalDescription(answer).then(() => {
            socket.emit('signal', {
              type: 'answer',
              to: peerId,
              answer
            });
            console.log('sent answer', answer);
          }, errorHandler('setLocalDescription'));
        });
      }).catch(errorHandler('handleOffer promise'));
    });
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
    pc.setRemoteDescription(new RTCSessionDescription(answer)).then(() => {
      drainQueuedCandidates();
      console.log('set answer', answer);
    });
  }

  /**
   * Handler responsible for transmitting a successfully generated
   * offer to the remote peer.
   *
   * @param {object} offer
   * @api private
   */
  function onCreateOfferSuccess(offer) {
    pc.setLocalDescription(offer).then(() => {
      socket.emit('signal', {
        type: 'offer',
        to: peerId,
        offer
      });
      console.log('sent offer', offer);
    }, errorHandler('setLocalDescription'));
  }

  /**
   * Starts a new WebRTC video-only media session with the
   * remote socketId specified when constructing this Peer.
   * If called and the peer connection is already established,
   * this method will renegotiate from an audio/video session
   * back to a video-only session.
   *
   * @api public
   */
  function sendVideo() {
    getUserMedia({
      audio: false,
      video: true
    }, stream => {
      if (isConnected) {
        pc.removeStream(videoWithAudioStream);
        videoWithAudioStream.getTracks().forEach(track => track.stop());
        videoWithAudioStream = null;
      }

      videoOnlyStream = stream;
      $localVideo.srcObject = stream;
      $localVideo.play();
      pc.addStream(stream);
      pc.createOffer(onCreateOfferSuccess, errorHandler('createOffer'));
    }, errorHandler('getUserMedia'));
  }

  /**
   * Starts a new WebRTC audio/video media session with the
   * remote socketId specified when constructing this Peer.
   * If called and the peer connection is already established,
   * this method will renegotiate from an video-only session
   * to an audio/video session.
   *
   * @api public
   */
  function sendVideoAndAudio() {
    getUserMedia({
      audio: true,
      video: true
    }, stream => {
      if (isConnected) {
        pc.removeStream(videoOnlyStream);
        videoOnlyStream.getTracks().forEach(track => track.stop());
        videoOnlyStream = null;
      }

      videoWithAudioStream = stream;
      $localVideo.srcObject = stream;
      $localVideo.play();
      pc.addStream(videoWithAudioStream);
      pc.createOffer(onCreateOfferSuccess, errorHandler('renegotiation createOffer'));
    }, errorHandler('getUserMedia'));
  }

  /**
   * Toggles the media session on the peer connection
   * from an audio/video to video-only and back again.
   *
   * @api public
   */
  function toggleAudio() {
    if (videoWithAudioStream) {
      sendVideo();
    } else {
      sendVideoAndAudio();
    }
  }

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
      console.log('received end-of-ice signal');
      return;
    }

    if (isConnected) {
      console.log('peer connection already established. discarding ice candidate.', obj);
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
    const hasVideoTracks = stream.getVideoTracks().length > 0;

    console.log([
      `onaddstream. remote stream has ${stream.getAudioTracks().length} audio tracks`,
      `and ${stream.getVideoTracks().length} video tracks`
    ].join(' '));

    if (hasVideoTracks) {
      $remoteVideo.srcObject = stream;
      $remoteVideo.play();
    }
  };

  /**
   * socket.io handler for a received 'signal' pubsub event.
   *
   * The signal's `from` property is set by the server, indicating
   * the originating socketId of the offer.
   */
  socket.on('signal', signal => {
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
  });

  return {
    peerId,
    sendVideo,
    toggleAudio,
    handleOffer,
    pc
  };
}
