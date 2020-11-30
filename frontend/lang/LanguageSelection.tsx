import React from "react";
import {Languages} from "./index";
import {ActionTypes} from "./actionTypes";

interface LanguageSelectionProps {
    language: any,
    getMessage: any,
    closeMenu: Function,
    dispatch: Function,
    setLanguage: any
}

const languageKeys = Object.keys(Languages);

export class LanguageSelection extends React.PureComponent<LanguageSelectionProps> {
    render() {
        const {language, getMessage} = this.props;
        return (
            <label className='bp3-label'>
                {getMessage('LANGUAGE:')}
                <div className='bp3-select'>
                    <select onChange={this.setLanguage} value={language}>
                        {languageKeys.map(lang => {
                            const label = Languages[lang].language;
                            return <option key={lang} value={lang}>{label}</option>;
                        })}
                    </select>
                </div>
            </label>
        );
    }

    setLanguage = (event) => {
        const language = event.target.value;
        const {closeMenu, dispatch} = this.props;
        closeMenu();
        try {
            window.localStorage.language = language;
        } catch (ex) {
            // No local storage access.
        }
        setTimeout(() => dispatch({type: ActionTypes.LanguageSet, payload: {language}}), 0);
    };
}
