import './style.scss';

import url from 'url';
import React from 'react';
import ReactDOM from 'react-dom';
import {Provider} from 'react-redux';
import log from 'loglevel';
import 'rc-slider/assets/index.css?global';
import {AppStore} from './store';
import {Bundle, link} from './linker';
import commonBundle from './common/index';
import playerBundle from './player/index';
import recorderBundle from './recorder/index';
import editorBundle from './editor/index';
import statisticsBundle from './statistics/index';
import {isLocalMode} from "./utils/app";
import {ActionTypes} from "./actionTypes";
import {ActionTypes as CommonActionTypes} from "./common/actionTypes";
import {ActionTypes as PlayerActionTypes} from "./player/actionTypes";
import {ActionTypes as RecorderActionTypes} from "./recorder/actionTypes";
import {ActionTypes as StatisticsActionTypes} from "./statistics/actionTypes";
import {SandboxApp} from "./sandbox/SandboxApp";
import {TaskApp} from "./task/TaskApp";
import {StatisticsApp} from "./statistics/StatisticsApp";
import {PlayerApp} from "./player/PlayerApp";
import {RecorderApp} from "./recorder/RecorderApp";
import {AppErrorBoundary} from "./common/AppErrorBoundary";
import {setAutoFreeze} from "immer";
import {ReplayApi} from "./player/replay";
import {RecordApi} from "./recorder/record";
import {StepperApi} from "./stepper/api";
import {EnhancedStore} from "@reduxjs/toolkit";
import {ConceptViewer} from "./task/doc";
import {Documentation} from "./task/Documentation";
import '@france-ioi/skulpt/dist/skulpt.min.js';
import '@france-ioi/skulpt/dist/skulpt-stdlib.js';
import '@france-ioi/skulpt/dist/debugger.js';

setAutoFreeze(true);
log.setLevel('trace');
log.getLogger('performance').setLevel('info');
log.getLogger('python_interpreter').setLevel('info');

interface Codecast {
    store: AppStore,
    replayStore: AppStore,
    scope: any,
    task?: any,
    replayTask?: any,
    start?: Function,
    restart: Function
}

export interface App {
    recordApi: RecordApi,
    replayApi: ReplayApi,
    stepperApi: StepperApi,
    dispatch: Function,
    replay: boolean,
}

declare global {
    const Sk: any;

    interface Window extends WindowLocalStorage {
        store: EnhancedStore<AppStore>,
        replayStore: EnhancedStore<AppStore>,
        Codecast: Codecast,
        currentPythonRunner: any,
        currentPythonContext: any,
        languageStrings: any,
        __REDUX_DEVTOOLS_EXTENSION__: any,
        __REDUX_DEVTOOLS_EXTENSION_COMPOSE__: any,
        quickAlgoLoadedLibraries: any,
        quickAlgoLibraries: any,
        quickAlgoLibrariesList: any,
        quickAlgoContext: Function,
        quickAlgoResponsive: boolean,
        stringsLanguage: any,
        getContext: Function,
        getConceptViewerBaseConcepts: Function,
        getConceptsFromBlocks: Function,
        conceptViewer: ConceptViewer,
        conceptsFill: Function,
        Channel: any,
        DelayFactory: any,
        RaphaelFactory: any,
    }
}

/**
 * List of actions not to write in the console in development mode.
 *
 * @type {Object}
 */
const DEBUG_IGNORE_ACTIONS_MAP = {
    // 'Window.Resized': true,
    // 'Buffer.Reset': true,
    // 'Buffer.Highlight': true,
    // 'Buffer.Init': true,
    // 'Buffer.Model.Edit': true,
    // 'Player.Tick': true
};

const {store, replayStore, scope, replayScope, finalize, start, startReplay} = link(function(bundle: Bundle) {
    bundle.defineAction(ActionTypes.AppInit);
    bundle.addReducer(ActionTypes.AppInit, () => {
        // return {};
    });

    bundle.include(commonBundle);
    bundle.include(playerBundle);
    bundle.include(recorderBundle);
    bundle.include(editorBundle);
    bundle.include(statisticsBundle);

    if (process.env['NODE_ENV'] === 'development') {
        bundle.addEarlyReducer(function(state: AppStore, action): void {
            if (!DEBUG_IGNORE_ACTIONS_MAP[action.type]) {
                log.debug(state.replay ? 'action on replay' : 'action', action);
            }
        });
    }
});
finalize(scope);

/* In-browser API */
export const Codecast: Codecast = window.Codecast = {store, replayStore, scope, restart};

/*
  options :: {
    start: 'sandbox'|'player'|'recorder'|'editor',
    baseUrl: url,
    examplesUrl: url,
    baseDataUrl: url,
    user: {…},
    platform: 'python'|'unix'|'arduino',
    controls: {…},
    showStepper: boolean,
    showStack: boolean,
    showViews: boolean,
    showIO: boolean,
    source: string,
    input: string,
    token: string
  }
*/

function restart() {
    if (Codecast.task) {
        Codecast.task.cancel();
        Codecast.task = null;
    }
    if (Codecast.replayTask) {
        Codecast.replayTask.cancel();
        Codecast.replayTask = null;
    }

    /* XXX Make a separate object for selectors in the linker? */
    Codecast.task = start(scope);
    Codecast.replayTask = startReplay(replayScope);
}

function clearUrl() {
    const currentUrl = url.parse(document.location.href, true);
    delete currentUrl.search;
    delete currentUrl.query['source'];

    window.history.replaceState(null, document.title, url.format(currentUrl));
}

Codecast.start = function(options) {
    store.dispatch({type: ActionTypes.AppInit, payload: {options}});

    // remove source from url wihtout reloading
    if (options.source) {
        clearUrl();
    }
    // XXX store.dispatch({type: scope.stepperConfigure, options: stepperOptions});

    /* Run the sagas (must be done before calling autoLogin) */
    restart();

    if (!isLocalMode() && /editor|player|sandbox/.test(options.start)) {
        store.dispatch({type: StatisticsActionTypes.StatisticsInitLogData});
    }

    const urlParams = new URLSearchParams(window.location.search);
    if (!!urlParams.get('documentation')) {
        options.start = 'documentation';
    }

    let appDisplay;
    switch (options.start) {
        case 'recorder':
            autoLogin();

            store.dispatch({type: RecorderActionTypes.RecorderPrepare});

            appDisplay = <RecorderApp />;

            break;
        case 'player':
            store.dispatch({
                type: PlayerActionTypes.PlayerPrepare,
                payload: {
                    baseDataUrl: options.baseDataUrl,
                    audioUrl: options.audioUrl,
                    eventsUrl: `${options.baseDataUrl}.json`,
                    data: options.data
                }
            });

            appDisplay = <PlayerApp />;

            break;
        case 'statistics':
            autoLogin();

            store.dispatch({
                type: StatisticsActionTypes.StatisticsPrepare
            });

            appDisplay = <StatisticsApp />;

            break;
        case 'sandbox':
            store.dispatch({
                type: StatisticsActionTypes.StatisticsLogLoadingData
            });

            appDisplay = <SandboxApp />;

            break;

        case 'task':
            autoLogin();

            appDisplay = <TaskApp />;

            break;
        case 'documentation':
            appDisplay = <Documentation standalone/>;

            break;
        default:
            appDisplay = function AppDisplay () {
                return <p>{"No such application: "}{options.start}</p>;
            };

            break;
    }

    const container = document.getElementById('react-container');
    ReactDOM.render(
        <Provider store={store}>
            <AppErrorBoundary>
                {appDisplay}
            </AppErrorBoundary>
        </Provider>, container
    );
};

function autoLogin() {
    let user = null;
    try {
        user = JSON.parse(window.localStorage.getItem('user') || 'null');
    } catch (ex) {
        return;
    }

    store.dispatch({type: CommonActionTypes.LoginFeedback, payload: {user}});
}
