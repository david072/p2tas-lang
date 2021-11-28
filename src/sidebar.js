// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.

(function () {
    const vscode = acquireVsCodeApi();

    const statusText = (document.getElementById("status"));

    const contentDiv = (document.getElementById('main-content'));
    const playButton = (document.getElementById("play-button"));
    const stopButton = (document.getElementById("stop-button"));
    const disconnectButton = (document.getElementById("disconnect-button"));

    playButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'playTas' });
    });

    stopButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'stopTas' });
    });

    disconnectButton.addEventListener('click', () => {
        vscode.postMessage({ type: disconnectButton.innerText === "Disconnect" ? 'disconnect' : 'connect' });
    });

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.status) {
            case 'connected': {
                statusText.innerText = "Connected!";
                statusText.style.color = 'green';
                // Set to default
                contentDiv.style.display = 'initial';

                disconnectButton.style.display = 'initial';
                disconnectButton.innerText = "Disconnect";
                break;
            }
            case 'disconnected': {
                statusText.innerText = "Not connected!";
                statusText.style.color = 'red';
                // Hide the main content
                contentDiv.style.display = 'none';
                
                disconnectButton.innerText = "Reconnect";
                break;
            }
        }
    });

}())