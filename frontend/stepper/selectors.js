
import {defineSelector} from '../utils/linker';

export default function* () {

  yield defineSelector('getStepperState', state =>
    state.get('stepper')
  );

  yield defineSelector('getStepperDisplay', state =>
    state.getIn(['stepper', 'display'])
  );

  yield defineSelector('getStepperInterrupted', state =>
    state.getIn(['stepper', 'interrupt'])
  );

};
