import React from "react";
import {Button} from "@blueprintjs/core";
import {ActionTypes} from "./actionTypes";

interface TrimEditorReturnProps {
    dispatch: Function
}

export class TrimEditorReturn extends React.PureComponent<TrimEditorReturnProps> {
    render() {
        return <Button onClick={this._return} icon='direction-left' text='Back'/>;
    }

    _return = () => {
        this.props.dispatch({type: ActionTypes.EditorTrimReturn});
    };
}
