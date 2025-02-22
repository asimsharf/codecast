import {Dialog, Icon} from "@blueprintjs/core";
import React from "react";
import {useAppSelector} from "../../hooks";
import {useDispatch} from "react-redux";
import {getMessage} from "../../lang";
import {taskChangeLevel} from "../index";
import {taskLevelsList} from "../platform/platform_slice";
import log from 'loglevel';

export interface TaskSuccessDialogProps {
    onClose: (event) => void,
}

export function TaskSuccessDialog(props: TaskSuccessDialogProps) {
    const taskSuccessMessage = useAppSelector(state => state.task.successMessage);
    const levels = useAppSelector(state => state.platform.levels);
    const currentLevel = useAppSelector(state => state.task.currentLevel);
    const dispatch = useDispatch();

    log.getLogger('task').debug('task success', currentLevel, levels);
    if (!currentLevel || !(currentLevel in levels)) {
        return null;
    }

    const currentLevelFinished = (levels[currentLevel].score >= 1);
    const currentLevelIndex = taskLevelsList.indexOf(currentLevel);
    const hasNextLevel = currentLevelIndex + 1 < taskLevelsList.length && taskLevelsList[currentLevelIndex + 1] in levels;

    const increaseLevel = () => {
        dispatch(taskChangeLevel(taskLevelsList[currentLevelIndex + 1]));
    };

    return (
        <Dialog isOpen={true} className="simple-dialog" onClose={props.onClose}>
            <p className="simple-dialog-success">{taskSuccessMessage}</p>

            {currentLevelFinished && <React.Fragment>
                {hasNextLevel
                    ? <p>{getMessage('TASK_LEVEL_SUCCESS_NEXT_LABEL').format({version: getMessage('TASK_LEVEL_VERSION').format({count: currentLevelIndex + 2})})}</p>
                    : <p>{getMessage('TASK_LEVEL_SUCCESS_FINISHED')}</p>}
            </React.Fragment>}

            <div className="simple-dialog-buttons">
                {currentLevelFinished && hasNextLevel
                    ? <button className="simple-dialog-button" onClick={increaseLevel}>
                        <Icon icon="small-tick" iconSize={24}/>
                        <span>{getMessage('TASK_LEVEL_SUCCESS_NEXT_BUTTON')}</span>
                    </button>
                    : <button className="simple-dialog-button" onClick={props.onClose}>
                        <Icon icon="small-tick" iconSize={24}/>
                        <span>{getMessage('OK')}</span>
                    </button>
                }
            </div>
        </Dialog>
    );
}
