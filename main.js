// Author: Hareesh Kumar Gajulapalli

// --- HTML Element References ---
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startCamButton = document.getElementById('startCamButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
const peerIdInput = document.getElementById('peerIdInput'); // Expects target peer's NAME
const myNameInput = document.getElementById('myNameInput');
const myUserIdDisplay = document.getElementById('myUserIdDisplay'); // Shows current signaling ID
const userIdInfoSpan = document.getElementById('userIdInfo');
const statusMessageEl = document.getElementById('statusMessage');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendButton');
const chatMessagesDiv = document.getElementById('chatMessages');

// --- Global Variables ---
let localStream;
let remoteStream;
let peerConnection;
let signalingWebSocket;
let dataChannel;

let myName = ''; // User's chosen name
let myRandomId = 'user-' + Math.random().toString(36).substring(2, 9); // Fallback/internal
let currentSignalingId = ''; // The ID used for WebSocket identification and signaling

let hasLocalVideo = false; // For audio-only fallback

// --- WebRTC Configuration ---
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ]
};

// --- Initialization ---
updateCurrentSignalingId();
updateUserInfoDisplay();
connectWebSocket();

// --- Event Listeners for User Input ---
if (myNameInput) {
    myNameInput.onblur = handleNameChange;
    myNameInput.onkeypress = (event) => {
        if (event.key === 'Enter') myNameInput.blur();
    };
}

startCamButton.onclick = async () => {
    console.log("[startCamButton] Clicked");
    localStream = await startMedia();

    if (localStream) {
        console.log("[startCamButton] Local stream acquired.");
        localVideo.srcObject = localStream;
        localVideo.muted = true;

        startCamButton.disabled = true;
        callButton.disabled = false;
        hangupButton.disabled = true; // Ensure hangup is initially disabled

        if (!hasLocalVideo) console.log("[startCamButton] Proceeding with audio only locally.");
    } else {
        console.log("[startCamButton] Failed to acquire any local stream.");
        updateStatus("Could not start camera/microphone.", "error");
        startCamButton.disabled = false;
        callButton.disabled = true;
    }
};

callButton.onclick = async () => {
    const targetPeerName = peerIdInput.value.trim();
    console.log(`[callButton.onclick] Target peer name from input: '${targetPeerName}'`);

    if (!targetPeerName) {
        updateStatus('Please enter the name of the peer to call.', 'error');
        return;
    }
    if (!localStream) {
        updateStatus("Please start your camera/microphone first.", "error");
        return;
    }
    if (!currentSignalingId) {
        updateStatus('Please set your name/ID before calling.', 'error');
        handleNameChange();
        if (!currentSignalingId) {
            console.error("[callButton.onclick] No signaling ID set. Aborting call.");
            return;
        }
    }
    if (!hangupButton.disabled) { // Simple check: if hangup is enabled, a call is active/attempting
        console.warn("[callButton.onclick] Call attempt already in progress or connected.");
        updateStatus("Call already active or attempting.", "info");
        return;
    }

    console.log(`[callButton.onclick] Initiating call to ${targetPeerName} (from ${currentSignalingId})`);
    updateStatus(`Calling ${targetPeerName}...`, 'info');

    callButton.disabled = true;
    peerIdInput.disabled = true;
    hangupButton.disabled = false;

    if (peerConnection) {
        console.warn("[callButton.onclick] Cleaning up previous peer connection before new call");
        closeConnection(); // Ensure clean state from any prior attempt
    }
    peerConnection = new RTCPeerConnection(configuration);
    setupPeerConnectionEventHandlers();
    addLocalTracks();

    // Create Data Channel
    dataChannel = peerConnection.createDataChannel("chatMessages", { ordered: true });
    console.log('[callButton.onclick] Created data channel "chatMessages"');
    setupDataChannelEventHandlers(dataChannel);

    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        console.log(`[callButton.onclick] Sending offer to target: '${targetPeerName}'`);
        sendMessage({ type: 'offer', target: targetPeerName, offer: offer });
    } catch (error) {
        console.error('[callButton.onclick] Error creating offer or setting local description:', error);
        updateStatus(`Error starting call: ${error.message}`, 'error');
        resetCallState();
    }
};

hangupButton.onclick = handleUserHangup;

if (sendButton && chatInput) {
    sendButton.onclick = sendMessageViaDataChannel;
    chatInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') sendMessageViaDataChannel();
    });
}


// --- Helper Functions ---
function handleNameChange() {
    if (myNameInput) {
        const newName = myNameInput.value.trim();
        console.log(`[handleNameChange] Input value: '${newName}', Current myName: '${myName}'`);
        if (newName && newName !== myName) {
            myName = newName;
            console.log(`[handleNameChange] My name set to: ${myName}`);
            updateCurrentSignalingId();
            updateUserInfoDisplay();
        } else if (!newName && myName) { // Name cleared
            myName = '';
            console.log(`[handleNameChange] My name cleared.`);
            updateCurrentSignalingId();
            updateUserInfoDisplay();
        } else if (newName === myName) {
            console.log(`[handleNameChange] Name unchanged: '${myName}'`);
        }
        myNameInput.value = myName; // Reflect trimmed name back to input
    }
}

function updateCurrentSignalingId() {
    const oldSignalingId = currentSignalingId;
    currentSignalingId = myName || myRandomId; // Use name if set, else randomId
    console.log(`[updateCurrentSignalingId] Set to: '${currentSignalingId}' (was: '${oldSignalingId}', myName: '${myName}')`);
    // If WebSocket is connected and ID changed, re-identify
    if (signalingWebSocket && signalingWebSocket.readyState === WebSocket.OPEN && oldSignalingId !== currentSignalingId) {
        sendMessage({ type: 'identify', id: currentSignalingId });
        console.log(`[updateCurrentSignalingId] Re-identified with server as: ${currentSignalingId}`);
    }
}

function updateUserInfoDisplay() {
    const nameToShow = myName || 'Guest';
    userIdInfoSpan.innerHTML = `You: <strong>${nameToShow}</strong> (Signaling as: <span id="myUserIdDisplay">${currentSignalingId || myRandomId}</span>)`;
}

function getDisplayNameForChat() {
    return myName || 'Guest';
}

async function startMedia() {
    let stream = null;
    const constraintsVideoAudio = { video: true, audio: true };
    const constraintsAudioOnly = { audio: true };
    hasLocalVideo = false;

    try {
        console.log("[startMedia] Attempting video and audio...");
        stream = await navigator.mediaDevices.getUserMedia(constraintsVideoAudio);
        hasLocalVideo = true;
        console.log("[startMedia] Acquired video and audio stream.");
        if (localVideo) {
            localVideo.style.display = '';
            localVideo.style.backgroundColor = '';
        }
    } catch (err) {
        console.warn("[startMedia] getUserMedia(video+audio) failed:", err.name, err.message);
        if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError" || err.name === "NotAllowedError" || err.name === "NotReadableError" || err.message.toLowerCase().includes("video")) {
            console.log("[startMedia] Attempting audio-only stream...");
            try {
                stream = await navigator.mediaDevices.getUserMedia(constraintsAudioOnly);
                hasLocalVideo = false;
                console.log("[startMedia] Acquired audio-only stream.");
                if (localVideo) {
                    localVideo.style.backgroundColor = '#333'; // Dark background for audio-only
                    localVideo.poster = '';
                    localVideo.style.display = '';
                }
            } catch (audioErr) {
                console.error("[startMedia] getUserMedia(audio-only) also failed:", audioErr.name, audioErr.message);
                updateStatus(`Could not access microphone: ${audioErr.message}.`, "error");
                stream = null;
            }
        } else {
            updateStatus(`Could not access camera/microphone: ${err.message}.`, "error");
            stream = null;
        }
    }
    return stream;
}

// --- WebSocket Signaling ---
function connectWebSocket() {
    // REPLACE WITH YOUR AZURE URL, sample is wss://<webapp name>.azurewebsites.net or wss://127.0.0.1:8080 if signal server running locally at 8080
    const signalServerUrl = APP_CONFIG.SIGNAL_SERVER_URL;
    console.log(`[connectWebSocket] Connecting to signaling server at ${signalServerUrl}`);
    signalingWebSocket = new WebSocket(signalServerUrl);

    signalingWebSocket.onopen = () => {
        console.log('[connectWebSocket] WebSocket connected');
        if (!currentSignalingId) updateCurrentSignalingId(); // Ensure ID is set
        console.log(`[connectWebSocket] Identifying with server as: '${currentSignalingId}'`);
        sendMessage({ type: 'identify', id: currentSignalingId });
    };

    signalingWebSocket.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('[WebSocket onmessage] Received message:', message);

        switch (message.type) {
            case 'offer':
                console.log(`[WebSocket onmessage] Offer received. Sender: '${message.sender}'`);
                peerIdInput.value = message.sender; // Store sender's name for answer
                await handleOffer(message.offer, message.sender);
                break;
            case 'answer':
                console.log(`[WebSocket onmessage] Answer received. Sender: '${message.sender}'`);
                await handleAnswer(message.answer);
                break;
            case 'candidate':
                console.log(`[WebSocket onmessage] Candidate received. Sender: '${message.sender}'`);
                 // Only add candidate if it's from the peer we are connected/connecting to
                if (peerIdInput.value === message.sender && peerConnection) {
                     await handleCandidate(message.candidate);
                } else {
                     console.warn(`[WebSocket onmessage] Received candidate from unexpected sender ${message.sender} or no peerConnection.`);
                }
                break;
            case 'hangup':
                console.log(`[WebSocket onmessage] Hangup received from: '${message.sender}'`);
                if (peerIdInput.value === message.sender) { // Ensure hangup is from current peer
                    updateStatus(`${message.sender} disconnected.`, 'info');
                    handleRemoteHangup();
                }
                break;
            case 'error':
                console.error('[WebSocket onmessage] Received error from signaling server:', message.message);
                updateStatus(message.message, 'error');
                // Only reset if we were in an active call attempt
                if (!hangupButton.disabled) {
                    resetCallState();
                }
                break;
            case 'identified':
                console.log(`[WebSocket onmessage] Server confirmed identification as ${message.id}`);
                if (message.id !== currentSignalingId) {
                    console.warn(`[WebSocket onmessage] Server identified us as '${message.id}', but client thought it was '${currentSignalingId}'. Updating.`);
                    currentSignalingId = message.id; // Align with server
                    if (!myName && message.id.startsWith('user-')) myRandomId = message.id; // Update random if server changed it
                    else if (myName && message.id !== myName) console.warn("Server changed our chosen name during identification!");
                    updateUserInfoDisplay();
                }
                break;
            default:
                console.log('[WebSocket onmessage] Unknown message type:', message.type);
        }
    };

    signalingWebSocket.onerror = (error) => {
        console.error('[connectWebSocket] WebSocket error:', error);
        updateStatus('WebSocket connection error. Please check server or refresh.', 'error');
        // Consider if resetCallState() should be called here, depends on desired behavior
    };

    signalingWebSocket.onclose = (event) => {
        console.log(`[connectWebSocket] WebSocket closed: Code=${event.code}, Reason=${event.reason}`);
        updateStatus('Disconnected from signaling server.', 'info');
        // Avoid resetting call state if it was a clean hangup.
        // If call was active and socket closes unexpectedly, then reset.
        // if (!hangupButton.disabled) { // A call was active or being attempted
        //    resetCallState();
        // }
    };
}

function sendMessage(message) {
    if (signalingWebSocket && signalingWebSocket.readyState === WebSocket.OPEN) {
        signalingWebSocket.send(JSON.stringify(message));
    } else {
        console.error('[sendMessage] WebSocket is not connected. Message not sent:', message);
        updateStatus('Cannot send message: Not connected to server.', 'error');
    }
}

// --- WebRTC Core Logic ---
function setupPeerConnectionEventHandlers() {
    if (!peerConnection) return;
    console.log("[setupPeerConnectionEventHandlers] Setting up handlers for new PeerConnection.");

    remoteVideo.style.backgroundColor = ''; // Reset remote video appearance
    remoteVideo.poster = '';

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("[PeerConnection onicecandidate] Generated ICE candidate:", event.candidate.candidate.substring(0, 30) + "...");
            sendMessage({
                type: 'candidate',
                target: peerIdInput.value, // Target the current peer we are in call with
                candidate: event.candidate
            });
        } else {
            console.log('[PeerConnection onicecandidate] All ICE candidates have been sent.');
        }
    };

    peerConnection.ontrack = (event) => {
        console.log(`[PeerConnection ontrack] Remote track received: Kind=${event.track.kind}, ID=${event.track.id}`);
        if (!remoteStream) {
            remoteStream = new MediaStream();
            remoteVideo.srcObject = remoteStream;
            remoteStream.onaddtrack = (e) => {
                console.log(`[PeerConnection ontrack] Track ADDED to remoteStream: Kind=${e.track.kind}`);
                updateRemoteVideoAppearance();
            };
            remoteStream.onremovetrack = (e) => {
                 console.log(`[PeerConnection ontrack] Track REMOVED from remoteStream: Kind=${e.track.kind}`);
                 updateRemoteVideoAppearance();
             };
        }
        if (!remoteStream.getTrackById(event.track.id)) {
            remoteStream.addTrack(event.track, remoteStream);
        }
        remoteVideo.muted = false; // Ensure remote video is NOT muted
        updateRemoteVideoAppearance();
    };

    peerConnection.onconnectionstatechange = () => {
        if (!peerConnection) return; // Guard against calls after connection is closed
        console.log('[PeerConnection onconnectionstatechange] Connection state change:', peerConnection.connectionState);
        switch (peerConnection.connectionState) {
            case 'connected':
                updateStatus(`Connected with ${peerIdInput.value || 'peer'}.`, 'success');
                break;
            case 'disconnected':
                updateStatus('Peer disconnected. Attempting to reconnect...', 'info');
                // WebRTC might try to reconnect automatically.
                break;
            case 'failed':
                updateStatus('Connection failed.', 'error');
                resetCallState(); // Connection definitively failed
                break;
            case 'closed':
                updateStatus('Connection closed.', 'info');
                // resetCallState(); // Usually called by hangup logic already
                break;
        }
    };

    peerConnection.ondatachannel = (event) => { // For the callee side
        console.log('[PeerConnection ondatachannel] Incoming data channel detected!');
        dataChannel = event.channel;
        console.log(`[PeerConnection ondatachannel] Received data channel: '${dataChannel.label}'`);
        setupDataChannelEventHandlers(dataChannel);
    };
}

function addLocalTracks() {
    if (localStream && peerConnection) {
        console.log(`[addLocalTracks] Adding ${localStream.getTracks().length} local tracks to PeerConnection.`);
        localStream.getTracks().forEach(track => {
            console.log(`[addLocalTracks] Attempting to add track: Kind=${track.kind}, ID=${track.id}, Enabled=${track.enabled}`);
            try {
                peerConnection.addTrack(track, localStream);
                console.log(`[addLocalTracks] Successfully added track: Kind=${track.kind}`);
            } catch (e) {
                console.error(`[addLocalTracks] FAILED to add track: Kind=${track.kind}`, e);
            }
        });
    } else {
        console.error("[addLocalTracks] Cannot add tracks: localStream or peerConnection missing.");
    }
}

async function handleOffer(offer, senderName) {
    console.log(`[handleOffer] Handling offer from: '${senderName}'`);
    if (!currentSignalingId) updateCurrentSignalingId(); // Ensure our ID is set
    console.log(`[handleOffer] My signaling ID (self): '${currentSignalingId}'`);

    if (peerConnection) {
        console.warn("[handleOffer] Existing peer connection detected. Closing before handling new offer.");
        closeConnection();
    }
    peerConnection = new RTCPeerConnection(configuration);
    setupPeerConnectionEventHandlers();
    addLocalTracks(); // Callee also needs to add their tracks

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log("[handleOffer] Set remote description (offer)");
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log("[handleOffer] Set local description (answer)");

        console.log(`[handleOffer] Sending answer to target: '${senderName}'`);
        sendMessage({ type: 'answer', target: senderName, answer: answer });

        updateStatus(`Call connected with ${senderName}`, 'success');
        peerIdInput.value = senderName; // Track who we are talking to
        callButton.disabled = true;
        hangupButton.disabled = false;
        peerIdInput.disabled = true;
    } catch (error) {
        console.error('[handleOffer] Error handling offer or creating answer:', error);
        updateStatus(`Error answering call: ${error.message}`, 'error');
        resetCallState();
    }
}

async function handleAnswer(answer) {
    if (!peerConnection) {
        console.error('[handleAnswer] Received answer but no peer connection exists.');
        return;
    }
    console.log('[handleAnswer] Received answer.');
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('[handleAnswer] Set remote description (answer). Connection should establish.');
        updateStatus(`Call connected with ${peerIdInput.value || 'peer'}.`, 'success');
    } catch (error) {
        console.error('[handleAnswer] Error setting remote description (answer):', error);
        updateStatus(`Error processing answer: ${error.message}`, 'error');
        resetCallState();
    }
}

async function handleCandidate(candidate) {
    if (!peerConnection) {
        console.error('[handleCandidate] PeerConnection not initialized yet. Cannot add candidate.');
        return;
    }
    if (!candidate) {
        console.warn("[handleCandidate] Received empty candidate.");
        return;
    }
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('[handleCandidate] Added received ICE candidate.');
    } catch (error) {
        console.error('[handleCandidate] Error adding received ICE candidate', error);
    }
}

// --- Data Channel Logic ---
function setupDataChannelEventHandlers(channel) {
    if (!channel) return;
    console.log(`[setupDataChannelEventHandlers] Setting up handlers for data channel '${channel.label}'`);
    channel.onopen = () => {
        console.log(`[DataChannel '${channel.label}'] Opened!`);
        if (chatInput) chatInput.disabled = false;
        if (sendButton) sendButton.disabled = false;
        updateStatus('Chat connected!', 'success');
    };
    channel.onclose = () => {
        console.log(`[DataChannel '${channel.label}'] Closed.`);
        if (chatInput) chatInput.disabled = true;
        if (sendButton) sendButton.disabled = true;
        // Don't clear chat messages on close, only on full resetCallState
    };
    channel.onerror = (error) => {
        console.error(`[DataChannel '${channel.label}'] Error:`, error);
        updateStatus(`Chat channel error: ${error.message}`, 'error');
    };
    channel.onmessage = (event) => {
        try {
            const messageData = JSON.parse(event.data);
            console.log(`[DataChannel '${channel.label}'] Message received:`, messageData);
            if (messageData && messageData.senderName && typeof messageData.text !== 'undefined') {
                displayChatMessage(messageData.text, messageData.senderName);
            } else {
                console.warn("[DataChannel onmessage] Received message in unexpected format:", event.data);
                displayChatMessage(`Raw: ${event.data}`, 'Unknown Peer');
            }
        } catch (error) {
            console.error("[DataChannel onmessage] Failed to parse message or invalid JSON:", event.data, error);
            displayChatMessage(`Raw: ${event.data}`, 'Unknown Peer (Error)');
        }
    };
}

function sendMessageViaDataChannel() {
    if (!chatInput || !dataChannel) return;
    const messageText = chatInput.value.trim();
    if (!messageText) return;

    if (dataChannel.readyState === 'open') {
        const messageData = {
            senderName: getDisplayNameForChat(),
            text: messageText
        };
        try {
            dataChannel.send(JSON.stringify(messageData));
            console.log('[sendMessageViaDataChannel] Sent message data:', messageData);
            displayChatMessage(messageText, getDisplayNameForChat()); // Display own message
            chatInput.value = '';
        } catch (error) {
            console.error('[sendMessageViaDataChannel] Error sending message:', error);
            updateStatus('Error sending chat message.', 'error');
        }
    } else {
        console.warn('[sendMessageViaDataChannel] Cannot send, data channel is not open.');
        updateStatus('Chat channel not open.', 'error');
    }
}

function displayChatMessage(messageText, senderName) {
    if (!chatMessagesDiv) return;
    const messageElement = document.createElement('p');
    const ownDisplayName = getDisplayNameForChat();
    let displaySender = senderName;
    let messageClass = 'peer-message';

    if (senderName === ownDisplayName || senderName === currentSignalingId || senderName === myRandomId ) { // Check against various self-identifiers
        displaySender = "Me";
        messageClass = 'my-message';
    }
    messageElement.innerHTML = `<strong>${displaySender}:</strong> ${messageText}`;
    messageElement.classList.add(messageClass);
    chatMessagesDiv.appendChild(messageElement);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}


// --- Call State Management & Cleanup ---
function handleUserHangup() { // User clicks the Hangup button
    console.log('[handleUserHangup] User clicked Hangup button.');
    const targetPeerId = peerIdInput.value; // This should be the name of the other peer
    if (targetPeerId && peerConnection && peerConnection.connectionState !== 'closed' && peerConnection.connectionState !== 'failed') {
        console.log(`[handleUserHangup] Sending hangup signal to ${targetPeerId}`);
        sendMessage({ type: 'hangup', target: targetPeerId });
    } else {
        console.log("[handleUserHangup] Skipping hangup signal (no connection or target).");
    }
    resetCallState();
}

function handleRemoteHangup() { // Hangup signal received from peer
    console.log("[handleRemoteHangup] Handling hangup initiated by remote peer or server.");
    // Don't send another 'hangup' message here
    resetCallState();
}

function closeConnection() {
    console.log("--- [closeConnection] Starting cleanup ---");
    if (dataChannel) {
        console.log("[closeConnection] Closing data channel");
        dataChannel.onopen = null; dataChannel.onclose = null; dataChannel.onerror = null; dataChannel.onmessage = null;
        if (dataChannel.readyState !== 'closed') dataChannel.close();
        dataChannel = null;
    }
    if (peerConnection) {
        console.log("[closeConnection] Closing peer connection. Current state:", peerConnection.connectionState);
        peerConnection.getSenders().forEach(sender => sender.track?.stop());
        peerConnection.ontrack = null; peerConnection.onicecandidate = null; peerConnection.oniceconnectionstatechange = null;
        peerConnection.onconnectionstatechange = null; peerConnection.onsignalingstatechange = null;
        peerConnection.ondatachannel = null; peerConnection.onnegotiationneeded = null;
        if (peerConnection.signalingState !== 'closed') peerConnection.close();
        peerConnection = null;
        console.log("[closeConnection] peerConnection set to null.");
    }
    if (remoteVideo) remoteVideo.srcObject = null;
    remoteStream = null;

    // Option A: Stop local tracks (forces new getUserMedia for next call)
    if (localStream) {
        console.log("[closeConnection] Stopping local stream tracks");
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        if (localVideo) localVideo.srcObject = null;
        if (startCamButton) startCamButton.disabled = false;
        if (callButton) callButton.disabled = true; // Must restart cam
        hasLocalVideo = false;
        console.log("[closeConnection] localStream stopped and nulled.");
    }
    console.log("--- [closeConnection] Finished ---");
}

function resetCallState() {
    console.log("--- [resetCallState] Starting ---");
    closeConnection(); // Always ensure resources are released

    if (callButton) callButton.disabled = true; // Requires cam restart
    if (startCamButton && localStream === null) startCamButton.disabled = false; // Enable if stream was stopped
    else if (startCamButton) startCamButton.disabled = true; // Cam already on

    if (hangupButton) hangupButton.disabled = true;
    if (peerIdInput) {
        peerIdInput.disabled = false;
        // peerIdInput.value = ''; // Optional: clear target peer input
    }

    clearStatus();
    updateUserInfoDisplay(); // Refresh user info display

    if (chatInput) chatInput.disabled = true;
    if (sendButton) sendButton.disabled = true;
    if (chatMessagesDiv) chatMessagesDiv.innerHTML = ''; // Clear chat history

    if (localVideo && !localStream) { // Reset local video appearance if stream was stopped
        localVideo.style.backgroundColor = '';
        localVideo.poster = '';
    }
    if (remoteVideo) { // Reset remote video appearance
        remoteVideo.style.backgroundColor = '';
        remoteVideo.poster = '';
    }
    console.log("--- [resetCallState] Finished ---");
}

function updateStatus(message, type = 'info') {
    if (!statusMessageEl) return;
    statusMessageEl.textContent = message;
    statusMessageEl.className = `status ${type}`;
    // Optionally auto-clear info/success messages after a delay
    if (type === 'info' || type === 'success') {
        setTimeout(() => {
            if (statusMessageEl.textContent === message) clearStatus(); // Only clear if it's still the same message
        }, 5000); // Clear after 5 seconds
    }
}

function clearStatus() {
    if (!statusMessageEl) return;
    statusMessageEl.textContent = '';
    statusMessageEl.className = 'status';
}

function updateRemoteVideoAppearance() {
    if (!remoteStream || !remoteVideo) return;
    const videoTracks = remoteStream.getVideoTracks();
    const audioTracks = remoteStream.getAudioTracks();

    if (videoTracks.length > 0) {
        remoteVideo.style.backgroundColor = '';
        remoteVideo.poster = '';
    } else if (audioTracks.length > 0) { // Audio only
        remoteVideo.style.backgroundColor = '#333';
        // remoteVideo.poster = 'path/to/audio-only-avatar.png';
    } else { // No tracks
        remoteVideo.style.backgroundColor = '';
        remoteVideo.poster = '';
    }
}

// --- Initial UI State ---
if (callButton) callButton.disabled = true;
if (hangupButton) hangupButton.disabled = true;
if (chatInput) chatInput.disabled = true;
if (sendButton) sendButton.disabled = true;
clearStatus();