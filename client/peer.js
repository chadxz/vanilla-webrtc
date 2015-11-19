function errorHandler(processName) {
  return console.error.bind(console, `${processName} failed`);
}

/**
 *
 * Create a peer
 *
 * @param opts
 * @param {object} opts.socket,
 * @param {string} opts.socketId,
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
    socket,
    $localVideo,
    $remoteVideo
  } = opts;

  const peerId = opts.socketId;
  const pc = new RTCPeerConnection();
  const queuedIceCandidates = [];

  let videoOnlyStream = null;
  let videoWithAudioStream = null;

  function isConnected() {
    return videoOnlyStream || videoWithAudioStream;
  }

  function drainQueuedCandidates() {
    while (queuedIceCandidates.length > 0) {
      pc.addIceCandidate(queuedIceCandidates.shift());
    }
    console.log('processed all queued ice candidates');
  }

  function handleIceCandidate(signal) {
    const { icecandidate } = signal;
    console.log('received ice candidate', icecandidate);
    if (pc.didSetRemoteDescription) {
      pc.addIceCandidate(new RTCIceCandidate(icecandidate));
    } else {
      queuedIceCandidates.push(new RTCIceCandidate(icecandidate));
    }
  }

  function handleOffer(signal) {
    const { offer } = signal;
    console.log('received offer', offer);

    pc.setRemoteDescription(new RTCSessionDescription(offer)).then(() => {
      drainQueuedCandidates();

      new Promise((resolve, reject) => {
        if (isConnected()) {
          return resolve();
        }

        const constraints = {
          audio: false,
          video: true
        };
        getUserMedia(constraints, resolve, reject);
      }).then((stream) => {
        if (!stream) {
          return;
        }

        videoOnlyStream = stream;
        attachMediaStream($localVideo, stream);
        pc.addStream(stream);
        $localVideo.play();
      }).then(() => {
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

  function handleAnswer(signal) {
    const { answer } = signal;
    pc.setRemoteDescription(new RTCSessionDescription(answer)).then(() => {
      drainQueuedCandidates();
      console.log('set answer', answer);
    });
  }

  function onCreateOfferSuccess(offer) {
    pc.setLocalDescription(offer).then(() => {
      socket.emit('signal', {
        type: 'offer',
        to: peerId,
        offer
      });
      console.trace('sent offer', offer);
    }, errorHandler('setLocalDescription'));
  }

  function sendVideo() {
    const videoConstraints = {
      audio: false,
      video: true
    };

    if (isConnected()) {
      pc.removeStream(videoWithAudioStream);
      videoWithAudioStream.getTracks().forEach(track => track.stop());
      videoWithAudioStream = null;
    }

    getUserMedia(videoConstraints, stream => {
      videoOnlyStream = stream;
      attachMediaStream($localVideo, stream);
      $localVideo.play();
      pc.addStream(stream);
      pc.createOffer(onCreateOfferSuccess, errorHandler('createOffer'));
    }, console.error.bind(console, 'getUserMedia failed'));
  }

  function sendVideoAndAudio() {
    const videoWithAudioConstraints = {
      audio: true,
      video: true
    };

    getUserMedia(videoWithAudioConstraints, stream => {
      pc.removeStream(videoOnlyStream);
      videoOnlyStream.getTracks().forEach(track => track.stop());
      videoOnlyStream = null;
      videoWithAudioStream = stream;
      attachMediaStream($localVideo, stream);
      $localVideo.play();
      pc.addStream(videoWithAudioStream);
      pc.createOffer(onCreateOfferSuccess, errorHandler('renegotiation createOffer'));
    }, console.error.bind(console, 'getUserMedia failed'));
  }

  function toggleAudio() {
    if (videoWithAudioStream) {
      sendVideo();
    } else {
      sendVideoAndAudio();
    }
  }

  /**
   * handle ice candidate generation from webrtc peer connection
   *
   * @param {*} obj.candidate The ice candidate
   */
  pc.onicecandidate = (obj) => {
    if (!obj.candidate) {
      console.log('received end-of-ice signal');
      return;
    }

    if (isConnected()) {
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

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'connected') {
      console.log('connected.');
    }
  };

  pc.onaddstream = obj => {
    const stream = obj.stream;
    const hasVideoTracks = stream.getVideoTracks().length > 0;

    console.log([
      `onaddstream. remote stream has ${stream.getAudioTracks().length} audio tracks`,
      `and ${stream.getVideoTracks().length} video tracks`
    ].join(' '));

    if (hasVideoTracks) {
      attachMediaStream($remoteVideo, stream);
      $remoteVideo.play();
    }
  };

  socket.on('signal', signal => {
    console.log(`received '${signal.type}' signal from ${signal.from} destined for ${signal.to}`);

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
      console.warn('received signal I have no idea what to do with', signal);
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
