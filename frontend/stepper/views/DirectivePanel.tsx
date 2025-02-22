import React from "react";
import {DirectiveFrame} from "./DirectiveFrame";
import {analysisDirectiveViewDict, C_directiveViewDict} from "./index";
import {CodecastPlatform} from "../../store";

export function DirectivePanel({scale, directive, controls, context, functionCallStack, platform, onChange, allocatedWidth, allocatedHeight}) {
    const {kind} = directive;
    const hide = controls.hide;
    if (hide) {
        return null;
    }
    if (directive[0] === 'error') {
        return <p>{'Error: '}{JSON.stringify(directive[1])}</p>;
    }

    let directiveDescription;
    if (platform === CodecastPlatform.Python) {
        if (!analysisDirectiveViewDict[kind]) {
            return <p>{'Error: undefined view kind '}{kind}</p>;
        }

        directiveDescription = analysisDirectiveViewDict[kind];
    } else {
        if (!C_directiveViewDict[kind]) {
            return <p>{'Error: undefined view kind '}{kind}</p>;
        }

        directiveDescription = C_directiveViewDict[kind];
    }

    const props = directiveDescription.selector({scale, directive, context, controls, functionCallStack, allocatedWidth, allocatedHeight});

    return (
        <directiveDescription.View
            DirectiveFrame={DirectiveFrame}
            onChange={onChange}
            {...props}
        />
    );
}
