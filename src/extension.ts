
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
            const hoveredLineText = document.lineAt(position.line).text;

            if (!hoveredLineText.startsWith('//') && position.character < hoveredLineText.indexOf('>')) {
                const [tick, loopStartTick] = getTickForLine(position.line, document);
                return {
                    contents: [`Tick: ${tick}${loopStartTick !== undefined ? ` (Repeat start: ${loopStartTick})` : ""}`]
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
}

// Returns the tick count and the tick count of the start of a repeat block
// FIXME: This is dumb
function getTickForLine(line: number, document: vscode.TextDocument): [number, number | undefined] {
    const targetLine = document.lineAt(line).text.trim();

    if (targetLine.trim().length !== 0 && !targetLine.startsWith('+'))
        return [+targetLine.substring(0, targetLine.indexOf('>')), undefined];

    var tickCount = 0;
    var loopStartTick = undefined;
    var startedOutsideOfLoop = false;
    var multilineCommentsOpen = 0;
    for (var i = line; i >= 0; i--) {
        var lineText = document.lineAt(i).text.trim();
        if (lineText.startsWith('start') || lineText.startsWith('//') || lineText.length === 0) continue;

        [lineText, multilineCommentsOpen] = withMultilineComments(lineText, multilineCommentsOpen, i);
        if (multilineCommentsOpen > 0 || lineText.length === 0) continue;

        if (lineText.startsWith('end')) {
            startedOutsideOfLoop = true;
            
            const [ticksPassingInLoop, indexOfRepeatStatement] = getTicksPassingLoop(document, i);
            // Continue after the loop
            i = indexOfRepeatStatement;
            tickCount += ticksPassingInLoop;
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

// Params: document: the document in which to search, index: the index of the end line of the repeat block
// Returns: the number of ticks, the index of the line of the repeat statement that it ended on
function getTicksPassingLoop(document: vscode.TextDocument, index: number): [number, number] {
    var tickCountInLoop = 0;
    while (!document.lineAt(--index).text.trim().startsWith('repeat') && index >= 0) {
        const lineText = document.lineAt(index).text.trim();
        if (lineText.startsWith('start') || lineText.startsWith('//') || lineText.length === 0) continue;

        // Nested loop found. Using recursion to get the ticks passing in that loop
        if (lineText.startsWith('end')) {
            const [ticksPassing, indexOfRepeatStatement] = getTicksPassingLoop(document, index);
            index = indexOfRepeatStatement;
            tickCountInLoop += ticksPassing;
            continue;
        }

        tickCountInLoop += +(lineText.substring(1, lineText.indexOf('>')));
    }

    // Get the number of iterations of the repeat block
    const iterations = +document.lineAt(index).text.trim().substring(6);

    if (iterations !== 0)
        return [tickCountInLoop * iterations, index];
    // Zero iterations => This repeat block is never going to be executed
    else
        return [0, index];
}

function withMultilineComments(lineText: string, multilineCommentsOpen: number, line: number): [string, number] {
    const multilineCommentOpenToken = lineText.indexOf('/*');
        const multilineCommentCloseToken = lineText.indexOf('*/');
        if (multilineCommentOpenToken !== -1 && multilineCommentCloseToken === -1) {
            multilineCommentsOpen--;
            if (multilineCommentsOpen < 0) {
                // Commment was opened but never closed
                // FIXME: Show error line under the token. This can be done using a diagnostic collection, however,
                //  this should be checked for every time something is changed in the file, and not suddently appear when hovering.
                vscode.window.showErrorMessage(`Comment was opened but never closed! (line: ${++line}, column: ${multilineCommentOpenToken})`);
                return ["", 0];
            }

            lineText = lineText.substring(0, multilineCommentOpenToken);
        }
        if (lineText.indexOf('*/') !== -1) {
            if (multilineCommentOpenToken === -1) {
                multilineCommentsOpen++;
                lineText = lineText.substring(multilineCommentCloseToken + 2);
            }
            else
                lineText = lineText.substring(multilineCommentOpenToken + 2, multilineCommentCloseToken);
        }

    return [lineText, multilineCommentsOpen];
}
