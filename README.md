# peerconnect

## Description
Creating peer to peer connection over browser using WebRTC protocol to do video, audio calls along with chat.

## How to run

### Prerequisites:
1. To run this project we want node service here https://github.com/hareeshghk/websocket-signalling-server runnin in some location which is reachable from place where you want to run this. I have provided steps in readme on how to run this in azure and get the dns name or you can run the node service locally on your machine as well.
2. This can be run from chrome browser either on windows, linux as well. Works on phone browser too.



### Steps to run.
1. Clone this repository on your machine.
2. In main.js file modify this line to your signalling server location from prerequiste
```
const signalServerUrl = 'wss://<azure app name>.azurewebsites.net';
```
Note: If you are running the signalling server locally then replace with this
```
const signalServerUrl = 'wss://127.0.0.1:8080';
```
3. Then open broswer and then open file index.html file from this cloned respository. From there usage is self explanatory.
4. Sample image of how app looks like

![Screenshot from 2025-05-10 22-47-30](https://github.com/user-attachments/assets/de5cd38b-94e8-4230-b723-e5bdb46a4be9)


