/*

  Extensibility API for the C stepper.

  CONSIDER: The only remaining distinction between effects and builtins is that
  they live in different namespaces.  They could be merged.

*/

import * as C from '@france-ioi/persistent-c';
import {all, call, put} from 'typed-redux-saga';
import {AppStore, AppStoreReplay, CodecastPlatform} from "../store";
import {
    initialStepperStateControls,
    Stepper,
    stepperMaxStepsBetweenInteractBefore,
    StepperState,
    stepperThrottleDisplayDelay
} from "./index";
import {Bundle} from "../linker";
import {quickAlgoLibraries} from "../task/libs/quickalgo_libraries";
import {getCurrentImmerState} from "../task/utils";
import {ActionTypes as CompileActionTypes} from "./actionTypes";
import {Codecast} from "../index";
import log from "loglevel";
import {TaskSubmissionResultPayload} from "../task/task_slice";
import {QuickAlgoLibrary} from '../task/libs/quickalgo_library';

export interface QuickalgoLibraryCall {
    module: string,
    action: string,
    args: any[],
}

export interface StepperContext {
    state?: StepperState,
    taskDisplayNoneStatus?: string | null,
    interrupted?: boolean,
    interactBefore?: Function,
    interactAfter: Function,
    waitForProgress?: Function,
    waitForProgressOnlyAfterIterationsCount?: number, // For backwards compatibility
    onStepperDone?: Function,
    dispatch?: Function,
    quickAlgoCallsLogger?: Function,
    quickAlgoCallsExecutor?: Function,
    resume?: Function | null,
    position?: any,
    lineCounter?: number,
    speed?: number,
    unixNextStepCondition?: 0,
    makeDelay?: boolean,
    quickAlgoContext?: any,
    environment?: string,
    executeEffects?: Function,
    noInteractive?: boolean,
    delayToWait?: number,
    noInteractiveSteps?: number,
    backgroundRunData?: TaskSubmissionResultPayload,
    waitPreviousAnimations?: boolean,
}

export interface StepperContextParameters {
    interactBefore?: Function,
    interactAfter?: Function,
    waitForProgress?: Function,
    waitForProgressOnlyAfterIterationsCount?: number, // For backward compatbility with previous recordings
    onStepperDone?: Function,
    dispatch?: Function,
    quickAlgoContext?: QuickAlgoLibrary,
    quickAlgoCallsLogger?: Function,
    environment?: string,
    speed?: number,
    executeEffects?: Function,
    waitPreviousAnimations?: boolean,
}

export const delay = delay => new Promise((resolve) => setTimeout(resolve, delay));

export interface StepperApi {
    onInit?: Function,
    addSaga?: Function,
    onEffect?: Function,
    addBuiltin?: Function,
    buildState?: (state: AppStoreReplay, environment: string) => Generator<any, StepperState>,
    rootStepperSaga?: any,
    executeEffects?: Function,
}

export default function(bundle: Bundle) {
    const stepperApi = {
        onInit,
        addSaga,
        onEffect,
        addBuiltin,
        buildState,
        rootStepperSaga,
        executeEffects,
    };

    const initCallbacks = [];
    const stepperSagas = [];
    const effectHandlers = new Map();
    const builtinHandlers = new Map();

    /* Register a setup callback for the stepper's initial state. */
    function onInit(callback: (stepperState: StepperState, state: AppStore) => void): void {
        initCallbacks.push(callback);
    }

    /* Register a saga to run inside the stepper task. */
    function addSaga(saga): void {
        stepperSagas.push(saga);
    }

    /* The root stepper saga does a parallel call of registered stepper sagas. */
    function* rootStepperSaga(...args) {
        yield* all(stepperSagas.map(saga => call(saga, ...args)));
    }

    /* An effect is a generator that may alter the stepperContext/state/programState, and
       yield further effects. */
    function onEffect(name: string, handler: (stepperContext: StepperContext, ...args) => void): void {
        /* TODO: guard against duplicate effects? allow multiple handlers for a single effect? */
        effectHandlers.set(name, handler);
    }

    /* Register a builtin. A builtin is a generator that yields effects. */
    function addBuiltin(name: string, handler: (stepperContext: StepperContext, ...args) => void): void {
        /* TODO: guard against duplicate builtins */
        builtinHandlers.set(name, handler);
    }


    /* Build a stepper state from the given init data. */
    function* buildState(state: AppStoreReplay, environment: string): Generator<any, StepperState> {
        const {platform} = state.options;

        log.getLogger('stepper').debug('do build state', state, environment);

        /*
         * Call all the init callbacks. Pass the global state so the player can
         * build stepper states without having to install the pre-computed state
         * into the store.
         */
        const curStepperState: StepperState = {
            platform
        } as StepperState;
        for (let callback of initCallbacks) {
            try {
                yield* call(callback, curStepperState, state, environment);
            } catch (e) {
                console.error(e);
                yield* put({
                    type: CompileActionTypes.CompileFailed,
                    payload: {
                        error: String(e),
                    },
                });
            }
        }


        const stepper: Stepper = {
            ...state.stepper,
            currentStepperState: curStepperState,
        };

        /* Run until in user code */
        const stepperContext = makeContext(stepper, {
            interactBefore: () => {
                return Promise.resolve(true);
            },
            interactAfter: ({saga}) => {
                return new Promise((resolve, reject) => {
                    if (saga) {
                        return reject(new StepperError('error', 'cannot interact in buildState'));
                    }

                    resolve(true);
                });
            },
            environment,
            executeEffects,
        });

        if (stepperContext.state.platform === CodecastPlatform.Unix || stepperContext.state.platform === CodecastPlatform.Arduino) {
            while (!inUserCode(stepperContext.state)) {
                /* Mutate the stepper context to advance execution by a single step. */
                const effects = C.step(stepperContext.state.programState);
                if (effects) {
                    yield* call(executeEffects, stepperContext, effects[Symbol.iterator]());
                }
            }
        }

        return stepperContext.state;
    }

    async function executeEffects(stepperContext: StepperContext, iterator) {
        let lastResult;
        while (true) {
            /* Pull the next effect from the builtin's iterator. */
            const {done, value} = iterator.next(lastResult);
            if (done) {
                return value;
            }
            const name = value[0];
            if (name === 'interact') {
                lastResult = await stepperContext.interactAfter(value[1] || {});
            } else if (name === 'promise') {
                log.getLogger('stepper').debug('await promise');
                lastResult = await value[1];
                log.getLogger('stepper').debug('promise result', lastResult);
            } else if (name === 'builtin') {
                const builtin = value[1];
                if (!builtinHandlers.has(builtin)) {
                    throw new StepperError('error', `unknown builtin ${builtin}`);
                }

                lastResult = await executeEffects(stepperContext, builtinHandlers.get(builtin)(stepperContext, ...value.slice(2)));
            } else {
                /* Call the effect handler, feed the result back into the iterator. */
                if (!effectHandlers.has(name)) {
                    throw new StepperError('error', `unhandled effect ${name}`);
                }

                lastResult = await executeEffects(stepperContext, effectHandlers.get(name)(stepperContext, ...value.slice(1)));
            }
        }
    }

    bundle.defineValue('stepperApi', stepperApi);
}

export function getNodeStartRow(stepperState: StepperState) {
    if (!stepperState || !stepperState.programState) {
        return undefined;
    }

    const {control} = stepperState.programState;
    if (!control || !control.node) {
        return undefined;
    }

    const {range} = control.node[1];

    return range && range.start.row;
}

export function makeContext(stepper: Stepper|null, stepperContextParameters: StepperContextParameters): StepperContext {
    /**
     * We create a new state object here instead of mutating the state. This is intended.
     */

    const {dispatch, environment, speed} = stepperContextParameters;

    const state = stepper ? stepper.currentStepperState : null;

    const stepperContext: StepperContext = {
        // These may be overriden by stepperContextParameters
        interactBefore: () => {
            return Promise.resolve(true);
        },
        interactAfter: () => {
            return Promise.resolve(true);
        },
        waitPreviousAnimations: true,
        ...stepperContextParameters,
        dispatch,
        resume: null,
        position: getNodeStartRow(state),
        lineCounter: 0,
        speed: undefined !== speed ? speed : (stepper ? stepper.speed : 0),
        unixNextStepCondition: 0,
        state: state ? {
            ...state,
            controls: resetControls(state.controls),
        } : {} as StepperState,
        quickAlgoContext: quickAlgoLibraries.getContext(null, environment),
        backgroundRunData: stepper ? stepper.backgroundRunData : null,
    };

    stepperContext.quickAlgoCallsExecutor = createQuickAlgoLibraryExecutor(stepperContext);

    if (Codecast.runner && state) {
        Codecast.runner.enrichStepperContext(stepperContext, state);
    }

    return stepperContext;
}

function resetControls(controls) {
    /* Reset the controls before a step is started. */
    return initialStepperStateControls;
}

async function executeSingleStep(stepperContext: StepperContext) {
    if (isStuck(stepperContext.state)) {
        throw new StepperError('stuck', 'execution cannot proceed');
    }

    log.getLogger('stepper').debug('execute single step, no interactive = ', stepperContext.noInteractive);
    if (!stepperContext.noInteractive || stepperContext.noInteractiveSteps % stepperMaxStepsBetweenInteractBefore === 0) {
        await stepperContext.interactBefore();

        if (stepperContext.waitForProgress) {
            if (!stepperContext.waitForProgressOnlyAfterIterationsCount || stepperContext.lineCounter >= stepperContext.waitForProgressOnlyAfterIterationsCount) {
                log.getLogger('stepper').debug('wait for progress', stepperContext.lineCounter);
                if (stepperContext.waitForProgressOnlyAfterIterationsCount) {
                    // For BC, after the first round of 10.000 actions, we leave at most 20 actions for the next rounds between each stepper.progress event
                    // This is to improve performance, for recordings with an infinite loop program
                    stepperContext.lineCounter = Math.max(0, stepperContext.waitForProgressOnlyAfterIterationsCount - 20);
                }
                await stepperContext.waitForProgress(stepperContext);
                log.getLogger('stepper').debug('end wait for progress, continuing');
            } else {
                stepperContext.lineCounter += 1;
            }
        }
    } else {
        stepperContext.noInteractiveSteps++;
    }

    // const context = quickAlgoLibraries.getContext(null, stepperContext.environment);
    // context.changeDelay(0);
    // context.display = false;

    await Codecast.runner.runNewStep(stepperContext, stepperContext.noInteractive);
    // context.display = true;
}

async function stepUntil(stepperContext: StepperContext, stopCond = undefined) {
    let stop = false;
    let first = true;
    while (true) {
        if (isStuck(stepperContext.state)) {
            return;
        }
        if (!stop && stopCond) {
            if (stepperContext.state.platform === CodecastPlatform.Python) {
                if (stopCond(stepperContext.state)) {
                    stop = true;
                }
            } else {
                if (stopCond(stepperContext.state.programState)) {
                    stop = true;
                }
            }
        }

        if (stop && inUserCode(stepperContext.state)) {
            return;
        }

        if (!first && stepperContext.delayToWait > 0 && stepperContext.makeDelay) {
            stepperContext.makeDelay = false;
            let delayToWait = Math.floor(stepperContext.delayToWait / 4);

            log.getLogger('stepper').debug('make delay', delayToWait);
            await delay(delayToWait);
        }

        await executeSingleStep(stepperContext);

        first = false;
    }
}

async function stepExpr(stepperContext: StepperContext) {
    // Take a first step.
    await executeSingleStep(stepperContext);
    // Step into the next expression.
    await stepUntil(stepperContext, C.intoNextExpr);
}

async function stepInto(stepperContext: StepperContext) {
    // Take a first step.
    await executeSingleStep(stepperContext);

    if (stepperContext.state.platform === CodecastPlatform.Unix || stepperContext.state.platform === CodecastPlatform.Arduino) {
        // Step out of the current statement.
        await stepUntil(stepperContext, C.outOfCurrentStmt);
        // Step into the next statement.
        await stepUntil(stepperContext, C.intoNextStmt);
    }
}

async function stepOut(stepperContext: StepperContext) {
    // The program must be running.
    if (!isStuck(stepperContext.state)) {
        if (stepperContext.state.platform === CodecastPlatform.Python) {
            const nbSuspensions = stepperContext.state.suspensions.length;

            // Take a first step.
            await executeSingleStep(stepperContext);

            // The number of suspensions represents the number of layers of functions called.
            // We want it to be less, which means be got out of at least one level of function.
            await stepUntil(stepperContext, curState => {
                log.getLogger('stepper').debug(curState.suspensions.length, nbSuspensions);
                return (curState.suspensions.length < nbSuspensions);
            });
        } else {
            // Find the closest function scope.
            const refScope = stepperContext.state.programState.scope;
            const funcScope = C.findClosestFunctionScope(refScope);
            // Step until execution reach that scope's parent.
            await stepUntil(stepperContext, programState => programState.scope === funcScope.parent);
        }
    }

    return stepperContext;
}

async function stepOver(stepperContext: StepperContext) {
    if (stepperContext.state.platform === CodecastPlatform.Python) {
        if (stepperContext.state.suspensions) {
            const nbSuspensions = stepperContext.state.suspensions.length;

            // Take a first step.
            await executeSingleStep(stepperContext);

            // The number of suspensions represents the number of layers of functions called.
            // We want to be at the same number or less, not inside a new function.
            await stepUntil(stepperContext, curState => {
                return (curState.suspensions.length <= nbSuspensions);
            });
        } else {
            // The program hasn't started yet, just execute a step.
            await executeSingleStep(stepperContext);
        }
    } else {
        // Remember the current scope.
        const refCurrentScope = stepperContext.state.programState.scope;

        // Take a first step.
        await executeSingleStep(stepperContext);

        // Step until out of the current statement but not inside a nested
        // function call.
        await stepUntil(stepperContext, programState =>
            C.outOfCurrentStmt(programState) && C.notInNestedCall(programState.scope, refCurrentScope));

        // Step into the next statement.
        await stepUntil(stepperContext, C.intoNextStmt);
    }
}

export async function performStep(stepperContext: StepperContext, mode) {
    switch (mode) {
        case 'run':
            await stepUntil(stepperContext);
            break;
        case 'into':
            await stepInto(stepperContext);
            break;
        case 'expr':
            await stepExpr(stepperContext);
            break;
        case 'out':
            await stepOut(stepperContext);
            break;
        case 'over':
            await stepOver(stepperContext);
            break;
    }
}

export function isStuck(stepperState: StepperState): boolean {
    return Codecast.runner.isStuck(stepperState);
}

function inUserCode(stepperState: StepperState) {
    if (stepperState.platform === CodecastPlatform.Python) {
        return true;
    } else {
        return !!stepperState.programState.control.node[1].begin;
    }
}

export function createQuickAlgoLibraryExecutor(stepperContext: StepperContext) {
    return async (module: string, action: string, args: any[], callback?: Function) => {
        log.getLogger('quickalgo_executor').debug('[quickalgo_executor] call quickalgo', module, action, args, callback);
        let libraryCallResult;
        const context = stepperContext.quickAlgoContext;

        // Wait that the context has finished all previous animations
        if (stepperContext.waitPreviousAnimations) {
            log.getLogger('quickalgo_executor').debug('[quickalgo_executor] before ready check');
            await new Promise((resolve) => {
                context.executeWhenReady(resolve);
            });
        }

        log.getLogger('quickalgo_executor').debug('[quickalgo_executor] ready for call');

        if (stepperContext.state) {
            log.getLogger('quickalgo_executor').debug('[quickalgo_executor] stepper context before', stepperContext.state.contextState);
        }

        if (stepperContext.quickAlgoCallsLogger) {
            const quickAlgoLibraryCall: QuickalgoLibraryCall = {module, action, args};
            stepperContext.quickAlgoCallsLogger(quickAlgoLibraryCall);
            log.getLogger('quickalgo_executor').debug('[quickalgo_executor] call quickalgo calls logger', module, action, args);
        }

        const makeLibraryCall = () => {
            return new Promise(resolve => {
                let callbackArguments = [];
                let result = context[module][action].apply(context, [...args, function (a) {
                    log.getLogger('quickalgo_executor').debug('[quickalgo_executor] receive callback', arguments);
                    callbackArguments = [...arguments];
                    let argumentResult = callbackArguments.length ? callbackArguments[0] : undefined;
                    log.getLogger('quickalgo_executor').debug('[quickalgo_executor] set result', argumentResult);
                    resolve(argumentResult);
                }]);

                log.getLogger('quickalgo_executor').debug('[quickalgo_executor] MODULE RESULT', result);
                if (Symbol.iterator in Object(result)) {
                    iterateResult(result)
                        .then((argumentResult) => {
                            log.getLogger('quickalgo_executor').debug('[quickalgo_executor] returned element', module, action, argumentResult);
                            // Use context.waitDelay to transform result to primitive when the library uses generators
                            context.waitDelay(resolve, argumentResult);
                        });
                }
            });
        }

        const iterateResult = async (result) => {
            let lastResult;
            while (true) {
                /* Pull the next effect from the builtin's iterator. */
                const {done, value} = result.next();
                log.getLogger('quickalgo_executor').debug('[quickalgo_executor] ITERATOR RESULT', module, action, done, value);
                if (done) {
                    return value;
                }

                const name = value[0];
                if (name === 'interact') {
                    log.getLogger('quickalgo_executor').debug('[quickalgo_executor] ASK FOR INTERACT', stepperContext.interactAfter);
                    lastResult = await stepperContext.interactAfter({...(value[1] || {}), progress: false});
                    log.getLogger('quickalgo_executor').debug('[quickalgo_executor] last result', lastResult);
                } else if (name == 'put') {
                    log.getLogger('quickalgo_executor').debug('[quickalgo_executor] ask put dispatch', value[1]);
                    await stepperContext.dispatch(value[1]);
                }
            }
        }

        log.getLogger('quickalgo_executor').debug('[quickalgo_executor] before make async library call', {module, action});
        let hideDisplay = false;
        let previousDelay = context.getDelay();
        try {
            if ('main' === stepperContext.environment) {
                if ('running' === stepperContext.taskDisplayNoneStatus) {
                    // context.display = false;
                    hideDisplay = true;
                    // context.needsRedrawDisplay = true;
                    // } else if ('end' === stepperContext.taskDisplayNoneStatus) {
                    context.changeDelay(0);
                    stepperContext.taskDisplayNoneStatus = null;
                }
            }

            libraryCallResult = await makeLibraryCall();
            log.getLogger('quickalgo_executor').debug('[quickalgo_executor] after make async lib call', libraryCallResult);

            if (hideDisplay) {
                // context.display = true;
            // } else {
                context.changeDelay(previousDelay);
            }

            // Leave stepperThrottleDisplayDelay ms before displaying again the context
            if (!stepperContext.taskDisplayNoneStatus) {
                stepperContext.taskDisplayNoneStatus = 'running';
                setTimeout(() => {
                    stepperContext.taskDisplayNoneStatus = 'end';
                }, stepperThrottleDisplayDelay);
            }
        } catch (e) {
            log.getLogger('quickalgo_executor').debug('[quickalgo_executor] context error 2', e);
            if (hideDisplay) {
                // context.display = true;
            // } else {
                context.changeDelay(previousDelay);
            }

            await stepperContext.dispatch({
                type: CompileActionTypes.StepperInterrupting,
            });

            Codecast.runner.stop();

            await stepperContext.dispatch({
                type: CompileActionTypes.StepperExecutionError,
                payload: {
                    error: e,
                    clearHighlight: false,
                },
            });
        }

        log.getLogger('quickalgo_executor').debug('[quickalgo_executor] after make async library call', libraryCallResult);

        const newState = getCurrentImmerState(context.getInnerState());
        log.getLogger('quickalgo_executor').debug('[quickalgo_executor] NEW LIBRARY STATE', newState);

        if (stepperContext.state) {
            stepperContext.state = {
                ...stepperContext.state,
                contextState: newState,
            };
            log.getLogger('quickalgo_executor').debug('[quickalgo_executor] stepper context after', stepperContext.state.contextState);
        }

        if (callback) {
            log.getLogger('quickalgo_executor').debug('[quickalgo_executor] call callback arguments', libraryCallResult);
            callback(libraryCallResult);
        }

        log.getLogger('quickalgo_executor').debug('[quickalgo_executor] return library call result', libraryCallResult);

        return libraryCallResult;
    }
}

export class StepperError extends Error {
    condition = null;

    constructor(condition, message) {
        super(message);
        this.name = this.constructor.name;
        this.condition = condition;
    }
}
