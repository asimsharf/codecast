import AbstractRunner from "../abstract_runner";
import {Stepper, StepperState} from "../index";
import {StepperContext} from "../api";
import {Block, BlockType} from "../../task/blocks/blocks";
import {Codecast} from "../../index";
import {AnalysisSnapshot} from "../analysis/analysis";
import {fetchLatestBlocklyAnalysis} from "./analysis";
import log from "loglevel";

export default class BlocklyRunner extends AbstractRunner {
    private context;
    private interpreters = [];
    private isRunningInterpreter = [];
    private toStopInterpreter = [];
    private interpreterEnded = [];
    private availableBlocks = [] as Block[];
    private quickAlgoCallsExecutor;
    private executeOnResolve;
    private executeOnReject;
    private currentBlockId = null;

    private hasActions = false;
    private nbActions = 0;
    private scratchMode = false;
    private delayFactory
    private resetDone = false;
    private oneStepDone = false;

    // Node status
    public _code = '';
    private nbNodes = 1;
    private curNode = 0;
    private nodesReady = [];
    private waitingOnReadyNode = false;

    // Iteration limits
    private maxIter = 400000;
    private maxIterWithoutAction = 500;
    private allowStepsWithoutDelay = 0;

    // Counts the call stack depth to know when to reset it
    private stackCount = 0;
    private stackResetting = false;

    // During step-by-step mode
    private _stepInProgress = false;
    private stepMode = false;
    private nextCallback;

    private localVariables = {};

    // TODO: use our own translation system?
    private strings;

    // First highlightBlock of this run
    private firstHighlight = true;
    public _isFinished: boolean = false;

    constructor(context, languageStrings) {
        super(context);
        this.context = context;
        this.strings = languageStrings;
        this.scratchMode = context.blocklyHelper ? context.blocklyHelper.scratchMode : false;
        this.delayFactory = new window.DelayFactory();
    }

    public static needsCompilation(): boolean {
        return false;
    }

    private valueToString(value) {
        if(this.interpreters.length == 0) {
            return value.toString(); // We "need" an interpreter to access ARRAY prototype
        }
        let itp = this.interpreters[0];
        if(itp.isa(value, itp.ARRAY)) {
            let strs = [];
            for(let i = 0; i < value.properties.length; i++) {
                strs[i] = this.valueToString(value.properties[i]);
            }
            return '['+strs.join(', ')+']';
        } else if(value && value.toString) {
            return value.toString();
        } else {
            return "" + value;
        }
    };

    reportBlockValue(id, value, varName) {
        // Show a popup displaying the value of a block in step-by-step mode
        if (this.context.display && this.stepMode) {
            log.getLogger('blockly_runner').debug('report block value', {id, value, varName}, this.strings);

            // Fix for Scratch because in ext/scratch/fixes.js, we report the value as varName = varValue.
            if ('string' === typeof value && -1 !== value.indexOf('=')) {
                [varName, value] = value.split('=').map(e => {
                    let trimmed = e.trim();

                    return trimmed.match(/^\d+$/) ? Number(trimmed) : trimmed;
                });
            }

            let displayStr = this.valueToString(value);
            if(value && value.type == 'boolean') {
                displayStr = value.data ? this.context.strings.valueTrue : this.context.strings.valueFalse;
            }
            if(varName == '@@LOOP_ITERATION@@') {
                displayStr = this.context.strings.loopIteration + ' ' + displayStr;
            } else if(varName) {
                varName = varName.toString();
                // Get the original variable name
                for(let dbIdx in window.Blockly.JavaScript.variableDB_.db_) {
                    if(window.Blockly.JavaScript.variableDB_.db_[dbIdx] == varName) {
                        varName = dbIdx.substring(0, dbIdx.length - 9);
                        // Get the variable name with the right case
                        for(let i=0; i<this.context.blocklyHelper.workspace.variableList.length; i++) {
                            let varNameCase = this.context.blocklyHelper.workspace.variableList[i];
                            if(varName.toLowerCase() == varNameCase.toLowerCase()) {
                                varName = varNameCase;
                                break;
                            }
                        }
                        break;
                    }
                }
                this.localVariables = {
                    ...this.localVariables,
                    [varName]: value,
                }
                displayStr = varName + ' = ' + displayStr;
            }

            this.context.blocklyHelper.workspace.reportValue(id, displayStr);
        }
        return value;
    };

    waitDelay(callback, value, delay) {
        if (delay > 0) {
            this.stackCount = 0;
            this.delayFactory.createTimeout("wait" + this.context.curNode + "_" + Math.random(), () => {
                this.noDelay(callback, value);
            },
            delay
            );
            this.allowStepsWithoutDelay = Math.min(this.allowStepsWithoutDelay + Math.ceil(delay/10), 100);
        } else {
            this.noDelay(callback, value);
        }
    };

    waitEvent(callback, target, eventName, func) {
        this.stackCount = 0;
        let listenerFunc = null;
        listenerFunc = (e) => {
            target.removeEventListener(eventName, listenerFunc);
            this.noDelay(callback, func(e));
        };
        target.addEventListener(eventName, listenerFunc);
    };

    waitCallback(callback) {
        // Returns a callback to be called once we can continue the execution
        //this.stackCount = 0;
        return (value) => {
            this.noDelay(callback, value);
        }
    };

    noDelay(callback, value = null) {
        log.getLogger('blockly_runner').debug('Call no delay with values', callback, value);
        let primitive = undefined;
        if (value !== undefined) {
            if(value && (typeof value.length != 'undefined' ||
                typeof value === 'object')) {
                // It's an array, create a primitive out of it
                primitive = this.interpreters[this.context.curNode].nativeToPseudo(value);
            } else {
                primitive = value;
            }
        }
        let infiniteLoopDelay = false;
        if(this.context.allowInfiniteLoop) {
            if(this.allowStepsWithoutDelay > 0) {
                this.allowStepsWithoutDelay -= 1;
            } else {
                infiniteLoopDelay = true;
            }
        }
        if(this.stackCount > 100 || (infiniteLoopDelay && this.stackCount > 5)) {
            // In case of an infinite loop, add some delay to slow down a bit
            let delay = infiniteLoopDelay ? 50 : 0;

            this.stackCount = 0;
            this.stackResetting = true;
            this.delayFactory.createTimeout("wait_" + Math.random(), () => {
                this.stackResetting = false;
                callback(primitive);
                // this.runSyncBlock();
            }, delay);
        } else {
            this.stackCount += 1;
            callback(primitive);
            // this.runSyncBlock();
        }
    };

    initInterpreter(interpreter, scope) {
        const self = this;

        // Wrapper for async functions
        let createAsync = (func) => {
            return function () {
                let args = [];
                for(let i=0; i < arguments.length-1; i++) {
                    if(typeof arguments[i] != 'undefined' && arguments[i].isObject) {
                        args.push(interpreter.pseudoToNative(arguments[i]));
                    } else {
                        args.push(arguments[i]);
                    }
                }
                args.push(arguments[arguments.length-1]);
                func.apply(func, args);
            };
        };

        let makeHandler = (code, generatorName, blockName, category) => {
            // For commands belonging to the "actions" category, we count the
            // number of actions to put a limit on steps without actions
            return function () {
                if ('actions' === category) {
                    self.nbActions += 1;
                }

                let args = [...arguments].slice(0, arguments.length - 1);
                let resolve = arguments[arguments.length - 1];
                let result;

                try {
                    result = self.quickAlgoCallsExecutor(generatorName, blockName, args);
                    if (result instanceof Promise) {
                        result
                            .then(resolve)
                            .catch((e) => { Codecast.runner.onError(e) })
                            .finally(() => {
                                self.runSyncBlock();
                            });
                    }

                    return result;
                } catch (e) {
                    Codecast.runner.onError(e);
                }
            };
        };

        let blocksByGeneratorName: {[generatorName: string]: Block[]} = {};
        for (let block of this.availableBlocks) {
            if (block.generatorName) {
                if (!(block.generatorName in blocksByGeneratorName)) {
                    blocksByGeneratorName[block.generatorName] = [];
                }
                blocksByGeneratorName[block.generatorName].push(block);
            }
        }

        for (let [generatorName, blocks] of Object.entries(blocksByGeneratorName)) {
            for (let block of blocks.filter(block => block.type === BlockType.Function)) {
                const {code, generatorName, name, category, type} = block;
                let handler;
                if (category === 'actions') {
                    this.hasActions = true;
                }

                handler = makeHandler(code, generatorName, name, category);
                interpreter.setProperty(scope, code, interpreter.createAsyncFunction(createAsync(handler)));
            }
        }

        let makeNative = (func) => {
            return function() {
                let value = func.apply(func, arguments);
                let primitive = undefined;
                if (value != undefined) {
                    if(typeof value.length != 'undefined') {
                        // It's an array, create a primitive out of it
                        primitive = self.interpreters[self.context.curNode].nativeToPseudo(value);
                    } else {
                        primitive = value;
                    }
                }
                return primitive;
            };
        }

        if(window.Blockly.JavaScript.externalFunctions) {
            for(let name in window.Blockly.JavaScript.externalFunctions) {
                interpreter.setProperty(scope, name, interpreter.createNativeFunction(makeNative(window.Blockly.JavaScript.externalFunctions[name])));
            }
        }

        interpreter.setProperty(scope, "program_end", interpreter.createAsyncFunction(createAsync((callback) => {
            this.program_end(callback);
        })));

        let highlightBlock = (id, callback) => {
            id = id ? id.toString() : '';
            // We always execute directly the first highlightBlock
            if (this.firstHighlight) {
                this.firstHighlight = false;
                callback();
            } else {
                // Interrupt here for step mode, allows to stop before each
                // instruction
                log.getLogger('blockly_runner').debug('highlight, stop here');
                this.nextCallback = callback;
                this.currentBlockId = id;
                this._stepInProgress = false;
                if (this.executeOnResolve) {
                    log.getLogger('blockly_runner').debug('do execute on resolve');
                    this.executeOnResolve();
                }
            }
        }

        // Add an API function for highlighting blocks.
        interpreter.setProperty(scope, 'highlightBlock', interpreter.createAsyncFunction(createAsync(highlightBlock)));

        // Add an API function to report a value.
        interpreter.setProperty(scope, 'reportBlockValue', interpreter.createNativeFunction((id, value, varName) => {
            return this.reportBlockValue(id, value, varName);
        }));
    };

    program_end(callback) {
        this._isFinished = true;
        log.getLogger('blockly_runner').debug('program end, is finished = true');
        this._stepInProgress = false;
        callback();
        if (this.executeOnResolve) {
            log.getLogger('blockly_runner').debug('do execute on resolve');
            this.executeOnResolve();
        }
    };

    public isStuck(stepperState: StepperState): boolean {
        return stepperState.isFinished;
    }

    stop() {
        for (let iInterpreter = 0; iInterpreter < this.interpreters.length; iInterpreter++) {
            if (this.isRunningInterpreter[iInterpreter]) {
                this.toStopInterpreter[iInterpreter] = true;
                this.isRunningInterpreter[iInterpreter] = false;
            }
        }

        // if(this.scratchMode) {
        //     window.Blockly.DropDownDiv.hide();
        //     this.context.blocklyHelper.highlightBlock(null);
        // }

        this.nbActions = 0;
        this._stepInProgress = false;
        this.stepMode = false;
        this.firstHighlight = true;
    };

    runSyncBlock() {
        log.getLogger('blockly_runner').debug('run sync block', this._stepInProgress);
        this.resetDone = false;
        this._stepInProgress = true;
        this.oneStepDone = false;
        // Handle the callback from last highlightBlock
        if(this.nextCallback) {
            this.nextCallback();
            this.nextCallback = null;
        }

        try {
            if(this.stepMode && this.oneStepDone) {
                this._stepInProgress = false;
                return;
            }
            let iInterpreter = this.curNode;
            this.context.setCurNode(iInterpreter);
            if (this.context.infos.checkEndEveryTurn) {
                this.context.infos.checkEndCondition(this.context, false);
            }
            let interpreter = this.interpreters[iInterpreter];
            let wasPaused = interpreter.paused_;
            while(!this.context.programEnded[iInterpreter]) {
                if(!this.context.allowInfiniteLoop &&
                    (this.context.curSteps[iInterpreter].total >= this.maxIter || this.context.curSteps[iInterpreter].withoutAction >= this.maxIterWithoutAction)) {
                    break;
                }
                if (!interpreter.step() || this.toStopInterpreter[iInterpreter]) {
                    log.getLogger('blockly_runner').debug('interpreter not running');
                    this.isRunningInterpreter[iInterpreter] = false;
                    return;
                }
                if (interpreter.paused_) {
                    log.getLogger('blockly_runner').debug('interpreter paused', this._stepInProgress);
                    this.oneStepDone = !wasPaused;
                    return;
                }
                this.context.curSteps[iInterpreter].total++;
                if(this.context.curSteps[iInterpreter].lastNbMoves != this.nbActions) {
                    this.context.curSteps[iInterpreter].lastNbMoves = this.nbActions;
                    this.context.curSteps[iInterpreter].withoutAction = 0;
                } else {
                    this.context.curSteps[iInterpreter].withoutAction++;
                }
            }

            if (!this.context.programEnded[iInterpreter] && !this.context.allowInfiniteLoop) {
                if (this.context.curSteps[iInterpreter].total >= this.maxIter) {
                    this.isRunningInterpreter[iInterpreter] = false;
                    throw this.context.blocklyHelper.strings.tooManyIterations;
                } else if(this.context.curSteps[iInterpreter].withoutAction >= this.maxIterWithoutAction) {
                    this.isRunningInterpreter[iInterpreter] = false;
                    throw this.context.blocklyHelper.strings.tooManyIterationsWithoutAction;
                }
            }

            if(this.context.programEnded[iInterpreter] && !this.interpreterEnded[iInterpreter]) {
                this.interpreterEnded[iInterpreter] = true;
            }

            log.getLogger('blockly_runner').debug('end run sync block');
        } catch (e: any) {
            console.error(e);
            log.getLogger('blockly_runner').debug('error during run');
            this.context.onExecutionEnd && this.context.onExecutionEnd();
            this._stepInProgress = false;

            for (let iInterpreter = 0; iInterpreter < this.interpreters.length; iInterpreter++) {
                this.isRunningInterpreter[iInterpreter] = false;
                this.context.programEnded[iInterpreter] = true;
            }

            let message = e.message || e.toString();

            // Translate "Unknown identifier" message
            if(message.substring(0, 20) == "Unknown identifier: ") {
                let varName = message.substring(20);
                // Get original variable name if possible
                for(let dbIdx in window.Blockly.JavaScript.variableDB_.db_) {
                    if(window.Blockly.JavaScript.variableDB_.db_[dbIdx] == varName) {
                        varName = dbIdx.substring(0, dbIdx.length - 9);
                        break;
                    }
                }
                message = this.context.blocklyHelper.strings.uninitializedlet + ' ' + varName;
            }

            if(message.indexOf('undefined') != -1) {
                console.error(e)
                message += '. ' + this.context.blocklyHelper.strings.undefinedMsg;
            }

            if ((this.context.nbTestCases != undefined) && (this.context.nbTestCases > 1)) {
                if (this.context.success) {
                    message = this.context.messagePrefixSuccess + message;
                } else {
                    message = this.context.messagePrefixFailure + message;
                }
            }

            this.delayFactory.destroyAll();
            log.getLogger('blockly_runner').debug('call reject', message);
            let executeOnReject = this.executeOnReject;
            this.executeOnResolve = null;
            this.executeOnReject = null;
            this._isFinished = true;

            if (this.context.success) {
                // message = "<span style='color:green;font-weight:bold'>" + message + "</span>";
                return;
            }

            executeOnReject(message);
        }
    };

    initCodes(codes, availableBlocks) {
        log.getLogger('blockly_runner').debug('init codes', codes);
        this.delayFactory.destroyAll();
        this.interpreters = [];
        this.nbNodes = codes.length;
        this.availableBlocks = availableBlocks;
        this.curNode = 0;
        this.nodesReady = [];
        this.waitingOnReadyNode = false;
        this.nbActions = 0;
        this._steps = 0;
        this._code = codes[0];
        this._stepInProgress = false;
        this.stepMode = false;
        this.allowStepsWithoutDelay = 0;
        this.firstHighlight = true;
        this.stackCount = 0;
        this.context.programEnded = [];
        this.interpreterEnded = [];
        this.context.curSteps = [];
        this.localVariables = {};
        this.context.callCallback = this.noDelay.bind(this);
        this._isFinished = false;
        let highlightBlocks = [...codes[0].matchAll(/highlightBlock\('(.+)'\)/g)];
        this.currentBlockId = highlightBlocks.length > 1 ? highlightBlocks[1][1] : null;
        // this.reset(true);
        for (let iInterpreter = 0; iInterpreter < codes.length; iInterpreter++) {
            this.context.curSteps[iInterpreter] = {
                total: 0,
                withoutAction: 0,
                lastNbMoves: 0
            };
            this.context.programEnded[iInterpreter] = false;
            this.interpreterEnded[iInterpreter] = false;

            this.interpreters.push(new window.Interpreter(codes[iInterpreter], (interpreter, scope) => {
                this.initInterpreter(interpreter, scope);
            }));
            this.nodesReady.push(true);
            this.isRunningInterpreter[iInterpreter] = true;
            this.toStopInterpreter[iInterpreter] = false;

            if(iInterpreter > 0) {
                // This is a fix for pseudoToNative identity comparisons (===),
                // as without that fix, pseudo-objects coming from another
                // interpreter would not get recognized to the right type.
                this.interpreters[iInterpreter].ARRAY = this.interpreters[0].ARRAY;
                this.interpreters[iInterpreter].ARRAY_PROTO = this.interpreters[0].ARRAY_PROTO;
                this.interpreters[iInterpreter].REGEXP = this.interpreters[0].REGEXP;
            }
        }
        this.maxIter = 400000;
        if (this.context.infos.maxIter != undefined) {
            this.maxIter = this.context.infos.maxIter;
        }
        if(this.hasActions) {
            this.maxIterWithoutAction = 500;
            if (this.context.infos.maxIterWithoutAction != undefined) {
                this.maxIterWithoutAction = this.context.infos.maxIterWithoutAction;
            }
        } else {
            // If there's no actions in the current task, "disable" the limit
            this.maxIterWithoutAction = this.maxIter;
        }
    };

    runStep(quickAlgoCallsExecutor, noInteractive = false) {
        return new Promise<void>((resolve, reject) => {
            this.stepMode = !noInteractive;
            this.quickAlgoCallsExecutor = quickAlgoCallsExecutor;
            this.executeOnResolve = resolve;
            this.executeOnReject = reject;
            if (this._stepInProgress) {
                log.getLogger('blockly_runner').debug('step already in progress');
                resolve();
                return;
            } else {
                if (this.interpreters.length == 1) {
                    this.interpreters[0].paused_ = false;
                }

                this.runSyncBlock();
                this._steps += 1;
                log.getLogger('blockly_runner').debug('after first run sync');
                if (this.nextCallback || !this.executeOnResolve) {
                    resolve();
                }
            }
        }).finally(() => {
            log.getLogger('blockly_runner').debug('make finally');
            this.executeOnResolve = null;
        })
    };

    public async runNewStep(stepperContext: StepperContext, noInteractive = false) {
        log.getLogger('blockly_runner').debug('init new step');
        await this.runStep(stepperContext.quickAlgoCallsExecutor, noInteractive);
        log.getLogger('blockly_runner').debug('end new step');

        if (noInteractive && !this._isFinished) {
            return;
        }

        stepperContext.makeDelay = true;
        await stepperContext.interactAfter({
            position: 0,
        });
    }

    public getCurrentBlockId(): string {
        return this.currentBlockId;
    }

    public getLocalVariables() {
        log.getLogger('blockly_runner').debug('fetch local variables', this.localVariables);
        return this.localVariables;
    }

    public isSynchronizedWithAnalysis(analysis) {
        // Must be at the same step number and have the same source code.

        const analysisStepNum = analysis.stepNum;
        const analysisCode = analysis.code;
        const currentStepNum = this._steps;
        const currentPythonCode = this._code;
        log.getLogger('blockly_runner').debug('check sync analysis, runner = ', analysisStepNum, 'executer = ', currentStepNum);

        return !(analysisStepNum !== currentStepNum || analysisCode !== currentPythonCode);
    }

    public fetchLatestBlocklyAnalysis = function (localVariables: any, lastAnalysis: AnalysisSnapshot, newStepNum: number): AnalysisSnapshot {
        return fetchLatestBlocklyAnalysis(localVariables, lastAnalysis, newStepNum);
    }

    public enrichStepperContext(stepperContext: StepperContext, state: StepperState) {
        if (state.analysis) {
            stepperContext.state.lastAnalysis = Object.freeze(state.analysis);
        }
    }
}
