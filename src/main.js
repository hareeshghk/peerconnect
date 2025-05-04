// main.js (initial part)
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startCamButton = document.getElementById('startCamButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
const peerIdInput = document.getElementById('peerIdInput'); // Assuming you add this

let localStream;
let remoteStream;
let peerConnection;
let signalingWebSocket; // We'll set this up later
let dataChannel; // Add this variable globally or scoped appropriately
let myId = 'user-' + Math.random().toString(36).substr(2, 9); // Simple unique ID
console.log('My ID:', myId);
// Add an element to display the ID or use the console

startCamButton.onclick = async () => {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        localVideo.srcObject = localStream;

        // IMPORTANT: Keep your local video muted to prevent echo/feedback
        localVideo.muted = true;

        startCamButton.disabled = true;
        callButton.disabled = false; // Enable call button only after cam starts
        console.log('Local stream started');
    } catch (error) {
        console.error('Error accessing media devices.', error);
        alert('Could not access camera/microphone: ' + error.message);
    }
};

// main.js (continued)
function connectWebSocket() {
    // Replace with your actual server IP/domain if not localhost
    signalingWebSocket = new WebSocket('ws://localhost:8080');

    signalingWebSocket.onopen = () => {
        console.log('WebSocket connected');
        // Identify this client to the server
        sendMessage({ type: 'identify', id: myId });
    };

    signalingWebSocket.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('Received message:', message);

        switch (message.type) {
            case 'offer':
                // Received an offer from a peer
                await handleOffer(message.offer, message.sender);
                break;
            case 'answer':
                // Received an answer from a peer
                await handleAnswer(message.answer);
                break;
            case 'candidate':
                // Received an ICE candidate from a peer
                await handleCandidate(message.candidate);
                break;
            case 'hangup':
                // Peer hung up
                handleHangup();
                break;
            case 'error':
                // Server sent an error (e.g., user not found)
                alert(message.message);
                resetCallState(); // Reset UI etc.
                break;
            case 'identified':
                 console.log(`Server confirmed identification as ${message.id}`);
                 // You could update UI here if needed
                 break;
            default:
                console.log('Unknown message type:', message.type);
        }
    };

    signalingWebSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('WebSocket connection error. Please refresh and try again.');
        resetCallState();
    };

    signalingWebSocket.onclose = () => {
        console.log('WebSocket closed');
        // Optionally try to reconnect or just reset state
         // resetCallState(); // Be careful not to interfere with intentional hangup
    };
}

// Helper to send messages via WebSocket
function sendMessage(message) {
    if (signalingWebSocket && signalingWebSocket.readyState === WebSocket.OPEN) {
        signalingWebSocket.send(JSON.stringify(message));
    } else {
        console.error('WebSocket is not connected.');
    }
}

// Call this function early on, perhaps after getting the ID
connectWebSocket();

// RTC peer connections
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, // Google's public STUN server
        { urls: 'stun:stun1.l.google.com:19302' },
        // Add more STUN servers if needed
        // {
        //   urls: 'turn:your-turn-server.com:3478',
        //   username: 'user',
        //   credential: 'password'
        // } // Add TURN server if needed for difficult NATs
    ]
};

function addLocalTracks() {
    if (localStream && peerConnection) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log('Added local track:', track.kind);
        });
    } else {
         console.error("Cannot add tracks: localStream or peerConnection missing.");
    }
}

function setupPeerConnectionEventHandlers() {
    if (!peerConnection) return;

    peerConnection.ontrack = (event) => {
        console.log('Remote track received:', event.track.kind);
        // Create a new stream if it doesn't exist
        if (!remoteStream) {
           remoteStream = new MediaStream();
           remoteVideo.srcObject = remoteStream;
        }
        remoteStream.addTrack(event.track);
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Generated ICE candidate:', event.candidate);
            // Send the candidate to the remote peer via signaling
            sendMessage({
                type: 'candidate',
                target: peerIdInput.value, // Target the peer we are calling/called by
                candidate: event.candidate
            });
        } else {
            console.log('All ICE candidates have been sent');
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state change:', peerConnection.iceConnectionState);
        // Handle states like 'connected', 'disconnected', 'failed', 'closed'
        if (peerConnection.iceConnectionState === 'failed' ||
            peerConnection.iceConnectionState === 'disconnected' ||
            peerConnection.iceConnectionState === 'closed') {
            // Consider the call potentially dropped, maybe cleanup
            // Be careful with 'disconnected' as it might recover
        }
    };

    peerConnection.onconnectionstatechange = () => {
       console.log('Connection state change:', peerConnection.connectionState);
       if (peerConnection.connectionState === 'connected') {
           console.log('Peers connected!');
           // Update UI (e.g., show connected status)
       }
        if (peerConnection.connectionState === 'failed') {
           console.error('Peer connection failed.');
           handleHangup(); // Or attempt restart
        }
    }
}

// main.js (continued) - ICE Candidate Handling
async function handleCandidate(candidate) {
    if (!peerConnection) {
        console.error('PeerConnection not initialized yet.');
        // Maybe queue candidates if offer/answer hasn't happened? Risky.
        return;
    }
    if (!candidate) {
         console.warn("Received empty candidate");
         return;
    }
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Added received ICE candidate');
    } catch (error) {
        console.error('Error adding received ICE candidate', error);
    }
}

// main.js (Offer/Answer logic)

callButton.onclick = async () => {
    const targetPeerId = peerIdInput.value;
    if (!targetPeerId) {
        alert('Please enter the ID of the peer you want to call.');
        return;
    }
    if (!localStream) {
         alert("Please start your camera first.");
         return;
    }

    console.log(`Initiating call to ${targetPeerId}`);

    // 1. Create PeerConnection
    peerConnection = new RTCPeerConnection(configuration);

    // 2. Setup Event Handlers (MUST be done before adding tracks/creating offer)
    setupPeerConnectionEventHandlers(); // Call the function we defined earlier

    // 3. Add Local Tracks
    addLocalTracks();

    try {
        // 4. Create Offer
        const offer = await peerConnection.createOffer();
        console.log('Created offer');

        // 5. Set Local Description
        await peerConnection.setLocalDescription(offer);
        console.log('Set local description');

        // 6. Send Offer via Signaling
        sendMessage({ type: 'offer', target: targetPeerId, offer: offer });

        // 7. Update UI
        callButton.disabled = true;
        hangupButton.disabled = false;
        peerIdInput.disabled = true; // Don't allow changing target mid-call

    } catch (error) {
        console.error('Error creating offer or setting local description:', error);
        resetCallState(); // Clean up if offer fails
    }
};

async function handleOffer(offer, senderId) {
    if (peerConnection) {
        console.warn('Existing peer connection detected when receiving offer. Resetting.');
        // Potentially handle this more gracefully (e.g., notify user)
         closeConnection(); // Close existing before creating new
    }
    if (!localStream) {
         alert("Cannot accept call without starting camera first.");
         // Maybe send a 'busy' or 'unavailable' message back?
         return;
    }

    console.log(`Received offer from ${senderId}`);
    peerIdInput.value = senderId; // Store caller ID to send answer back

    // 1. Create PeerConnection
    peerConnection = new RTCPeerConnection(configuration);

    // 2. Setup Event Handlers
    setupPeerConnectionEventHandlers();

    // 3. Add Local Tracks (Callee also needs to send their stream)
    addLocalTracks();

    try {
        // 4. Set Remote Description
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('Set remote description');

        // 5. Create Answer
        const answer = await peerConnection.createAnswer();
        console.log('Created answer');

        // 6. Set Local Description
        await peerConnection.setLocalDescription(answer);
        console.log('Set local description');

        // 7. Send Answer via Signaling
        sendMessage({ type: 'answer', target: senderId, answer: answer });

        // 8. Update UI
        callButton.disabled = true; // Cannot initiate another call
        hangupButton.disabled = false;
        peerIdInput.disabled = true;

    } catch (error) {
        console.error('Error handling offer or creating answer:', error);
         resetCallState();
    }
}

async function handleAnswer(answer) {
    if (!peerConnection) {
        console.error('Received answer but no peer connection exists.');
        return;
    }
    console.log('Received answer');
    try {
        // Set Remote Description
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('Set remote description (answer)');
        // Connection should now start establishing via ICE exchange
    } catch (error) {
        console.error('Error setting remote description (answer):', error);
         resetCallState();
    }
}

// main.js (Hangup Logic)
hangupButton.onclick = () => {
    handleHangup();
     // Notify the other peer
    if (peerIdInput.value) { // Check if we were in a call
         sendMessage({ type: 'hangup', target: peerIdInput.value });
    }
};

function handleHangup() {
    console.log('Hanging up call.');
    closeConnection();
    resetCallState();
}

function closeConnection() {
    if (peerConnection) {
        // Stop sending media
        peerConnection.getSenders().forEach(sender => {
            if (sender.track) {
                sender.track.stop();
            }
        });
         // Stop receiving media (redundant if also stopping tracks)
        peerConnection.getReceivers().forEach(receiver => {
            if (receiver.track) {
                receiver.track.stop();
            }
        });

        // Clean up event listeners to prevent memory leaks
         peerConnection.ontrack = null;
         peerConnection.onicecandidate = null;
         peerConnection.oniceconnectionstatechange = null;
         peerConnection.onconnectionstatechange = null;

        // Close the connection
        peerConnection.close();
        peerConnection = null;
        console.log('PeerConnection closed.');
    }
    // Clear video elements
    remoteVideo.srcObject = null;
     // Don't stop local video here unless intended, user might want to see self
     // If you want to stop camera on hangup:
     // if (localStream) {
     //    localStream.getTracks().forEach(track => track.stop());
     //    localVideo.srcObject = null;
     //    localStream = null;
     // }
     remoteStream = null; // Reset remote stream
}

function resetCallState() {
    console.log("Resetting Call State");
    closeConnection(); // Ensure connection is closed first

    // Reset UI elements
    callButton.disabled = !localStream; // Re-enable if camera is on
    hangupButton.disabled = true;
    peerIdInput.disabled = false;
    peerIdInput.value = '';
    // If camera was stopped on hangup, re-enable start button
    // startCamButton.disabled = false;
}

// Initial UI state
callButton.disabled = true;
hangupButton.disabled = true;
