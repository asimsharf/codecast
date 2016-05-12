
// An instant has shape {t, eventIndex, state},
// where state is an Immutable Map of shape {source, input, syntaxTree, stepper, stepperInitial}
// where source and input are buffer models (of shape {document, selection, scrollTop}).

import {delay} from 'redux-saga';
import {take, put, call, race, fork, select} from 'redux-saga/effects';
import * as C from 'persistent-c';
import request from 'superagent';
import Immutable from 'immutable';

import {use, addSaga} from '../utils/linker';

import {RECORDING_FORMAT_VERSION} from '../version';
import Document from '../utils/document';
import {translateClear, translateStarted, translateSucceeded, translateFailed} from '../stepper/translate';
import {stepperClear, stepperRestart, stepperStarted, stepperIdle, stepperProgress} from '../stepper/reducers';
import * as runtime from '../stepper/runtime';

export default function* (deps) {

  yield use(
    'error',
    'playerPrepare', 'playerPreparing', 'playerReady',
    'playerStart', 'playerStarting', 'playerStarted',
    'playerPause', 'playerPausing', 'playerPaused',
    'playerResume', 'playerResuming', 'playerResumed',
    'playerStop', 'playerStopping', 'playerStopped',
    'playerTick',
    'getPlayerState',
    'stepperIdle', 'stepperProgress', 'stepperExit', 'stepperReset',
    'sourceReset', 'sourceModelSelect', 'sourceModelEdit', 'sourceModelScroll', 'sourceHighlight',
    'inputReset', 'inputModelSelect', 'inputModelEdit', 'inputModelScroll'
  );

  // pause, resume audio

  function getJson (path) {
    return new Promise(function (resolve, reject) {
      var req = request.get(path);
      req.set('Accept', 'application/json');
      req.end(function (err, res) {
        if (err) {
          reject({err, res});
        } else {
          resolve(res.body);
        }
      });
    });
  };

  function eventToDelta (event) {
    const range = Document.expandRange(event[2]);
    if (event[1].endsWith('insert')) {
      return {
        action: 'insert',
        start: range.start,
        end: range.end,
        lines: event[3]
      };
    }
    if (event[1].endsWith('delete')) {
      return {
        action: 'remove',
        start: range.start,
        end: range.end
      };
    }
  }

  const findInstant = function (instants, time) {
    let low = 0, high = instants.length;
    while (low + 1 < high) {
      const mid = (low + high) / 2 | 0;
      const state = instants[mid];
      if (state.t <= time) {
        low = mid;
      } else {
        high = mid;
      }
    }
    let instant = instants[low];
    if (instant) {
      while (low + 1 < instants.length) {
        const nextInstant = instants[low + 1];
        if (nextInstant.t !== instant.t)
          break;
        low += 1;
      }
    }
    return instants[low];
  };

  //
  // Sagas (generators)
  //

  function* playerPrepare (action) {
    const {audioUrl, eventsUrl} = action;
    // Check that the player is idle.
    const player = yield select(deps.getPlayerState);
    if (player.get('status') !== 'idle') {
      return;
    }
    // Emit a Preparing action.
    yield put({type: deps.playerPreparing});
    // TODO: Clean up any old resources
    // Create the audio player and start buffering.
    const audio = new Audio();
    audio.src = audioUrl;
    // TODO: audio.onended = ...
    // Download the events URL
    const events = yield call(getJson, eventsUrl);
    // Compute the future state after every event.
    const instants = yield call(computeInstants, events);
    // TODO: watch audioElement.buffered?
    yield put({type: deps.playerReady, audio, events, instants});
    yield call(resetToInstant, instants[0]);
  }

  function* playerStart () {
    try {
      const player = yield select(deps.getPlayerState);
      if (player.get('status') !== 'ready')
        return;
      yield put({type: deps.playerStarting});
      // TODO: Find the state immediately before current audio position, put that state.
      player.get('audio').play();
      yield put({type: deps.playerStarted});
    } catch (error) {
      yield put({type: deps.error, source: 'playerStart', error});
    }
  }

  function* playerPause () {
    try {
      const player = yield select(deps.getPlayerState);
      if (player.get('status') !== 'playing')
        return;
      yield put({type: deps.playerPausing});
      player.get('audio').pause();
      // Call resetToInstant to bring the global state in line with the current
      // state.  This is required in particular for the editors that have
      // been updated incrementally by sending them events without updating
      // the global state.
      yield call(resetToInstant, player.get('current'));
      yield put({type: deps.playerPaused});
    } catch (error) {
      yield put({type: deps.error, source: 'playerPause', error});
    }
  }

  function* playerResume () {
    try {
      const player = yield select(deps.getPlayerState);
      if (player.get('status') !== 'paused')
        return;
      yield put({type: deps.playerResuming});
      player.get('audio').play();
      yield put({type: deps.playerResumed});
    } catch (error) {
      yield put({type: deps.error, source: 'playerResume', error});
    }
  }

  function* playerStop () {
    try {
      const player = yield select(deps.getPlayerState);
      if (player.get('status') !== 'playing')
        return;
      // Signal that the player is stopping.
      yield put({type: deps.playerStopping});
      // TODO: Stop the audio player.
      yield put({type: deps.playerStopped});
    } catch (error) {
      yield put({type: deps.error, source: 'playerStop', error});
    }
  }

  function* computeInstants (events) {
    // TODO: avoid hogging the CPU, emit progress events.
    let state = null;
    let context = null;
    let instants = [];
    for (let pos = 0; pos < events.length; pos += 1) {
      const event = events[pos];
      const t = event[0];
      switch (event[1]) {
        case 'start': {
          const init = event[2];
          const sourceModel = Immutable.Map({
            document: Document.fromString(init.source.document),
            selection: Document.expandRange(init.source.selection),
            scrollTop: init.source.scrollTop || 0
          });
          const inputModel = Immutable.Map({
            document: Document.fromString(init.input ? init.input.document : ''),
            selection: Document.expandRange(init.input ? init.input.selection : [0,0,0,0]),
            scrollTop: (init.input && init.input.scrollTop) || 0
          });
          const translateModel = translateClear();
          const stepperModel = stepperClear();
          state = Immutable.Map({
            source: sourceModel,
            input: inputModel,
            translate: translateModel,
            stepper: stepperModel
          })
          break;
        }
        case 'source.select': case 'select': {
          // XXX use reducer imported from common/buffers
          state = state.setIn(['source', 'selection'], Document.expandRange(event[2]));
          break;
        }
        case 'source.insert': case 'source.delete': case 'insert': case 'delete': {
          // XXX use reducer imported from common/buffers
          const delta = eventToDelta(event);
          if (delta) {
            state = state.updateIn(['source', 'document'], document =>
              Document.applyDelta(document, delta));
          }
          break;
        }
        case 'source.scroll': {
          // XXX use reducer imported from common/buffers
          state = state.setIn(['source', 'scrollTop'], event[2]);
          break;
        }
        case 'input.select': {
          // XXX use reducer imported from common/buffers
          state = state.setIn(['input', 'selection'], Document.expandRange(event[2]));
          break;
        }
        case 'input.insert': case 'input.delete': {
          // XXX use reducer imported from common/buffers
          const delta = eventToDelta(event);
          if (delta) {
            state = state.updateIn(['input', 'document'], document =>
              Document.applyDelta(document, delta));
          }
          break;
        }
        case 'input.scroll': {
          // XXX use reducer imported from common/buffers
          state = state.setIn(['input', 'scrollTop'], event[2]);
          break;
        }
        case 'stepper.translate': {
          const action = {source: event[2]};
          state = state.update('translate', st => translateStarted(st, action));
          break;
        }
        case 'stepper.translateSuccess': {
          const action = {diagnostics: event[2].diagnostics, syntaxTree: event[2].ast};
          state = state.update('translate', st => translateSucceeded(st, action));
          break;
        }
        case 'stepper.translateFailure': case 'translateFailure': {
          const action = {diagnostics: event[2].diagnostics, error: event[2].error};
          state = state.update('translate', st => translateFailure(st, action));
          break;
        }
        case 'stepper.exit': {
          state = state
            .update('translate', translateClear)
            .update('stepper', stepperClear);
          break;
        }
        case 'stepper.restart': {
          const syntaxTree = state.getIn(['translate', 'syntaxTree']);
          const input = state.get('input') && Document.toString(state.getIn(['input', 'document']));
          const stepperState = C.clearMemoryLog(runtime.start(syntaxTree, {input}));
          const action = {stepperState};
          state = state.update('stepper', st => stepperRestart(st, action));
          break;
        }
        case 'stepper.step': {
          const mode = event[2];
          state = state.update('stepper', st => stepperStarted(st, {mode}));
          context = beginStep(state.getIn(['stepper', 'current']));
          break;
        }
        case 'stepper.idle': {
          context = runToStep(context, event[2]);
          state = state.update('stepper', st => stepperIdle(st, {context}));
          break;
        }
        case 'stepper.progress': {
          context = runToStep(context, event[2]);
          state = state.update('stepper', st => stepperProgress(st, {context}));
          break;
        }
        case 'end': {
          state = state.set('stopped', true);
          break;
        }
        default: {
          console.log(`[${event[0]}]: unknown event type ${event[1]}`);
          break;
        }
      }
      instants.push({t, eventIndex: pos, state});
    }
    return instants;
  }

  function beginStep (state) {
    return {
      state: C.clearMemoryLog(state),
      stepCounter: 0
    };
  }

  function runToStep (context, targetStepCounter) {
    let {state, stepCounter} = context;
    while (stepCounter < targetStepCounter) {
      state = C.step(state, runtime.options);
      stepCounter += 1;
    }
    return {state, stepCounter};
  }

  yield addSaga(function* watchPlayerPrepare () {
    while (true) {
      const action = yield take(deps.playerPrepare);
      try {
        yield call(playerPrepare, action);
      } catch (error) {
        yield put({type: deps.error, source: 'playerPrepare', error});
      }
    }
  });

  yield addSaga(function* watchPlayerStart () {
    while (true) {
      yield take(deps.playerStart);
      yield call(playerStart);
    }
  });

  yield addSaga(function* watchPlayerPause () {
    while (true) {
      yield take(deps.playerPause);
      yield call(playerPause);
    }
  });

  yield addSaga(function* watchPlayerResume () {
    while (true) {
      yield take(deps.playerResume);
      yield call(playerResume);
    }
  });

  yield addSaga(function* watchPlayerStop () {
    while (true) {
      yield take(deps.playerStop);
      yield call(playerStop);
    }
  });

  function* resetToInstant (instant) {
    const {state} = instant;
    const player = yield select(deps.getPlayerState);
    yield put({type: deps.sourceReset, model: state.get('source')});
    yield put({type: deps.inputReset, model: state.get('input')});
    const stepperState = state.get('stepper');
    yield put({type: deps.stepperReset, state: stepperState});
    // TODO: restore translate too
    yield put({type: deps.playerTick, current: instant});
  }

  yield addSaga(function* playerTick () {
    while (true) {
      yield take(deps.playerStarted);
      let atEnd = false;
      while (!atEnd) {
        const outcome = yield race({
          tick: call(delay, 50),
          stopped: take(deps.playerStopping)
        });
        if ('stopped' in outcome)
          break;
        const player = yield select(deps.getPlayerState);
        const audio = player.get('audio');
        const audioTime = Math.round(audio.currentTime * 1000);
        const prevInstant = player.get('current');
        const instants = player.get('instants');
        const nextInstant = findInstant(instants, audioTime);
        if (prevInstant === nextInstant) {
          // Fast path, no change.
          continue;
        } else if (nextInstant.eventIndex < prevInstant.eventIndex) {
          // Event index jumped backwards.
          console.log("<< seek", nextInstant.t);
          yield call(resetToInstant, nextInstant);
        } else if (nextInstant.t > prevInstant.t + 1000 && prevInstant.eventIndex + 10 < nextInstant.eventIndex) {
          // Time between last state and new state jumped by more than 1 second,
          // and there are more than 10 events to replay.
          console.log("seek >>", nextInstant.t);
          yield call(resetToInstant, nextInstant);
        } else {
          // Play incremental events between prevInstant (exclusive) and
          // nextInstant (inclusive).
          // Small time delta, attempt to replay events.
          const events = player.get('events');
          // XXX Assumption: 1-to-1 correspondance between indexes in
          //                 events and instants: instants[pos] is the state
          //                 immediately after replaying events[pos],
          //                 and pos === instants[pos].eventIndex
          for (let pos = prevInstant.eventIndex + 1; pos <= nextInstant.eventIndex; pos += 1) {
            const event = events[pos];
            switch (event[1]) {
              case 'source.select':
                yield put({type: deps.sourceModelSelect, selection: Document.expandRange(event[2])});
                break;
              case 'source.insert': case 'source.delete':
                yield put({type: deps.sourceModelEdit, delta: eventToDelta(event)});
                break;
              case 'source.scroll':
                yield put({type: deps.sourceModelScroll, scrollTop: event[2]});
                break;
              case 'input.select':
                yield put({type: deps.inputModelSelect, selection: Document.expandRange(event[2])});
                break;
              case 'input.insert': case 'input.delete':
                yield put({type: deps.inputModelEdit, delta: eventToDelta(event)});
                break;
              case 'input.scroll':
                yield put({type: deps.inputModelScroll, scrollTop: event[2]});
                break;
              case 'end':
                atEnd = true;
                break;
            }
            yield put({type: deps.playerTick, current: nextInstant});
            const state = nextInstant.state;  // state reached after event is replayed
            const stepperState = state.get('stepper');
            yield put({type: deps.stepperReset, state: stepperState});
            const range = runtime.getNodeRange(stepperState.get('display'));
            yield put({type: deps.sourceHighlight, range});
          }
        }
      }
    }
  });

};
