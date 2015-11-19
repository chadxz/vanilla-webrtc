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
  const {
    socket,
    $localVideo,
    $remoteVideo,
    $toggleAudioButton
  } = opts;
  const peerId = opts.socketId;
  let renegotiating = false;
  const pc = new RTCPeerConnection();
  const queuedIceCandidates = [];

  let videoOnlyStream = null;
  let videoWithAudioStream = null;

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
    const {
      icecandidate
    } = signal;
    console.log('received ice candidate', icecandidate);
    if (pc.didSetRemoteDescription) {
      pc.addIceCandidate(new RTCIceCandidate(icecandidate));
    } else {
      queuedIceCandidates.push(new RTCIceCandidate(icecandidate));
    }
  }

  function handleOffer(signal) {
    const {
      offer
    } = signal;
    console.log('received offer', offer);
    if (signal.renegotiating) {
      renegotiating = true;
    }
    if (renegotiating) {
      pc.removeStream(videoOnlyStream);
      videoOnlyStream.getTracks().forEach(track => track.stop());
      videoOnlyStream = null;
    }
    return new Promise((resolve, reject) => {
      const constraints = {
        audio: renegotiating ? true : false,
        video: true
      };
      getUserMedia(constraints, resolve, reject);
    }).then((stream) => {
      if (!stream) {
        return;
      }
      if (renegotiating) {
        videoWithAudioStream = stream;
      } else {
        videoOnlyStream = stream;
      }
      attachMediaStream($localVideo, stream);
      pc.addStream(stream);
      $localVideo.play();
    }).then(() => {
      pc.setRemoteDescription(new RTCSessionDescription(offer)).then(() => {
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
    const {
      answer
    } = signal;
    pc.setRemoteDescription(new RTCSessionDescription(answer)).then(() => {
      drainQueuedCandidates();
      console.log('set answer', answer);
    });
  }

  function onCreateOfferSuccess(offer) {
    pc.setLocalDescription(offer).then(() => {
      socket.emit('signal', {
        type: 'offer',
        from: socket.id,
        to: peerId,
        offer,
        renegotiating: renegotiating
      });
      console.trace('sent offer', offer);
    }, errorHandler('setLocalDescription'));
  }

  function startVideoCall() {
    const videoConstraints = {
      audio: false,
      video: true
    };
    getUserMedia(videoConstraints, stream => {
      videoOnlyStream = stream;
      attachMediaStream($localVideo, stream);
      $localVideo.play();
      pc.addStream(stream);
      pc.createOffer(onCreateOfferSuccess, errorHandler('createOffer'));
    }, console.error.bind(console, 'getUserMedia failed'));
  }

  function startAudioCall() {
    const videoWithAudioConstraints = {
      audio: true,
      video: true
    };

    getUserMedia(videoWithAudioConstraints, stream => {
      pc.removeStream(videoOnlyStream);
      videoOnlyStream.getTracks().forEach(track => track.stop());
      videoOnlyStream = null;

      renegotiating = true;

      videoWithAudioStream = stream;
      attachMediaStream($localVideo, stream);
      $localVideo.play();
      pc.addStream(videoWithAudioStream);
      pc.createOffer(onCreateOfferSuccess, errorHandler('renegotiation createOffer'));
    }, console.error.bind(console, 'getUserMedia failed'));
  }

  $toggleAudioButton.onclick = function toggleAudioButtonClick() {
    // if (!videoWithAudioStream) {
    startAudioCall();
    // }
  };

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
    if (renegotiating) {
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

  // pc.onnegotiationneeded = () => {
  //   if (pc.iceConnectionState === 'connected') {
  //     console.log('onnegotiationneeded');
  //     pc.createOffer(onCreateOfferSuccess, errorHandler('renegotiation createOffer'));
  //   }
  // };

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
    handleOffer,
    pc
  };
}
