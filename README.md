# vanilla-webrtc

sample vanilla webrtc application to learn about the guts of renegotiation.

outstanding issues:

 - [ ] get it to work in Firefox. Use stream.add/removeTrack instead
 of pc.add/removeStream
 - [ ] look into possibly using stream.add/removeTrack in Chrome, and
 only adding a stream when a track type is going to be duplicated.
 - [ ] find out if there is a publicly accessible STUN/TURN server we
 could use instead of always having to be on the same network for it to
 work correctly.

# license

[MIT](LICENSE)
