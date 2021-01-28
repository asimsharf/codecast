/*

XXX interrupting

The stepper bundle provides these views:

  StepperView
  StepperControls

The stepper's state has the following shape:

  {
    status: /clear|idle|starting|running/,
    mode: /expr|into|out|over/,
    initialStepperState: StepperState,
    currentStepperState: StepperState,
    undo: List<StepperState>,
    redo: List<StepperState>,
  }

  The 'initialStepperState' state is the one restored by a 'restart' action.
  The 'currentStepperState' state is the state from which the step* actions start,
  and also the state to be displayed to the user.

*/

import {apply, call, cancel, delay, fork, put, race, select, take, takeEvery, takeLatest} from 'redux-saga/effects';
import {List, Map} from 'immutable';
import * as C from 'persistent-c';

import {buildState, default as ApiBundle, makeContext, performStep, rootStepperSaga, StepperError} from './api';
import CompileBundle from './compile';
import EffectsBundle from './c/effects';

import DelayBundle from './delay';
import HeapBundle from './c/heap';
import IoBundle from './io/index';
import ViewsBundle from './views/index';
import ArduinoBundle from './arduino';
import PythonBundle, {getNewOutput, getNewTerminal} from './python';

/* TODO: clean-up */
import {analyseState, collectDirectives} from './c/analysis';
import {analyseSkulptState, getSkulptSuspensionsCopy, SkulptAnalysis} from "./python/analysis/analysis";
import {parseDirectives} from "./python/directives";
import {ActionTypes} from "./actionTypes";
import {ActionTypes as CommonActionTypes} from "../common/actionTypes";
import {ActionTypes as BufferActionTypes} from "../buffers/actionTypes";
import {ActionTypes as RecorderActionTypes} from "../recorder/actionTypes";
import {ActionTypes as AppActionTypes} from "../actionTypes";
import {getCurrentStepperState, getStepper, getSyntaxTree, isStepperInterrupting} from "./selectors";
import produce from "immer";
import {AppStore, CodecastPlatform} from "../store";
import {TermBuffer} from "./io/terminal";

export interface StepperTask {

}

export enum StepperStepMode {
    Run = 'run',
    Expr = 'expr',
    Into = 'into',
    Out = 'out',
    Over = 'over'
}

export interface StepperDirectives {
    ordered: any[],
    functionCallStack: any, // C
    functionCallStackMap: any // Python
}

// TODO: Separate the needs per platform (StepperStatePython, StepperStateC, etc)
const initialStateStepperState = {
    platform: 'python' as CodecastPlatform,
    inputPos: 0, // Only used for python
    input: '',
    output: '', // Only used for python
    terminal: null as TermBuffer, // Only used for python
    suspensions: [] as any[],  // Only used for python // TODO: Don't put this in the store
    programState: {} as any, // Only used for c
    lastProgramState: {} as any, // Only used for c
    ports: [] as any[], // Only used for arduino
    selectedPort: {} as any, // Only used for arduino
    controls: {
        stack: {
            focusDepth: 0
        } as any, // TODO: type
    }, // Only used for c
    analysis: null as SkulptAnalysis, // Only used for python
    directives: {
        ordered: [],
        functionCallStack: null,
        functionCallStackMap: null
    } as StepperDirectives,
    inputBuffer: '',
    isWaitingOnInput: false,
    error: ''
};

enum StepperStatus {
    Clear = 'clear',
    Idle = 'idle',
    Starting = 'starting',
    Running = 'running'
}

export const initialStateStepper = {
    status: StepperStatus.Clear,
    undo: [],
    redo: [],
    initialStepperState: initialStateStepperState,
    currentStepperState: null as typeof initialStateStepperState,
    interrupting: false,
    mode: null as StepperStepMode,
    options: {} as any // TODO: Is this used ? If yes, put the type.
};

function initReducer(draft: AppStore): void {
    draft.stepper = initialStateStepper;
}

export default function(bundle) {
    bundle.addReducer(AppActionTypes.AppInit, produce(initReducer));

    /* Sent when the stepper task is started */
    bundle.defineAction(ActionTypes.StepperTaskStarted);
    bundle.addReducer(ActionTypes.StepperTaskStarted, produce(stepperTaskStartedReducer));

    /* Sent when the stepper task is cancelled */
    bundle.defineAction(ActionTypes.StepperTaskCancelled);
    bundle.addReducer(ActionTypes.StepperTaskCancelled, produce(stepperTaskCancelledReducer));

    // Sent when the stepper's state is initialized.
    bundle.defineAction(ActionTypes.StepperRestart);
    bundle.addReducer(ActionTypes.StepperRestart, produce(stepperRestartReducer));

    // Restore a saved or computed state.
    bundle.defineAction(ActionTypes.StepperReset);
    bundle.addReducer(ActionTypes.StepperReset, produce(stepperResetReducer));

    // Sent when the user requested stepping in a given mode.
    bundle.defineAction(ActionTypes.StepperStep);
    bundle.addReducer(ActionTypes.StepperStep, produce(stepperStepReducer));

    // Sent when the stepper has started evaluating a step.
    bundle.defineAction(ActionTypes.StepperStarted);
    bundle.addReducer(ActionTypes.StepperStarted, produce(stepperStartedReducer));

    bundle.defineAction(ActionTypes.StepperInteract);

    // Sent when the stepper has been evaluating for a while without completing a step.
    bundle.defineAction(ActionTypes.StepperProgress);
    bundle.addReducer(ActionTypes.StepperProgress, produce(stepperProgressReducer));

    // Sent when the stepper has completed a step and is idle again.
    bundle.defineAction(ActionTypes.StepperIdle);
    bundle.addReducer(ActionTypes.StepperIdle, produce(stepperIdleReducer));

    // Sent when the user exits the stepper.
    bundle.defineAction(ActionTypes.StepperExit);
    bundle.addReducer(ActionTypes.StepperExit, produce(stepperExitReducer));

    // Sent when the user interrupts the stepper.
    bundle.defineAction(ActionTypes.StepperInterrupt);
    bundle.addReducer(ActionTypes.StepperInterrupt, produce(stepperInterruptReducer));

    bundle.defineAction(ActionTypes.StepperInterrupted);
    bundle.addReducer(ActionTypes.StepperInterrupted, produce(stepperInterruptedReducer));

    bundle.defineAction(ActionTypes.StepperUndo);
    bundle.addReducer(ActionTypes.StepperUndo, produce(stepperUndoReducer));

    bundle.defineAction(ActionTypes.StepperRedo);
    bundle.addReducer(ActionTypes.StepperRedo, produce(stepperRedoReducer));

    bundle.defineAction(ActionTypes.StepperConfigure);
    bundle.addReducer(ActionTypes.StepperConfigure, produce(stepperConfigureReducer));

    /* BEGIN view stuff to move out of here */

    bundle.defineAction(ActionTypes.StepperStackUp);
    bundle.addReducer(ActionTypes.StepperStackUp, produce(stepperStackUpReducer));

    bundle.defineAction(ActionTypes.StepperStackDown);
    bundle.addReducer(ActionTypes.StepperStackDown, produce(stepperStackDownReducer));

    bundle.defineAction(ActionTypes.StepperViewControlsChanged);
    bundle.addReducer(ActionTypes.StepperViewControlsChanged, produce(stepperViewControlsChangedReducer));

    /* END view stuff to move out of here */

    bundle.defineAction(ActionTypes.StepperEnabled);
    bundle.defineAction(ActionTypes.StepperDisabled);

    bundle.addSaga(stepperSaga);

    bundle.defer(postLink);

    /* Include bundles late so post-link functions that register with replayApi
       (in particular in IoBundle) are called after our own (just above). */
    bundle.include(ApiBundle);
    bundle.include(CompileBundle);
    bundle.include(EffectsBundle);
    bundle.include(DelayBundle);
    bundle.include(HeapBundle);
    bundle.include(IoBundle);
    bundle.include(ViewsBundle);
    bundle.include(ArduinoBundle);
    bundle.include(PythonBundle);
};

/**
 * Enrich, analysis the current stepper state.
 *
 * @param stepperState The stepper statee.
 * @param {string} context The context (Stepper.Progress, Stepper.Restart, Stepper.Idle).
 *
 * @returns The new stepper state with analysis.
 */
function enrichStepperState(stepperState, context) {
    stepperState = {...stepperState};
    if (!('controls' in stepperState)) {
        stepperState.controls = Map();
    }
    const {programState, controls} = stepperState;
    if (!programState) {
        return stepperState;
    }

    /* TODO: extend stepper API to add enrichers that run here */

    if (stepperState.platform === 'python') {
        if (context === 'Stepper.Progress') {
            // Don't reanalyse after program is finished :
            // keep the last state of the stack and set isFinished state.
            if (window.currentPythonRunner._isFinished) {
                stepperState.analysis = {
                    ...stepperState.analysis,
                    isFinished: true
                }
            } else {
                stepperState.analysis = analyseSkulptState(stepperState.suspensions, stepperState.lastAnalysis, stepperState.analysis.stepNum + 1);
                stepperState.directives = {
                    ordered: parseDirectives(stepperState.analysis),
                    functionCallStackMap: null
                };
            }
        }

        if (!stepperState.analysis) {
            stepperState.analysis = {
                functionCallStack: List(),
                code: window.currentPythonRunner._code,
                lines: window.currentPythonRunner._code.split("\n"),
                stepNum: 0,
                isFinished: false
            }

            stepperState.lastAnalysis = {
                functionCallStack: List(),
                code: window.currentPythonRunner._code,
                lines: window.currentPythonRunner._code.split("\n"),
                stepNum: 0,
                isFinished: false
            }
        }
    } else {
        const analysis = stepperState.analysis = analyseState(programState);
        const focusDepth = controls.stack.focusDepth;
        stepperState.directives = collectDirectives(analysis.functionCallStack, focusDepth);

        // TODO? initialize controls for each directive added,
        //       clear controls for each directive removed (except 'stack').
    }

    console.log(stepperState);

    return stepperState;
}

export function clearStepper(stepper: typeof initialStateStepper) {
    stepper.status = StepperStatus.Clear;
    stepper.undo = [];
    stepper.redo = [];
}

function getNodeRange(stepperState: typeof initialStateStepperState) {
    if (!stepperState) {
        return null;
    }

    if (stepperState.platform === 'python') {
        const suspension = window.currentPythonRunner.getCurrentSuspension();
        if (!suspension) {
            return null;
        }

        return {
            start: {
                row: (suspension.$lineno - 1),
                column: suspension.$colno,
            },
            end: {
                row: (suspension.$lineno - 1),
                column: 100,
            }
        };
    } else {
        const {control} = stepperState.programState;
        if (!control || !control.node) {
            return null;
        }

        const focusDepth = stepperState.controls.stack.focusDepth;
        if (focusDepth === 0) {
            return control.node[1].range;
        } else {
            const {functionCallStack} = stepperState.analysis;
            const stackFrame = functionCallStack.get(functionCallStack.size - focusDepth);

            // @ts-ignore
            return stackFrame.scope.cont.node[1].range;
        }
    }
}

function stringifyError(error) {
    if (process.env.NODE_ENV === 'production') {
        return error.toString();
    }
    if (error && error.stack) {
        return error.stack.toString();
    }
    return JSON.stringify(error);
}

/* Reducers */

function stepperRestartReducer(draft: AppStore, {payload: {stepperState}}): void {
    const {platform} = draft.options;

    if (stepperState) {
        stepperState = enrichStepperState(stepperState, 'Stepper.Restart');

        if (platform === 'python') {
            // TODO: Check restart.
        }
    } else {
        if (platform === 'python') {
            stepperState = draft.stepper.initialStepperState;
            stepperState.inputPos = 0;

            const sourceModel = draft.buffers.source.model;
            const source = sourceModel.document.toString();

            /**
             * Add a last instruction at the end of the code so Skupt will generate a Suspension state
             * for after the user's last instruction. Otherwise it would be impossible to retrieve the
             * modifications made by the last user's line.
             *
             * @type {string} pythonSource
             */
            const pythonSource = source + "\npass";

            window.currentPythonRunner.initCodes([pythonSource]);
        } else {
            stepperState = draft.stepper.initialStepperState;
        }
    }

    draft.stepper.status = StepperStatus.Idle;
    draft.stepper.initialStepperState = stepperState;
    draft.stepper.currentStepperState = stepperState;
    draft.stepper.redo = [];
}

function stepperTaskStartedReducer(draft: AppStore, {payload: {task}}): void {
    draft.stepperTask = task;
}

function stepperTaskCancelledReducer(draft: AppStore): void {
    draft.stepperTask = null;
}

function stepperResetReducer(draft: AppStore, {payload: {stepperState}}): void {
    draft.stepper = stepperState;
}

function stepperStepReducer(draft: AppStore): void {
    /* No check for 'idle' status, the player must be able to step while
       the status is 'running'. */
    draft.stepper.status = StepperStatus.Starting;
}

function stepperStartedReducer(draft: AppStore, action): void {
    draft.stepper.status = StepperStatus.Running;
    draft.stepper.mode = action.mode;
    draft.stepper.redo = [];
    draft.stepper.undo.unshift(draft.stepper.currentStepperState);
}

function stepperProgressReducer(draft: AppStore, {payload: {stepperContext}}): void {
    if (stepperContext.state.hasOwnProperty('platform') && stepperContext.state.platform === 'python') {
        // Save scope.
        stepperContext.state.suspensions = getSkulptSuspensionsCopy(window.currentPythonRunner._debugger.suspension_stack);
    }

    // Set new currentStepperState state and go back to idle.
    // Returns a new references.
    const stepperState = enrichStepperState(stepperContext.state, 'Stepper.Progress');

    // Python print calls are asynchronous so we need to update the terminal and output by the one in the store.
    if (stepperState.hasOwnProperty('platform') && stepperState.platform === 'python') {
        const storeStepper = draft.stepper;
        const storeCurrentStepperState = storeStepper.currentStepperState;

        const storeTerminal = window.currentPythonRunner._terminal;
        const storeOutput = storeCurrentStepperState.output;

        stepperState.terminal = storeTerminal;
        stepperState.output = storeOutput;
    }

    return draft.stepper.currentStepperState = stepperState;
}

function stepperIdleReducer(draft: AppStore, {payload: {stepperContext}}): void {
    // Set new currentStepperState state and go back to idle.
    /* XXX Call enrichStepperState prior to calling the reducer. */
    draft.stepper.currentStepperState = enrichStepperState(stepperContext.state, 'Stepper.Idle');
    draft.stepper.status = StepperStatus.Idle;
    draft.stepper.mode = null;
}

function stepperExitReducer(draft: AppStore): void {
    clearStepper(draft.stepper);
}

function stepperInterruptReducer(draft: AppStore): void {
    // Cannot interrupt while idle.
    if (draft.stepper.status != StepperStatus.Idle) {
        draft.stepper.interrupting = true;
    }
}

function stepperInterruptedReducer(draft: AppStore): void {
    draft.stepper.interrupting = false;
}

function stepperUndoReducer(draft: AppStore): void {
    const undo = draft.stepper.undo;
    if (undo.length) {
        const currentStepperState = draft.stepper.currentStepperState;

        draft.stepper.currentStepperState = undo.shift();
        draft.stepper.redo.unshift(currentStepperState);
    }
}

function stepperRedoReducer(draft: AppStore): void {
    const redo = draft.stepper.redo;
    if (redo.length) {
        const currentStepperState = draft.stepper.currentStepperState;

        draft.stepper.currentStepperState = redo.shift();
        draft.stepper.undo.unshift(currentStepperState);
    }
}

function stepperConfigureReducer(draft: AppStore, action): void {
    const {options} = action;

    return draft.stepper.options = options;
}

function stepperStackUpReducer(draft: AppStore): void {
    let {controls, analysis} = draft.stepper.currentStepperState;
    let focusDepth = controls.stack.focusDepth;
    if (focusDepth > 0) {
        focusDepth -= 1;

        controls.stack.focusDepth = focusDepth;

        const directives = collectDirectives(analysis.functionCallStack, focusDepth);
        draft.stepper.currentStepperState.controls = controls;
        draft.stepper.currentStepperState.directives = directives;
    }
}

function stepperStackDownReducer(draft: AppStore): void {
    let {controls, analysis} = draft.stepper.currentStepperState;
    const stackDepth = analysis.functionCallStack.size;
    let focusDepth = controls.stack.focusDepth;
    if (focusDepth + 1 < stackDepth) {
        focusDepth += 1;

        controls.stack.focusDepth = focusDepth;

        const directives = collectDirectives(analysis.functionCallStack, focusDepth);
        draft.stepper.currentStepperState.controls = controls;
        draft.stepper.currentStepperState.directives = directives;
    }
}

function stepperViewControlsChangedReducer(draft: AppStore, action): void {
    const {key, update} = action;

    let {controls} = draft.stepper.currentStepperState;
    if (controls[key]) {
        Object.keys(update).forEach(function(name) {
            controls[key][name] = update[name];
        });
    } else {
        controls[key] = update;
    }
}

/* saga */

function* compileSucceededSaga() {
    try {
        yield put({type: ActionTypes.StepperDisabled});
        /* Build the stepper state. This automatically runs into user source code. */
        let state: AppStore = yield select();

        let stepperState = yield call(buildState, state);

        // buildState may have triggered an error.
        state = yield select();
        if (state.compile.status !== 'error') {
            /* Enable the stepper */
            yield put({type: ActionTypes.StepperEnabled});
            yield put({type: ActionTypes.StepperRestart, payload: {stepperState}});
        }
    } catch (error) {
        yield put({type: CommonActionTypes.Error, payload: {source: 'stepper', error}});
    }
}

function* recorderStoppingSaga() {
    /* Disable the stepper when recording stops. */
    yield put({type: ActionTypes.StepperInterrupt});
    yield put({type: ActionTypes.StepperDisabled});
}

function* stepperEnabledSaga(args) {
    /* Start the new stepper task. */
    const newTask = yield fork(rootStepperSaga, args);

    yield put({type: ActionTypes.StepperTaskStarted, payload: {task: newTask}});
}

function* stepperDisabledSaga() {
    const state: AppStore = yield select();

    /* Cancel the stepper task if still running. */
    const oldTask = state.stepperTask;
    if (oldTask) {
        // @ts-ignore
        yield cancel(oldTask);

        yield put({type: ActionTypes.StepperTaskCancelled});
    }

    /* Clear source highlighting. */
    const startPos = {row: 0, column: 0};

    yield put({type: BufferActionTypes.BufferHighlight, buffer: 'source', range: {start: startPos, end: startPos}});
}

function* stepperInteractSaga(app, {payload: {stepperContext, arg}, meta: {resolve, reject}}) {
    let state: AppStore = yield select();

    /* Has the stepper been interrupted? */
    if (isStepperInterrupting(state)) {
        yield call(reject, new StepperError('interrupt', 'interrupted'));

        return;
    }

    /* Emit a progress action so that an up-to-date state gets displayed. */
    yield put({type: ActionTypes.StepperProgress, payload: {stepperContext}});

    /* Run the provided saga if any, or wait until next animation frame. */
    const saga = arg.saga || stepperWaitSaga;
    const {completed, interrupted} = yield (race({
        completed: call(saga, stepperContext),
        interrupted: take(ActionTypes.StepperInterrupt)
    }));

    /* Update stepperContext.state from the global state to avoid discarding
       the effects of user interaction. */
    state = yield select();
    stepperContext.state = getCurrentStepperState(state);

    if (stepperContext.state.platform === 'python' && arg) {
        stepperContext.state.output = arg.output;
        stepperContext.state.terminal = arg.terminal;
        stepperContext.state.inputPos = arg.inputPos;
        stepperContext.state.input = arg.input;
    }

    /* Check whether to interrupt or resume the stepper. */
    if (interrupted) {
        yield call(reject, new StepperError('interrupt', 'interrupted'));
    } else {
        /* Continue stepper execution, passing the saga's return value as the
           result of yielding the interact effect. */
        yield call(resolve, completed);
    }
}

function* stepperWaitSaga() {
    // Yield until the next tick (XXX use requestAnimationFrame through channel).
    yield delay(0);
}

function* stepperInterruptSaga() {
    const state = yield select();

    const curStepperState = getCurrentStepperState(state);
    if (!curStepperState) {
        return;
    }

    const stepperContext = makeContext(curStepperState, () => {
        return new Promise((resolve) => {
            resolve(true);
        });
    });

    /**
     * Before we do a step, we check if the state in analysis is the same as the one in the python runner.
     *
     * If it is different, it means the analysis has been overwritten by playing a record, and so
     * we need to move the python runner to the same point before we can to a step.
     */
    if (stepperContext.state.platform === 'python') {
        if (!window.currentPythonRunner.isSynchronizedWithAnalysis(stepperContext.state.analysis)) {
            // TODO: Support error.

            window.currentPythonRunner.initCodes([stepperContext.state.analysis.code]);

            window.currentPythonRunner._input = stepperContext.state.input;
            window.currentPythonRunner._inputPos = 0;
            window.currentPythonRunner._terminal = stepperContext.state.terminal;

            window.currentPythonRunner._synchronizingAnalysis = true;
            while (window.currentPythonRunner._steps < stepperContext.state.analysis.stepNum) {
                yield apply(window.currentPythonRunner, window.currentPythonRunner.runStep, []);

                if (window.currentPythonRunner._isFinished) {
                    break;
                }
            }
            window.currentPythonRunner._synchronizingAnalysis = false;

            stepperContext.state.input = window.currentPythonRunner._input;
            stepperContext.state.terminal = window.currentPythonRunner._terminal;
            stepperContext.state.inputPos = window.currentPythonRunner._inputPos;

            yield put({type: ActionTypes.StepperIdle, payload: {stepperContext}});
        }
    }
}

function* stepperStepSaga(app, action) {
    const state = yield select();

    const stepper = getStepper(state);
    if (stepper.status === StepperStatus.Starting) {
        yield put({type: ActionTypes.StepperStarted, mode: action.payload.mode});

        const stepperContext = makeContext(stepper.currentStepperState, interact);

        /**
         * Before we do a step, we check if the state in analysis is the same as the one in the python runner.
         *
         * If it is different, it means the analysis has been overwritten by playing a record, and so
         * we need to move the python runner to the same point before we can to a step.
         */
        if (stepperContext.state.platform === 'python') {
            if (!window.currentPythonRunner.isSynchronizedWithAnalysis(stepperContext.state.analysis)) {
                // TODO: Check if it works with the input.

                // TODO: Support error.

                window.currentPythonRunner.initCodes([stepperContext.state.analysis.code]);

                window.currentPythonRunner._input = stepperContext.state.input;
                window.currentPythonRunner._inputPos = 0;
                window.currentPythonRunner._terminal = stepperContext.state.terminal;

                window.currentPythonRunner._synchronizingAnalysis = true;
                while (window.currentPythonRunner._steps < stepperContext.state.analysis.stepNum) {
                    yield apply(window.currentPythonRunner, window.currentPythonRunner.runStep, []);

                    if (window.currentPythonRunner._isFinished) {
                        break;
                    }
                }
                window.currentPythonRunner._synchronizingAnalysis = false;

                stepperContext.state.input = window.currentPythonRunner._input;
                stepperContext.state.terminal = window.currentPythonRunner._terminal;
                stepperContext.state.inputPos = window.currentPythonRunner._inputPos;
            }
        }

        try {
            yield call(performStep, stepperContext, action.payload.mode);
        } catch (ex) {
            console.log('stepperStepSaga has catched', ex);
            if (!(ex instanceof StepperError)) {
                ex = new StepperError('error', stringifyError(ex));
            }
            if (ex.condition === 'interrupt') {
                stepperContext.interrupted = true;
                yield put({type: ActionTypes.StepperInterrupted});
            }
            if (ex.condition === 'error') {
                stepperContext.state.error = ex.message;
            }
        }

        if (stepperContext.state.platform === 'python') {
            // Save scope.
            stepperContext.state.suspensions = getSkulptSuspensionsCopy(window.currentPythonRunner._debugger.suspension_stack);
        }

        yield put({type: ActionTypes.StepperIdle, payload: {stepperContext}});

        function interact(arg) {
            return new Promise((resolve, reject) => {
                app.dispatch({
                    type: ActionTypes.StepperInteract,
                    payload: {stepperContext, arg},
                    meta: {resolve, reject}
                });
            });
        }
    }
}

function* stepperExitSaga() {
    /* Disabled the stepper. */
    yield put({type: ActionTypes.StepperDisabled});

    /* Clear the compile state. */
    yield put({type: ActionTypes.CompileClear});
}

function* updateSourceHighlightSaga() {
    const state: AppStore = yield select();
    const stepperState = state.stepper.currentStepperState;

    const range = getNodeRange(stepperState);

    yield put({
        type: BufferActionTypes.BufferHighlight,
        buffer: 'source',
        range
    });
}

function* stepperSaga(args) {
    yield takeLatest(ActionTypes.CompileSucceeded, compileSucceededSaga);
    yield takeLatest(RecorderActionTypes.RecorderStopping, recorderStoppingSaga);
    yield takeLatest(ActionTypes.StepperEnabled, stepperEnabledSaga, args);
    yield takeLatest(ActionTypes.StepperDisabled, stepperDisabledSaga);
}

/* Post-link, register record and replay hooks. */

function updateRange(replayContext) {
    replayContext.instant.range = getNodeRange(getCurrentStepperState(replayContext.state));
}

function postLink(scope) {
    const {recordApi, replayApi, stepperApi} = scope;

    recordApi.onStart(function* () {
        /* TODO: store stepper options in init */
    });
    replayApi.on('start', function(replayContext) {
        /* TODO: restore stepper options from event[2] */
        replayContext.state = produce(initReducer.bind(replayContext.state));
    });
    replayApi.onReset(function* (instant) {
        const stepperState = instant.state.get('stepper');

        yield put({type: ActionTypes.StepperReset, payload: {stepperState}});
        yield put({type: BufferActionTypes.BufferHighlight, buffer: 'source', range: instant.range});
    });

    recordApi.on(ActionTypes.StepperExit, function* (addEvent) {
        yield call(addEvent, 'stepper.exit');
    });
    replayApi.on('stepper.exit', function(replayContext) {
        replayContext.state = produce(stepperExitReducer.bind(replayContext.state));

        /* Clear the highlighted range when the stepper terminates. */
        replayContext.instant.range = null;
    });

    recordApi.on(ActionTypes.StepperRestart, function* (addEvent) {
        yield call(addEvent, 'stepper.restart');
    });
    replayApi.on('stepper.restart', async function(replayContext) {
        const stepperState = await buildState(replayContext.state);

        replayContext.state = produce(stepperRestartReducer.bind(replayContext.state, {payload: {stepperState}}));
    });

    recordApi.on(ActionTypes.StepperStarted, function* (addEvent, action) {
        const {mode} = action;

        yield call(addEvent, 'stepper.step', mode);
    });
    replayApi.on('stepper.step', function(replayContext, event) {
        return new Promise((resolve, reject) => {
            const mode = event[2];

            replayContext.stepperDone = resolve;
            replayContext.state = produce(stepperStartedReducer.bind(replayContext.state, {mode}));

            const stepperState = getCurrentStepperState(replayContext.state);
            replayContext.stepperContext = makeContext(stepperState, function interact(_) {
                return new Promise((cont) => {
                    stepperSuspend(replayContext.stepperContext, cont);

                    replayContext.state = produce(stepperProgressReducer.bind(replayContext.state, {payload: {stepperContext: replayContext.stepperContext}}));

                    stepperEventReplayed(replayContext);
                });
            });
            performStep(replayContext.stepperContext, mode).then(function() {
                let currentStepperState = replayContext.state.stepper.currentStepperState;

                if (currentStepperState.platform === 'python' && window.currentPythonRunner._printedDuringStep) {
                    replayContext.state.updateIn(['stepper', 'currentStepperState'], (currentStepperState) => {
                        const newOutput = getNewOutput(currentStepperState, window.currentPythonRunner._printedDuringStep);
                        const newTerminal = getNewTerminal(window.currentPythonRunner._terminal, window.currentPythonRunner._printedDuringStep);

                        return {
                            ...currentStepperState,
                            output: newOutput,
                            terminal: newTerminal
                        }
                    });
                }

                replayContext.state = produce(stepperIdleReducer.bind(replayContext.state, {payload: {stepperContext: replayContext.stepperContext}}));
                stepperEventReplayed(replayContext);
            }, function(error) {
                if (!(error instanceof StepperError)) {
                    return reject(error);
                }
                if (error.condition === 'interrupt') {
                    replayContext.stepperContext.interrupted = true;
                }
                if (error.condition === 'error') {
                    replayContext.stepperContext.state.error = error.message;
                }

                replayContext.state = produce(stepperIdleReducer.bind(replayContext.state, {payload: {stepperContext: replayContext.stepperContext}}));
                stepperEventReplayed(replayContext);
            });
        });
    });

    recordApi.on(ActionTypes.StepperProgress, function* (addEvent, {payload: {stepperContext}}) {
        yield call(addEvent, 'stepper.progress', stepperContext.lineCounter);
    });

    replayApi.on('stepper.progress', function(replayContext) {
        return new Promise((resolve) => {
            replayContext.stepperDone = resolve;
            replayContext.stepperContext.state = getCurrentStepperState(replayContext.state);
            stepperResume(replayContext.stepperContext, function interact() {
                return new Promise((cont) => {
                    stepperSuspend(replayContext.stepperContext, cont);

                    replayContext.state = produce(stepperProgressReducer.bind(replayContext.state, {payload: {stepperContext: replayContext.stepperContext}}));

                    stepperEventReplayed(replayContext);
                });
            }, function() {
                replayContext.state = produce(stepperProgressReducer.bind(replayContext.state, {payload: {stepperContext: replayContext.stepperContext}}));
                stepperEventReplayed(replayContext);
            });
        });
    });

    recordApi.on(ActionTypes.StepperInterrupt, function* (addEvent) {
        yield call(addEvent, 'stepper.interrupt');
    });
    replayApi.on('stepper.interrupt', function(replayContext) {
        /* Prevent the subsequent stepper.idle event from running the stepper until
           completion. */
        const {stepperContext} = replayContext;

        stepperContext.interact = null;
        stepperContext.resume = null;
    });

    recordApi.on(ActionTypes.StepperIdle, function* (addEvent, {payload: {stepperContext}}) {
        yield call(addEvent, 'stepper.idle', stepperContext.lineCounter);
    });

    replayApi.on('stepper.idle', function(replayContext) {
        return new Promise((resolve) => {
            replayContext.stepperDone = resolve;
            replayContext.stepperContext.state = getCurrentStepperState(replayContext.state);
            /* Set the interact callback to resume the stepper until completion. */
            stepperResume(replayContext.stepperContext, function interact(_) {
                return new Promise((cont) => {
                    cont(true);
                });
            }, function() {
                replayContext.state = produce(stepperIdleReducer.bind(replayContext.state, {payload: {stepperContext: replayContext.stepperContext}}));
                stepperEventReplayed(replayContext);
            });
        });
    });

    function stepperEventReplayed(replayContext) {
        const done = replayContext.stepperDone;
        replayContext.stepperDone = null;
        updateRange(replayContext);
        done();
    }

    function stepperSuspend(stepperContext, cont) {
        stepperContext.interact = null;
        stepperContext.resume = cont;
    }

    function stepperResume(stepperContext, interact, notSuspended) {
        const {resume} = stepperContext;
        if (resume) {
            stepperContext.resume = null;
            stepperContext.interact = interact;
            resume();
        } else {
            notSuspended();
        }
    }

    recordApi.on(ActionTypes.StepperUndo, function* (addEvent) {
        yield call(addEvent, 'stepper.undo');
    });
    replayApi.on('stepper.undo', function(replayContext) {
        replayContext.state = produce(stepperUndoReducer.bind(replayContext.state));

        updateRange(replayContext);
    });

    recordApi.on(ActionTypes.StepperRedo, function* (addEvent) {
        yield call(addEvent, 'stepper.redo');
    });
    replayApi.on('stepper.redo', function(replayContext) {
        replayContext.state = produce(stepperRedoReducer.bind(replayContext.state));

        updateRange(replayContext);
    });

    recordApi.on(ActionTypes.StepperStackUp, function* (addEvent) {
        yield call(addEvent, 'stepper.stack.up');
    });
    replayApi.on('stepper.stack.up', function(replayContext) {
        replayContext.state = produce(stepperStackUpReducer.bind(replayContext.state));
        updateRange(replayContext);
    });

    recordApi.on(ActionTypes.StepperStackDown, function* (addEvent) {
        yield call(addEvent, 'stepper.stack.down');
    });
    replayApi.on('stepper.stack.down', function(replayContext) {
        replayContext.state = produce(stepperStackDownReducer.bind(replayContext.state));
        updateRange(replayContext);
    });

    /* TODO: move out of here? */
    recordApi.on(ActionTypes.StepperViewControlsChanged, function* (addEvent, action) {
        const {key, update} = action;

        yield call(addEvent, 'stepper.view.update', key, update);
    });
    replayApi.on('stepper.view.update', function(replayContext, event) {
        const key = event[2];
        const update = event[3];

        replayContext.state = produce(stepperViewControlsChangedReducer.bind(replayContext.state, {key, update}));
    });

    stepperApi.onInit(function(stepperState, state: AppStore) {
        const {platform} = state.options;

        switch (platform) {
            case 'python':
                stepperState.lastProgramState = {};
                stepperState.programState = {...stepperState.lastProgramState};

                break;
            default:
                const syntaxTree = getSyntaxTree(state);
                const options = stepperState.options = {
                    memorySize: 0x10000,
                    stackSize: 4096,
                };

                /* Set up the programState. */
                const emptyProgramState = stepperState.lastProgramState = C.makeCore(options.memorySize);

                /* Execute declarations and copy strings into memory */
                const initialProgramState = stepperState.programState = {...emptyProgramState};
                const decls = syntaxTree[2];
                C.execDecls(initialProgramState, decls);

                /* Set up the call to the main function. */
                C.setupCall(initialProgramState, 'main');

                break;
        }
    });

    stepperApi.addSaga(function* mainStepperSaga(args) {
        // @ts-ignore
        yield takeEvery(ActionTypes.StepperInteract, stepperInteractSaga, args);
        yield takeEvery(ActionTypes.StepperStep, stepperStepSaga, args);
        yield takeEvery(ActionTypes.StepperInterrupt, stepperInterruptSaga);
        yield takeEvery(ActionTypes.StepperExit, stepperExitSaga);

        /* Highlight the range of the current source fragment. */
        yield takeLatest([
            ActionTypes.StepperProgress,
            ActionTypes.StepperIdle,
            ActionTypes.StepperRestart,
            ActionTypes.StepperUndo,
            ActionTypes.StepperRedo,
            ActionTypes.StepperStackUp,
            ActionTypes.StepperStackDown
        ], updateSourceHighlightSaga);
    });
}
