import {quickAlgoLibraries} from "./libs/quickalgo_librairies";
import {current, isDraft} from "immer";
import {checkPythonCode, getPythonBlocksUsage} from "./python_utils";
import {getMessage} from "../lang";
import {AppStore, CodecastPlatform} from "../store";

export function extractLevelSpecific(item, level) {
    if ((typeof item != "object")) {
        return item;
    }
    if (Array.isArray(item)) {
        return item.map((val) => {
            return extractLevelSpecific(val, level);
        });
    }
    if (item.shared === undefined) {
        if (item[level] === undefined) {
            let newItem = {};
            for (let prop in item) {
                newItem[prop] = extractLevelSpecific(item[prop], level);
            }
            return newItem;
        }
        return extractLevelSpecific(item[level], level);
    }
    if (Array.isArray(item.shared)) {
        let newItem = [];
        for (let iElem = 0; iElem < item.shared.length; iElem++) {
            newItem.push(extractLevelSpecific(item.shared[iElem], level));
        }
        if (item[level] != undefined) {
            if (!Array.isArray(item[level])) {
                console.error("Incompatible types when merging shared and " + level);
            }
            for (let iElem = 0; iElem < item[level].length; iElem++) {
                newItem.push(extractLevelSpecific(item[level][iElem], level));
            }
        }
        return newItem;
    }
    if (typeof item.shared == "object") {
        let newItem = {};
        for (let prop in item.shared) {
            newItem[prop] = extractLevelSpecific(item.shared[prop], level);
        }
        if (item[level] != undefined) {
            if (typeof item[level] != "object") {
                console.error("Incompatible types when merging shared and " + level);
            }
            for (let prop in item[level]) {
                newItem[prop] = extractLevelSpecific(item[level][prop], level);
            }
        }
        return newItem;
    }
    console.error("Invalid type for shared property");
}

export function getAvailableModules(context) {
    if (context.infos.includeBlocks && context.infos.includeBlocks.generatedBlocks) {
        let availableModules = [];
        for (let generatorName in context.infos.includeBlocks.generatedBlocks) {
            if (context.infos.includeBlocks.generatedBlocks[generatorName].length) {
                availableModules.push(generatorName);
            }
        }
        return availableModules;
    } else {
        return [];
    }
}

export function checkCompilingCode(code, platform: CodecastPlatform, state: AppStore, withEmptyCheck: boolean = true) {
    if (withEmptyCheck && !code) {
        throw getMessage('CODE_CONSTRAINTS_EMPTY_PROGRAM');
    }

    if ('python' === platform) {
        const context = quickAlgoLibraries.getContext(null, state.environment);
        if (context) {
            checkPythonCode(code, context, state, withEmptyCheck);
        }
    }
}

export function getBlocksUsage(code: string, platform: CodecastPlatform) {
    if ('python' === platform) {
        const context = quickAlgoLibraries.getContext(null, 'main');
        if (context) {
            return getPythonBlocksUsage(code, context);
        }
    }

    return null;
}

export function getDefaultSourceCode(platform: CodecastPlatform, environment: string) {
    if ('python' === platform) {
        const context = quickAlgoLibraries.getContext(null, environment);
        if (context) {
            const availableModules = getAvailableModules(context);
            let content = '';
            for (let i = 0; i < availableModules.length; i++) {
                content += 'from ' + availableModules[i] + ' import *\n';
            }
            return content;
        }
    }

    return '';
}

export function getCurrentImmerState(object) {
    return Object.fromEntries(
        Object.entries(object).map(
            ([k, v]) => [k, isDraft(v) ? current(v) : v],
        )
    )
}
