import {createAction} from "@reduxjs/toolkit";

const successErrorPayload = (success, error) => ({
    payload: {
        success,
        error,
    },
});

export const platformTaskRefresh = createAction('platformTaskRefresh');
export const platformTaskLink = createAction('platformTaskLink');

export const platformAnswerLoaded = createAction('platformAnswerLoaded', (answer) => ({
    payload: {
        answer,
    },
}));

export const platformAnswerGraded = createAction('platformAnswerGraded', ({score, message, error, maxScore}: {score?: number, message?: string, error?: string, maxScore?: number}) => ({
    payload: {
        score,
        message,
        error,
        maxScore,
    },
}));

export const taskLoadEvent = createAction('taskEventLoad', (views, success, error) => ({
    payload: {
        views,
        success,
        error,
    },
}));
export const taskUnloadEvent = createAction('taskEventUnload', successErrorPayload);
export const taskShowViewsEvent = createAction('taskEventShowViews', (views, success, error) => ({
    payload: {
        views,
        success,
        error,
    },
}));
export const taskGetViewsEvent = createAction('taskEventGetViews', successErrorPayload);
export const taskUpdateTokenEvent = createAction('taskEventUpdateToken',(token, success, error) => ({
    payload: {
        token,
        success,
        error,
    },
}));
export const taskGetHeightEvent = createAction('taskEventGetHeight', successErrorPayload);
export const taskGetMetadataEvent = createAction('taskEventGetMetaData', successErrorPayload);
export const taskGetStateEvent = createAction('taskEventGetState', successErrorPayload);
export const taskReloadStateEvent = createAction('taskEventReloadState', (state, success, error) => ({
    payload: {
        state,
        success,
        error,
    },
}));
export const taskGetAnswerEvent = createAction('taskEventGetAnswer', successErrorPayload);
export const taskReloadAnswerEvent = createAction('taskEventReloadAnswer', (answer, success, error) => ({
    payload: {
        answer,
        success,
        error,
    },
}));
export const taskGradeAnswerEvent = createAction('taskEventGradeAnswer', (answer, answerToken, success, error, silent) => ({
    payload: {
        answer,
        answerToken,
        success,
        error,
        silent,
    },
}));
export const taskGetResourcesPost = createAction('taskEventGetResourcesPost', (resources, callback) => ({
    payload: {
        resources,
        callback,
    },
}));