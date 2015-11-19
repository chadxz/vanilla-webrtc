/**
 *
 * Create a peer
 *
 * @param opts
 * @param opts.socket,
 * @param opts.socketId,
 * @param opts.$localVideo,
 * @param opts.$localScreenShare,
 * @param opts.$remoteVideo,
 * @param opts.$remoteScreenShare
 * @returns {{peerId: *, startVideoCall: startVideoCall}}
 */
export default function Peer(opts) {
  const { socket, $localVideo, $localScreenShare, $remoteVideo, $remoteScreenShare } = opts;
  const peerId = opts.socketId;

  const pc = new RTCPeerConnection();
  let videoCallStream = null;
  let screenShareStream = null;
  let didSetRemoteDescription = false;
  const queuedIceCandidates = [];

  function errorHandler(processName) {
    return console.error.bind(console, `${processName} failed`);
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

    return new Promise((resolve, reject) => {
      if (!signal.wantsRemoteVideo) {
        return resolve();
      }

      const constraints = { audio: true, video: true };
      getUserMedia(constraints, resolve, reject);
    }).then((stream) => {
      if (!stream) {
        return;
      }

      attachMediaStream($localVideo, stream);
      pc.addStream(stream);
      $localVideo.play();
    }).then(() => {
      pc.setRemoteDescription(new RTCSessionDescription(offer)).then(() => {
        didSetRemoteDescription = true;
        drainQueuedCandidates();

        pc.createAnswer().then(answer => {
          console.log('calling setLocalDescription after createAnswer');
          pc.setLocalDescription(answer).then(() => {
            socket.emit('signal', {
              type: 'answer',
              from: socket.id,
              to: peerId,
              answer
            });
            console.log('sent answer', answer);
          }, errorHandler('setLocalDescription'));
        });
      });
    });
  }

  function handleAnswer(signal) {
    const { answer } = signal;
    pc.setRemoteDescription(new RTCSessionDescription(answer)).then(() => {
      didSetRemoteDescription = true;
      drainQueuedCandidates();

      console.log('set answer', answer);
    });
  }

  function onCreateOfferSuccess(offer) {
    console.log('calling setLocalDescription in createOfferSuccess');
    pc.setLocalDescription(offer).then(() => {
      socket.emit('signal', {
        type: 'offer',
        from: socket.id,
        to: peerId,
        wantsRemoteVideo: true,
        offer
      });
      console.trace('sent offer', offer);
    }, errorHandler('setLocalDescription'));
  }

  function startVideoCall() {
    const videoConstraints = { audio: true, video: true };
    getUserMedia(videoConstraints, stream => {
      videoCallStream = stream;
      attachMediaStream($localVideo, stream);
      $localVideo.play();
      pc.addStream(stream);
      pc.createOffer(onCreateOfferSuccess, errorHandler('renegotiation createOffer'));
    }, console.error.bind(console, 'getUserMedia failed'));
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

    console.log('onicecandidate', obj.candidate);
    socket.emit('signal', {
      type: 'icecandidate',
      from: socket.id,
      to: peerId,
      icecandidate: obj.candidate
    });
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'connected') {
      console.log('connected.');
    }
  };

  pc.onnegotiationneeded = () => {
    if (pc.iceConnectionState === 'connected') {
      console.log('onnegotiationneeded');
      pc.createOffer(onCreateOfferSuccess, errorHandler('renegotiation createOffer'));
    }
  };

  pc.onaddstream = obj => {
    const stream = obj.stream;
    const hasAudioTracks = stream.getAudioTracks().length > 0;
    console.log([
      `onaddstream. remote stream has ${stream.getAudioTracks().length} audio tracks`,
      `and ${stream.getVideoTracks().length} video tracks`].join(' ')
    );
    const element = hasAudioTracks ? $remoteVideo : $remoteScreenShare;
    attachMediaStream(element, stream);
    element.play();
  };

  socket.on('signal', signal => {
    if (signal.from !== peerId) {
      return;
    }

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
    startVideoCall,
    handleOffer
  };
}
