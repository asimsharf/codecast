import React from "react";
import {Icon} from "@blueprintjs/core";
import classnames from 'classnames';
import {LogoutButton} from "../common/LogoutButton";
import {connect} from "react-redux";
import {AppStore} from "../store";
import {SetupScreen} from "./SetupScreen";
import {LoginScreen} from "../common/LoginScreen";
import {EditScreen} from "./EditScreen";

enum EditorAppActivity {
    None,
    Login,
    Setup,
    Edit
}

interface EditorAppStateToProps {
    activity: EditorAppActivity,
    floatingControls: any
}

function mapStateToProps(state: AppStore): EditorAppStateToProps {
    const user = state.get('user');
    const screen = state.get('screen');
    const floatingControls = state.getIn(['editor', 'controls']).floating;

    let activity = EditorAppActivity.None;
    if (!user) {
        activity = EditorAppActivity.Login;
    } else if (screen === 'setup') {
        activity = EditorAppActivity.Setup;
    } else if (screen === 'edit') {
        activity = EditorAppActivity.Edit;
    }

    return {activity, floatingControls};
}

interface EditorAppDispatchToProps {
    dispatch: Function
}

interface EditorAppProps extends EditorAppStateToProps, EditorAppDispatchToProps {

}

class _EditorApp extends React.PureComponent<EditorAppProps> {
    state = {collapsed: false};

    render() {
        const {activity, floatingControls} = this.props;
        const {collapsed} = this.state;

        const iconName = (collapsed) ? 'chevron-down' : 'chevron-up';

        let screen = <p>{'undefined state'}</p>;
        if (activity === EditorAppActivity.Login) {
            screen = <LoginScreen />;
        } else if (activity === EditorAppActivity.Setup) {
            screen = <SetupScreen />;
        } else if (activity === EditorAppActivity.Edit) {
            screen = <EditScreen />;
        }

        return (
            <div id='editor-app'>
                <div id='floating-controls' className={classnames({collapsed})}>
                    <span className='collapse-toggle' onClick={this._toggleCollapsed}>
                        <Icon icon={iconName}/>
                    </span>
                    <div className='btn-group'>
                        {floatingControls.map((Component, i) =>
                            <Component key={i} />
                        )}
                        {(activity === EditorAppActivity.Setup || activity === EditorAppActivity.Edit) &&
                            <LogoutButton />
                        }
                    </div>
                </div>

                {screen}
            </div>
        );
    }

    _toggleCollapsed = () => {
        const {collapsed} = this.state;

        this.setState({collapsed: !collapsed});
    };
}

export const EditorApp = connect(mapStateToProps)(_EditorApp);
