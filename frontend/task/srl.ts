import {Bundle} from "../linker";
import {call, select, takeEvery} from "typed-redux-saga";
import {ActionTypes} from "../common/actionTypes";
import {ActionTypes as StepperActionTypes} from "../stepper/actionTypes";
import {Screen} from "../common/screens";
import {StepperStepMode} from "../stepper";
import {App} from "../index";
import {quickAlgoLibraries} from "./libs/quickalgo_libraries";
import {taskReloadStateEvent} from "./platform/actionTypes";
import {hintUnlocked} from "./hints/hints_slice";
import {AppStore} from "../store";
import {taskSetBlocksUsage, taskSuccess} from "./task_slice";
import log from 'loglevel';

export interface StatsState {
    timeSpentSeconds?: number,
    incorrectSubmissionsCount: number,
    blocksUsed: number,
    hintsTaken: number,
    documentationOpened: boolean,
}

let timeSpentStartDate = new Date();

let currentState: StatsState = {
    timeSpentSeconds: 0,
    incorrectSubmissionsCount: 0,
    blocksUsed: 0,
    hintsTaken: 0,
    documentationOpened: false,
}

export function* statsGetStateSaga(): Generator<any, StatsState, any> {
    const state: AppStore = yield* select();

    const context = quickAlgoLibraries.getContext(null, state.environment);

    return {
        ...currentState,
        timeSpentSeconds: currentState.timeSpentSeconds + Math.round(((new Date()).getTime() - timeSpentStartDate.getTime()) / 1000),
        ...(context.infos.usedSkills ? {usedSkills: context.infos.usedSkills} : {}),
        ...(context.infos.targetNbInstructions ? {targetNbInstructions: context.infos.targetNbInstructions} : {}),
    };
}

function* statsReloadStateSaga({payload: {state}}: ReturnType<typeof taskReloadStateEvent>) {
    log.getLogger('task').debug('receive new state from platform', state);
    if (state && state.stats) {
        currentState = {
            ...currentState,
            ...state.stats,
        };
        timeSpentStartDate = new Date();
    }
}

function* onValidationErrorSaga() {
    currentState.incorrectSubmissionsCount++;
    const state: AppStore = yield* select();
    const context = quickAlgoLibraries.getContext(null, 'main');
    if (context && context.addSound && 'tralalere' === state.options.app) {
        context.addSound('validationError');
    }
}

export default function (bundle: Bundle) {
    bundle.addSaga(function* (app: App) {
        if ('main' !== app.environment) {
            return;
        }

        // @ts-ignore
        yield* takeEvery(ActionTypes.AppSwitchToScreen, function* ({payload: {screen: screenName}}) {
            if (window.SrlLogger) {
                if (null === screenName) {
                    window.SrlLogger.navigation('Exercice');
                } else if (Screen.DocumentationBig === screenName || Screen.DocumentationSmall === screenName) {
                    currentState.documentationOpened = true;
                    window.SrlLogger.navigation('Aide');
                }
            }
        });

        // @ts-ignore
        yield* takeEvery(StepperActionTypes.StepperExit, function* ({payload}) {
            if (window.SrlLogger && payload?.fromControls) {
                const context = quickAlgoLibraries.getContext(null, 'main');
                window.SrlLogger.stepByStep({context}, 'stop');
            }
        });

        // @ts-ignore
        yield* takeEvery(StepperActionTypes.StepperStep, function* ({payload: {mode, useSpeed}}) {
            if (window.SrlLogger) {
                const context = quickAlgoLibraries.getContext(null, 'main');
                if (useSpeed && StepperStepMode.Run !== mode) {
                    window.SrlLogger.stepByStep({context}, 'step');
                } else if (useSpeed && StepperStepMode.Run === mode) {
                    window.SrlLogger.stepByStep({context}, 'play');
                }
            }
        });

        yield* takeEvery(StepperActionTypes.CompileFailed, function*() {
            yield* call(onValidationErrorSaga);
            if (window.SrlLogger) {
                window.SrlLogger.validation(0, 'code');
            }
        });

        yield* takeEvery(StepperActionTypes.StepperExecutionError, function*() {
            yield* call(onValidationErrorSaga);
            if (window.SrlLogger) {
                window.SrlLogger.validation(0, 'execution', 0);
            }
        });

        yield* takeEvery(taskSuccess.type, function*() {
            const state: AppStore = yield* select();
            const context = quickAlgoLibraries.getContext(null, 'main');
            if (context && context.addSound && 'tralalere' === state.options.app) {
                context.addSound('validationSuccess');
            }
        });

        yield* takeEvery(taskReloadStateEvent.type, statsReloadStateSaga);

        yield* takeEvery(hintUnlocked.type, function*() {
            const hintsUnlocked = yield* select((state: AppStore) => state.hints.unlockedHintIds.length);
            currentState.hintsTaken = Math.max(currentState.hintsTaken, hintsUnlocked);
        });

        yield* takeEvery(taskSetBlocksUsage.type, function*() {
            const blockUsage = yield* select((state: AppStore) => state.task.blocksUsage);
            if (blockUsage && null !== blockUsage.blocksCurrent) {
                currentState.blocksUsed = blockUsage.blocksCurrent;
            }
        });
    });
}
