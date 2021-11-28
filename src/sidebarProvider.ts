import * as vscode from "vscode";
import { createConnection, Socket } from 'net';

export class SidebarProvider implements vscode.WebviewViewProvider {
    _view?: vscode.WebviewView;
    filename?: string;

    constructor(private readonly _extensionUri: vscode.Uri, private tcpClient: Socket) { }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,

            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case "playTas": {
                    if (this.filename)
                        this.sendToGame(`play ${this.filename!}`);
                    break;
                }
                case "stopTas": {
                    this.sendToGame('stop');
                    break;
                }
                case "connect": {
                    this.connectToGame();
                    break;
                }
                case "disconnect": {
                    this.tcpClient.destroy();
                    this._view?.webview.postMessage({ status: 'disconnected' });
                    break;
                }
                case "onInfo": {
                    if (!data.value) {
                        return;
                    }
                    vscode.window.showInformationMessage(data.value);
                    break;
                }
                case "onError": {
                    if (!data.value) {
                        return;
                    }
                    vscode.window.showErrorMessage(data.value);
                    break;
                }
            }
        });

        this.connectToGame();
    }

    private connectToGame(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!this.tcpClient || !this.tcpClient.remoteAddress || this.tcpClient.destroyed) {
                this.tcpClient = createConnection(64253, 'localhost', () => {
                    this._view?.webview.postMessage({ status: 'connected' });
                    resolve();
                });
            }
            else resolve();
        });
    }

    private async sendToGame(message: string) {
        // Should never actually matter but I'm putting it here for safety
        await this.connectToGame();

        this.tcpClient.write(message, (error) => {
            if (error)
                vscode.window.showErrorMessage(`Error sending to server: ${error.message}`);
        });
    }

    public setFilename(filename?: string) {
        if (!filename)
            this._view?.webview?.postMessage({ canPlay: false });
        else
            this._view?.webview?.postMessage({ canPlay: false });

        this.filename = filename;
    }

    public revive(panel: vscode.WebviewView) {
        this._view = panel;
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "media", "vscode.css")
        );

        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "media", "reset.css")
        );

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "src", "sidebar.js")
        );

        // Use a nonce to only allow a specific script to be run.
        const nonce = getNonce();

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <!--
                Use a content security policy to only allow loading images from https or from our extension directory,
                and only allow scripts that have a specific nonce.
            -->
            <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' 
                ${webview.cspSource}; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleResetUri}" rel="stylesheet">
            <link href="${styleVSCodeUri}" rel="stylesheet">
        </head>

        <body>
            <div>
                <h3 style="display:inline-block;">Status: </h3>
                <h3 style="display:inline-block;color:red" id="status">Connecting...</h3>
            </div>

            <div id="main-content" style="display:none">
                <button id="play-button">Play current TAS</button>
                <button id="stop-button">Stop the playing TAS</button>
            </div>

            <button id="disconnect-button" style="display:none">Disconnect</button>

            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>
        `;
    }
}

export function getNonce() {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
