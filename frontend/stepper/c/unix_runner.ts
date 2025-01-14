import AbstractRunner from "../abstract_runner";
import {getNodeStartRow, StepperContext, isStuck} from "../api";
import * as C from '@france-ioi/persistent-c';
import {StepperState} from "../index";
import log from 'loglevel';

export default class UnixRunner extends AbstractRunner {
    public static needsCompilation(): boolean {
        return true;
    }

    public static hasMicroSteps(): boolean {
        return true;
    }

    public enrichStepperContext(stepperContext: StepperContext, state: StepperState) {
        stepperContext.state.programState = C.clearMemoryLog(state.programState);
        stepperContext.state.lastProgramState = {...state.programState}
    }

    public isStuck(stepperState: StepperState): boolean {
        return !stepperState.programState.control;
    }

    public async runNewStep(stepperContext: StepperContext, noInteractive = false) {
        const effects = C.step(stepperContext.state.programState);
        await stepperContext.executeEffects(stepperContext, effects[Symbol.iterator]());

        if (noInteractive) {
            return;
        }

        /* Update the current position in source code. */
        const position = getNodeStartRow(stepperContext.state);

        if (0 === stepperContext.unixNextStepCondition % 3 && C.outOfCurrentStmt(stepperContext.state.programState)) {
            stepperContext.unixNextStepCondition++;
        }
        if (1 === stepperContext.unixNextStepCondition % 3 && C.intoNextStmt(stepperContext.state.programState)) {
            stepperContext.unixNextStepCondition++;
        }

        if (stepperContext.unixNextStepCondition % 3 === 2 || isStuck(stepperContext.state)) {
            log.getLogger('stepper').debug('do interact');
            stepperContext.makeDelay = true;
            stepperContext.unixNextStepCondition = 0;
            await stepperContext.interactAfter({
                position
            });
            stepperContext.position = position;
        }
    }
}
