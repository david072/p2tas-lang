
import * as vscode from 'vscode';

const tokens: { [command: string]: string[]; } = {
    "start": ["now","save","map","next","cm"],
    "autojump": ["on","off"],
    "absmov": ["off"],
    "strafe": ["none","off","vec","ang","veccam","max","keep","forward","forwardvel","left","right"],
    "setang": [],
    "autoaim": ["off"],
    "decel": ["off"]
};

const activeToolsDisplayDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
        color: new vscode.ThemeColor("tab.inactiveForeground"),
        margin: "10px"
    }
});

var activeToolsDisplayDecoration: vscode.DecorationOptions & vscode.DecorationRenderOptions = {
    range: new vscode.Range(new vscode.Position(0, 0),
        (vscode.window.activeTextEditor?.document?.lineAt(0)?.range?.end || new vscode.Position(0, 0)))
}

export function activate(context: vscode.ExtensionContext) {

	const tool_keyword_provider = vscode.languages.registerCompletionItemProvider('p2tas', {

		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {

            let completionItems = [];
            for (const command in tokens) {
                completionItems.push(new vscode.CompletionItem(command));
            }

			// return all completion items as array
			return completionItems;
		}
	});
    
    context.subscriptions.push(tool_keyword_provider);

    for (const command in tokens) {
        let provider = vscode.languages.registerCompletionItemProvider('p2tas',
            {
                provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {

                    const linePrefix = document.lineAt(position).text.substr(0, position.character);
                    if (!linePrefix.endsWith(command + " ")) {
                        return undefined;
                    }

                    let completions = [];
                    for (const arg_idx in tokens[command]) {
                        completions.push(new vscode.CompletionItem(tokens[command][arg_idx], vscode.CompletionItemKind.Method));
                    }
    
                    return completions;
                }
            },
            ' '
        );

        context.subscriptions.push(provider);
    }

    const hoverProvider = vscode.languages.registerHoverProvider('p2tas', {
        provideHover(document: vscode.TextDocument, position: vscode.Position) {
            const hoveredLineText = document.lineAt(position.line).text.trim();

            if (!hoveredLineText.startsWith('//') && position.character < hoveredLineText.indexOf('>')) {
                const [tick, loopStartTick] = getTickForLine(position.line, document);
                return {
                    contents: [`Tick: ${tick}${loopStartTick ? ` (Repeat start: ${loopStartTick})` : ""}`]
                };
            }

            return {
                contents: []
            };
        }
    });

    context.subscriptions.push(hoverProvider);

    vscode.commands.registerCommand("p2tas-lang.relativeFromAbsoluteTick", async () => {
        var editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No currently active editor");
            return;
        };

        const input = await vscode.window.showInputBox({ placeHolder: "Absolute Tick", ignoreFocusOut: true });
        if (!input) return;

        const inputTick = +input;
        if (!inputTick) {
            vscode.window.showErrorMessage("Please input a valid number!");
            return;
        }

        editor.edit(editBuilder => {
            const cursorPos = editor!.selection.active;
            var previousFramebulk = cursorPos.line;

            const [previousFramebulkTick, loopStartTick] = getTickForLine(previousFramebulk, editor!.document);
            if (loopStartTick) {
                // Command was used inside a repeat block. Cancelling
                vscode.window.showErrorMessage("This command can't be used inside a repeat block.")
                return;
            }

            const newTick = inputTick - previousFramebulkTick;

            if (newTick <= 0) {
                vscode.window.showErrorMessage(`Expected tick greater than ${previousFramebulkTick}`);
                return;
            }

            // Insert if there is no selection, otherwise, replace
            if (editor!.selection.isEmpty) editBuilder.insert(cursorPos, `+${newTick.toString()}>||||`);
            else editBuilder.replace(editor!.selection, `+${newTick.toString()}>||||`);
        });
    });

    // Variable used to not refresh multiple times on the same line in onDidChangeTextEditorSelection
    var previousLine = -1;

    vscode.window.onDidChangeTextEditorSelection(event => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const cursorPos = event.selections[0].active;

        if (previousLine === cursorPos.line) {
            // Refresh the ticks if you change your selection before the '>' !!!UNOPTIMISED!!!!
            if (cursorPos.character <= editor.document.lineAt(cursorPos.line).text.indexOf('>')) {
                // FIXME: Maybe don't re-compute everything when something is changed
                drawActiveToolsDisplay(cursorPos, editor.document);
                return;
            }
            else return;
        }

        drawActiveToolsDisplay(cursorPos, editor.document);
        previousLine = cursorPos.line;
    });

    drawActiveToolsDisplay(vscode.window.activeTextEditor!.selection.active, vscode.window.activeTextEditor!.document);
}

function drawActiveToolsDisplay(cursorPos: vscode.Position, document: vscode.TextDocument) {
    const tools = getToolsForLine(cursorPos.line, document).join(', ');
    activeToolsDisplayDecoration = {
        range: new vscode.Range(cursorPos, document.lineAt(cursorPos.line).range.end),
        renderOptions: {
            after: {
                contentText: tools.length > 0 ? `Active tools: ${tools}` : "",
                textDecoration: ";font-size:11px",
                fontWeight: ";font-weight:lighter"
            }
        }
    };
    vscode.window.activeTextEditor!.setDecorations(activeToolsDisplayDecorationType, [activeToolsDisplayDecoration]);
}

function getToolsForLine(line: number, document: vscode.TextDocument): string[] {
    // FIXME: Take repeat blocks + multiline comments into account

    // Helper class used to count ticks, e.g. for lerped setang.
    // ticksRemaining is decreased every framebulk, depending it's value.
    // After it has reached 0, the index-th element of the result array is removed.
    class Counter {
        index: number;
        startTick: number;
        totalTicks: number;
        ticksRemaining: number;

        constructor(index: number, startTick: number, ticks: number) {
            this.index = index;
            this.startTick = startTick;
            this.totalTicks = ticks;
            this.ticksRemaining = ticks;
        }
    }

    function removeResult(index: number) {
        result.splice(index, 1);
        for (var i = 0; i < counters.length; i++) {
            if (counters[i].index > index) counters[i].index--;
            else if (counters[i].index === index) counters.splice(i, 1);
        }
    }

    var result: string[] = [];
    var counters: Counter[] = [];
    for (let i = 0; i <= line; i++) {
        const lineText = document.lineAt(i).text.trim();
        if (lineText.startsWith('start') || lineText.startsWith('//') || lineText.length === 0) continue;

        for (let i = 0; i < counters.length; i++) {
            const counter = counters[i];

            if (lineText.startsWith('+')) counter.ticksRemaining -= +lineText.substring(1, lineText.indexOf('>'));
            else counter.ticksRemaining = counter.totalTicks - (+lineText.substring(0, lineText.indexOf('>')) - counter.startTick);

            // Remove counter since it reached 0
            if (counter.ticksRemaining <= 0) {
                // Don't remove the result since autoaim doesn't turn off automatically
                if (result[counter.index] === "autoaim")
                    counters.splice(i, 1);
                else
                    // removeResult removes the counter as well
                    removeResult(counter.index);

                i--;
            }
        }

        // We need to decrement the counters, changes in the line you are hovering over should be ignored
        if (i === line) break;

        // Only if the line has four "|" in it
        if (lineText.split("|").length - 1 === 4) {
            const tools = lineText.substring(lineText.lastIndexOf('|') + 1).split(';').map((value, index) => value.trim());
            for (const tool of tools) {
                // Tool arguments e.g.: [autoaim, off]
                const args = tool.split(' ');
                if (args.length < 2) continue;

                if (args[0] === "setang" && args.length === 4) {
                    counters.push(new Counter(result.length, getTickForLine(i, document)[0], +(args[args.length - 1])));
                    result.push(args[0]);
                    continue;
                }
                else if (args[0] === "autoaim" && args.length === 5) {
                    counters.push(new Counter(result.length, getTickForLine(i, document)[0], +(args[args.length - 1])));
                    result.push(args[0]);
                    continue;
                }
                else if (args[0] === "decel") {
                    if (result.indexOf(args[0]) === -1)
                        result.push(`(${args[0]})`);
                    continue;
                }

                if (args[1] === "off")
                    // Remove tool from the list
                    removeResult(result.indexOf(args[0]));
                else {
                    // Tool is already in the list
                    if (result.indexOf(args[0]) !== -1) continue;
                    result.push(args[0]);
                }
            }
        }
    }

    for (var counter of counters)
        result[counter.index] += ` (${counter.ticksRemaining} ticks left)`;

    return result;
}

// Returns the tick count and the tick count of the start of a repeat block
// FIXME: This is dumb
function getTickForLine(line: number, document: vscode.TextDocument): [number, number | undefined] {
    const targetLine = document.lineAt(line).text;

    if (targetLine.trim().length !== 0 && !targetLine.startsWith('+'))
        return [+targetLine.substring(0, targetLine.indexOf('>')), undefined];

    var tickCount = 0;
    var loopStartTick = undefined;
    var startedOutsideOfLoop = false;
    for (var i = line; i >= 0; i--) {
        const lineText = document.lineAt(i).text;
        if (lineText.startsWith('start') || lineText.startsWith('//') || lineText.trim().length === 0) continue;

        if (lineText.startsWith('end')) {
            startedOutsideOfLoop = true;
            // Evaluate the number of ticks passing in one loop iteration
            var tickCountInLoop = 0;
            while (!document.lineAt(--i).text.startsWith('repeat') && i >= 0) {
                const lineText = document.lineAt(i).text;
                tickCountInLoop += +(lineText.substring(1, lineText.indexOf('>')));
            }

            // Get the number of iterations of the repeat block
            const iterations = +document.lineAt(i).text.substring(6);
            tickCount += tickCountInLoop * iterations;
            continue;
        }
        else if (lineText.startsWith('repeat')) {
            // Save the current tick for later use, but only if we started inside a repeat block
            if (!startedOutsideOfLoop)
                loopStartTick = tickCount;
            continue;
        }

        if (lineText.startsWith('+')) tickCount += +(lineText.substring(1, lineText.indexOf('>')));
        else {
            tickCount += +(lineText.substring(0, lineText.indexOf('>')));
            break;
        }
    }

    if (loopStartTick)
        loopStartTick = tickCount - loopStartTick;

    return [tickCount, loopStartTick];
}
