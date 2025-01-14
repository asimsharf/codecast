import React from 'react';
import {Button} from '@blueprintjs/core';
import {FullscreenButton} from "../common/FullscreenButton";
import {useAppSelector} from "../hooks";
import {ActionTypes} from "../common/actionTypes";
import {useDispatch} from "react-redux";

interface MenuIconsTaskProps {
    toggleMenu: () => void,
    toggleDocumentation: () => void,
}

export function MenuIconsTask(props: MenuIconsTaskProps) {
    const showDocumentation = useAppSelector(state => state.options.showDocumentation);
    const showFullScreen = useAppSelector(state => state.options.showFullScreen);
    const showMenu = useAppSelector(state => state.options.showMenu);
    const fullScreenActive = useAppSelector(state => state.fullscreen.active);

    const dispatch = useDispatch();

    const toggleDocumentation = () => {
        if (fullScreenActive) {
            dispatch({type: ActionTypes.FullscreenLeave});
        }
        props.toggleDocumentation();
    }

    return (
        <div id='menu'>
            <div className="menu-task-elements">
                {showFullScreen && <div className="menu-task-element is-blue">
                    <FullscreenButton />
                </div>}
                {showDocumentation && <div className="menu-task-element is-blue">
                    <Button onClick={toggleDocumentation} icon='help'/>
                </div>}
                {showMenu && <div className="menu-task-element">
                    <Button onClick={props.toggleMenu} icon='menu'/>
                </div>}
            </div>
        </div>
    );
}
