// Getting elements from the html
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startCamButton = document.getElementById('startCamButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
const peerIdInput = document.getElementById('peerIdInput'); // User will input this
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendButton');
const chatMessagesDiv = document.getElementById('chatMessages');
const myUserIdDisplay = document.getElementById('myUserIdDisplay');
const statusMessageEl = document.getElementById('statusMessage');
const myNameInput = document.getElementById('myNameInput');
const userIdInfoSpan = document.getElementById('userIdInfo');

// local variables
let localStream;
let remoteStream;
let peerConnection;
let signalingWebSocket; 
let dataChannel;
let hasLocalVideo = false;

// default empty name
let myName = '';
// Generating unique ID
let myId = 'user-' + Math.random().toString(36).substring(2, 9); 
// Logging id to console.
console.log('My ID:', myId);
myUserIdDisplay.textContent =  myId;

if (myNameInput) {
    // Update name when the input loses focus (onblur) or Enter is pressed
    myNameInput.onblur = updateMyName;
    myNameInput.onkeypress = (event) => {
        if (event.key === 'Enter') {
            myNameInput.blur();
        }
    };
}

updateUserInfoDisplay();

// Function to get media stream with fallback
async function startMedia() {
    let stream = null;
    let constraintsVideoAudio = { video: true, audio: true };
    let constraintsAudioOnly = { audio: true };
    hasLocalVideo = false; // Reset flag

    try {
        // 1. Try getting video and audio
        console.log("Attempting to get video and audio stream...");
        stream = await navigator.mediaDevices.getUserMedia(constraintsVideoAudio);
        hasLocalVideo = true; // Success! We have video.
        console.log("Acquired video and audio stream.");
        localVideo.style.display = ''; // Ensure video element is visible
        localVideo.style.backgroundColor = ''; // Reset background

    } catch (err) {
        console.warn("getUserMedia(video+audio) failed:", err.name, err.message);

        // 2. If failed, try audio only (Common errors: NotFoundError, NotAllowedError for video)
        // Check if the error is likely related to video device/permission issues
        if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError" ||
            err.name === "NotAllowedError" || err.name === "NotReadableError" ||
            err.message.toLowerCase().includes("video"))
        {
            console.log("Attempting to get audio-only stream...");
            try {
                stream = await navigator.mediaDevices.getUserMedia(constraintsAudioOnly);
                hasLocalVideo = false; // Indicate we only have audio
                console.log("Acquired audio-only stream.");
                // Optionally hide local video element or show placeholder
                // localVideo.style.display = 'none'; // Option 1: Hide
                localVideo.style.backgroundColor = '#333'; // Option 2: Show dark background
                localVideo.poster = ''; // Clear any previous poster
                localVideo.style.display = ''; // Make sure it's visible if using background color


            } catch (audioErr) {
                console.error("getUserMedia(audio-only) also failed:", audioErr.name, audioErr.message);
                stream = null; // Failed to get anything
                alert(`Could not access microphone: ${audioErr.message}. Please check permissions.`);
            }
        } else {
            // Different error (e.g., user denied everything, hardware issue)
            stream = null;
             alert(`Could not access camera/microphone: ${err.message}. Please check permissions/devices.`);
        }
    }

    return stream; // Return the stream (or null if failed)
}


startCamButton.onclick = async () => {
    console.log("Start Camera button clicked");
    localStream = await startMedia(); // Use the new function
    if (localStream) {
        console.log("Local stream acquired.");
        localVideo.srcObject = localStream;
        localVideo.muted = true; // Crucial for preventing echo

        startCamButton.disabled = true;
        callButton.disabled = false; // Enable calling now
        hangupButton.disabled = true; // Ensure hangup is disabled until call starts

        // Optional: Update UI based on hasLocalVideo
        if (!hasLocalVideo) {
            console.log("Proceeding with audio only locally.");
            // UI is partially handled in startMedia (e.g., background color)
        }

    } else {
        console.log("Failed to acquire any local stream.");
        // Reset button states if failed
        startCamButton.disabled = false;
        callButton.disabled = true;
        // UI alerts already shown in startMedia
    }
};

// main.js (continued)
function connectWebSocket() {
    // Replace with your actual server IP/domain, replaced with local ip assigned to my system from router.
    // for local running siganling server
    // signalingWebSocket = new WebSocket('ws://localhost:8080');

    // for remote running signal server
    signalingWebSocket = new WebSocket('wss://signal-server-first-version.azurewebsites.net');

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
                updateStatus('Peer disconnected.', 'info');
                handleHangup();
                break;
            case 'error':
                console.error('Received error from signaling server:', message.message);
                // Server sent an error (e.g., user not found)
                // alert(message.message);
                updateStatus(message.message, 'error');
                if (!hangupButton.disabled) {
                    resetCallState(); // Reset UI and connection state
                }
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

    remoteVideo.style.backgroundColor = '';
    remoteVideo.poster = '';

    // Listen for incoming data channel.
    peerConnection.ondatachannel = (event) => {
        console.log('Incoming data channel detected!');
        dataChannel = event.channel; // Get the channel created by the other peer
        console.log(`Received data channel: '${dataChannel.label}'`);
        // Setup event handlers for the *received* channel
        setupDataChannelEventHandlers(dataChannel);
    };

    peerConnection.ontrack = (event) => {
        console.log('Remote track received:', event.track.kind, ' ID:', event.track.id);
        // Create a new stream if it doesn't exist
        if (!remoteStream) {
            remoteStream = new MediaStream();
            remoteVideo.srcObject = remoteStream;

            // Add listeners to detect when tracks are actually added/removed
            // Useful for handling dynamic changes or initial state
            remoteStream.onaddtrack = (e) => {
                console.log("Track added to remote stream:", e.track.kind);
                updateRemoteVideoAppearance();
            };
            remoteStream.onremovetrack = (e) => {
                console.log("Track removed from remote stream:", e.track.kind);
                updateRemoteVideoAppearance();
            };
        }

        remoteStream.addTrack(event.track, remoteStream);
        updateRemoteVideoAppearance();
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

// Setup Data Channel Handlers
function setupDataChannelEventHandlers(channel) {
    channel.onopen = () => {
        console.log(`Data channel '${channel.label}' opened!`);
        chatInput.disabled = false; // Enable input
        sendButton.disabled = false;
        updateStatus('Chat connected!', 'success');
        // Now you can reliably send messages. Enable chat input field?
        // e.g., chatInput.disabled = false; sendButton.disabled = false;
    };

    channel.onclose = () => {
        console.log(`Data channel '${channel.label}' closed.`);
        chatInput.disabled = true; // Disable input
        sendButton.disabled = true;
        updateStatus('Chat disconnected.', 'info');
        // Disable chat input field?
        // e.g., chatInput.disabled = true; sendButton.disabled = true;
    };

    channel.onerror = (error) => {
        console.error(`Data channel '${channel.label}' error:`, error);
    };

    channel.onmessage = (event) => {
        try {
            const messageData = JSON.parse(event.data);
            console.log(`Parsed message received on '${channel.label}':`, messageData);

            // Check if it has the expected structure
            if (messageData && messageData.senderName && typeof messageData.text !== 'undefined') {
                // Display using the sender's name from the message data
                displayChatMessage(messageData.text, messageData.senderName);
            } else {
                console.warn("Received data channel message in unexpected format:", event.data);
                // Fallback: display raw data if structure is wrong
                displayChatMessage(`Raw: ${event.data}`, 'Unknown Peer');
            }
        } catch(error) {
            console.error("Failed to parse data channel message or invalid JSON:", event.data, error);
             // Display raw data if parsing fails
             displayChatMessage(`Raw: ${event.data}`, 'Unknown Peer (Error)');
        }
    };
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
        updateStatus('Please enter the ID of the peer to call.', 'error');
        return;
    }
    if (!localStream) {
        updateStatus("Please start your camera first.", 'error');
        return;
    }

    // Check if already trying to call or connected.
    // A simple check is to see if hangupButton is enabled, implying a call is active/attempting
    if (!hangupButton.disabled) {
        console.warn("Call attempt already in progress or connected.");
        updateStatus("Call already active");
        return;
   }

    console.log(`Initiating call to ${targetPeerId}`);
    updateStatus(`Calling ${targetPeerId}...`, 'info');

    // *** Disable Call button immediately ***
    callButton.disabled = true;
    peerIdInput.disabled = true; // Disable input too
    hangupButton.disabled = false; // Enable Hang Up (to cancel attempt)

    // Create PeerConnection (assuming it's not already created)
    if (peerConnection) { // Clean up previous attempt if necessary
        console.warn("Cleaning up previous peer connection before new call");
        closeConnection();
    }

    // 1. Create PeerConnection
    peerConnection = new RTCPeerConnection(configuration);

    // Creating data channel
    // Create it BEFORE creating the offer.
    // Label can be anything, options configure reliability (default is reliable/ordered like TCP)
    dataChannel = peerConnection.createDataChannel("chatMessages", { ordered: true });
    console.log('Created data channel');
    // Setup data channel event listeners immediately after creation
    setupDataChannelEventHandlers(dataChannel);

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
        updateStatus(`Error starting call: ${error.message}`, 'error');
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

// main.js (Hangup Logic)
hangupButton.onclick = handleHangup;

function handleHangup() {
    console.log('Hanging up call.');
    // Notify the other peer if connected
    const targetPeerId = peerIdInput.value; // Get ID from input (might be caller or callee)
    if (targetPeerId && peerConnection && (peerConnection.connectionState === 'connected' || peerConnection.connectionState === 'connecting')) {
        sendMessage({ type: 'hangup', target: targetPeerId });
    }
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

    // Clear remote video source and update appearance
    if (remoteVideo) remoteVideo.srcObject = null;
    remoteStream = null; // Reset remote stream variable
    updateRemoteVideoAppearance(); // Update UI to reflect no remote stream
}

function resetCallState() {
    console.log("Resetting Call State");
    closeConnection(); // Ensure connection is closed first

    // Reset UI elements
    callButton.disabled = !localStream; // Re-enable if camera is on
    hangupButton.disabled = true;
    peerIdInput.disabled = false;

    updateUserInfoDisplay();
    clearStatus();

    if (chatInput) chatInput.disabled = true;
    if (sendButton) sendButton.disabled = true;
    if (chatMessagesDiv) chatMessagesDiv.innerHTML = '';
    
    // Reset local video appearance (in case it was hidden/styled)
    if (localVideo) {
        // Re-enable start button ONLY if localStream was fully stopped/nulled
        // startCamButton.disabled = !!localStream; // Or handle based on specific hangup logic
        if (hasLocalVideo) {
             localVideo.style.backgroundColor = '';
             localVideo.style.display = '';
        } else if (localStream) { // Audio-only stream still exists
             localVideo.style.backgroundColor = '#333';
             localVideo.style.display = '';
        } else { // No stream
             localVideo.style.display = ''; // Make sure it's visible for next start attempt
             localVideo.style.backgroundColor = '';
        }
    }


    // Reset remote video appearance
    if (remoteVideo) {
        remoteVideo.srcObject = null;
        remoteVideo.style.backgroundColor = '';
        remoteVideo.poster = '';
    }
}

function sendMessageViaDataChannel() {
    const message = chatInput.value;
    if (!message) return;
    if (dataChannel && dataChannel.readyState === 'open') {
        // Create a JSON object with sender name and message text
        const messageData = {
            senderName: getDisplayName(), // Use helper to get current name or ID
            text: message
        };

        const jsonMessage = JSON.stringify(messageData);

        try {
            dataChannel.send(jsonMessage);
            console.log('Sent message:', messageData);
            displayChatMessage(message, getDisplayName()); // Display your own message
            chatInput.value = ''; // Clear input
        } catch (error) {
            console.error('Error sending message:', error);
            updateStatus('Error sending message.', 'error');
        }
    } else {
        console.warn('Cannot send message, channel for chat is not open.');
        updateStatus('Chat channel not open.', 'error');
    }
}

// Add event listener for the send button
sendButton.onclick = sendMessageViaDataChannel;
chatInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        sendMessageViaDataChannel();
    }
});

// Initial UI state
callButton.disabled = true;
hangupButton.disabled = true;
chatInput.disabled = true;
sendButton.disabled = true;
clearStatus();


// Helper functions.
// Helper to display messages in the UI
function displayChatMessage(messageText, senderName) {
    const messageElement = document.createElement('p');
    // Determine if the message is from "Me" or the peer for potential styling
    const ownNameOrId = getDisplayName(); // Get my current name/id
    let displaySender = senderName;
    let messageClass = 'peer-message'; // Default class

    if (senderName === ownNameOrId) {
        // It's my own message (or appears to be)
        // Optional: Display "Me" instead of own name/ID for clarity
        displaySender = "Me";
        messageClass = 'my-message';
    }
    messageElement.innerHTML = `<strong>${displaySender}:</strong> ${messageText}`; // Use innerHTML to allow bold tag
    messageElement.classList.add(messageClass); // Add class for styling

    chatMessagesDiv.appendChild(messageElement);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

// Helper function to update remote video appearance
function updateRemoteVideoAppearance() {
    if (!remoteStream || !remoteVideo) return; // Exit if stream or element is not ready

    const videoTracks = remoteStream.getVideoTracks();
    const audioTracks = remoteStream.getAudioTracks(); // Check if audio exists too

    if (videoTracks.length > 0) {
        // We have video from the remote peer
        console.log("Remote peer is sending video.");
        remoteVideo.style.backgroundColor = ''; // Default background
        remoteVideo.poster = ''; // Remove any placeholder
    } else if (audioTracks.length > 0) {
        // No video, but we have audio
        console.log("Remote peer is audio-only.");
        remoteVideo.style.backgroundColor = '#333'; // Show dark background
        // Optionally set a placeholder image/icon:
        // remoteVideo.poster = 'images/audio-only-avatar.png';
    } else {
         // No tracks (or stream just cleared) - reset appearance
         console.log("Remote peer has no media tracks currently.");
         remoteVideo.style.backgroundColor = '';
         remoteVideo.poster = '';
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

// Helper to send messages via WebSocket
function sendMessage(message) {
    if (signalingWebSocket && signalingWebSocket.readyState === WebSocket.OPEN) {
        signalingWebSocket.send(JSON.stringify(message));
    } else {
        console.error('WebSocket is not connected.');
    }
}

function updateStatus(message, type = 'info') { // type can be 'info', 'error', 'success'
    if (!statusMessageEl) return;
    statusMessageEl.textContent = message;
    statusMessageEl.className = `status ${type}`; // Set class for styling
}

function clearStatus() {
    if (!statusMessageEl) return;
    statusMessageEl.textContent = '';
    statusMessageEl.className = 'status';
}

function updateMyName() {
    if (myNameInput) {
        myName = myNameInput.value.trim(); // Get value and remove whitespace
        console.log(`My name set to: ${myName}`);
        updateUserInfoDisplay(); // Update the top display with the new name
    }
}

function updateUserInfoDisplay() {
    // Update the text content to show Name (if set) and ID
    const nameToShow = myName ? myName : 'Guest'; // Use 'Guest' or keep blank if no name
    userIdInfoSpan.innerHTML = `You: <strong>${nameToShow}</strong> (ID: <span id="myUserIdDisplay">${myId}</span>)`;
    // Note: Re-setting innerHTML for myUserIdDisplay is slightly redundant but ensures it's always present
}

function getDisplayName() {
    // Helper to get the name to be sent in messages (use ID if name is empty)
    return myName || myId;
}
