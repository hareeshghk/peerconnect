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
let myId = 'user-' + Math.random().toString(36).substr(2, 9); // Simple unique ID
console.log('My ID:', myId);
// Add an element to display the ID or use the console

startCamButton.onclick = async () => {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        localVideo.srcObject = localStream;
        startCamButton.disabled = true;
        callButton.disabled = false; // Enable call button only after cam starts
        console.log('Local stream started');
    } catch (error) {
        console.error('Error accessing media devices.', error);
        alert('Could not access camera/microphone: ' + error.message);
    }
};